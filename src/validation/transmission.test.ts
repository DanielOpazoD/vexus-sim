import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, pointOnLine, pointOnSteeredLine, probeFrame } from '../probe/probe';
import { COMPOUND, lookTheta } from '../ultrasound/compound';
import { IFACE_REACH_MM } from '../ultrasound/interfaceEcho';
import { COARSE_DEPTH } from '../ultrasound/renderer';
import { FRAG_RAWFIELD, FRAG_TRANS_HITS, FRAG_TRANS_PREFIX } from '../ultrasound/shaders/passes.glsl';
import { alongLineMm, lookCoverage, steerBeta } from '../ultrasound/steering';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import {
  BONE_ENTRY_DB,
  GAS_DB_PER_CM,
  MIRROR_BISECTION_STEPS,
  MIRROR_DB,
  STEERED_PREFIX_GLSL,
  mirrorCrossing,
  mirrorLookaheadRows,
  prefixDb,
  rayAttenuationDb,
  rayTransmission,
  steeredPrefixDb,
} from '../ultrasound/transmission';
import { GRID_GEOMETRY, emptyGrid, gridLineAngle, segmentGridFromScene, setMirror } from './support/segmentGrid';

/** Regla de atenuación compartida por la puerta PW y la pasada A (GLSL). */
describe('Atenuación a lo largo del rayo', () => {
  const f = 2.5;
  it('el gel previo a la piel no atenúa; el tejido blando atenúa 2·α·paso', () => {
    const db = rayAttenuationDb([Tissue.Air, Tissue.Air, Tissue.Liver, Tissue.Liver], 2.5, f);
    expect(db).toBeCloseTo(2 * 2 * attenuationDbPerCm(Tissue.Liver, f) * 0.25, 9);
  });

  it('el hueso cobra la reflexión de entrada UNA sola vez, no en cada paso (antes 6 dB por paso en CPU)', () => {
    const one = rayAttenuationDb([Tissue.Bone], 2.5, f);
    const four = rayAttenuationDb([Tissue.Bone, Tissue.Bone, Tissue.Bone, Tissue.Bone], 2.5, f);
    const alphaStep = 2 * attenuationDbPerCm(Tissue.Bone, f) * 0.25;
    expect(one).toBeCloseTo(BONE_ENTRY_DB + alphaStep, 9);
    expect(four).toBeCloseTo(BONE_ENTRY_DB + 4 * alphaStep, 9);
    // una segunda costilla tras tejido blando no vuelve a cobrar la entrada (igual que la GPU)
    const two = rayAttenuationDb([Tissue.Bone, Tissue.Muscle, Tissue.Bone], 2.5, f);
    expect(two).toBeCloseTo(BONE_ENTRY_DB + 2 * alphaStep + 2 * attenuationDbPerCm(Tissue.Muscle, f) * 0.25, 9);
  });

  it('el gas atenúa 60 dB/cm sin absorción añadida y la transmisión es 10^(−dB/20)', () => {
    expect(rayAttenuationDb([Tissue.BowelGas, Tissue.BowelGas], 5, f)).toBeCloseTo(GAS_DB_PER_CM, 9);
    expect(rayTransmission([Tissue.BowelGas, Tissue.BowelGas], 5, f)).toBeCloseTo(1e-3, 12);
    expect(rayTransmission([], 5, f)).toBe(1);
  });
});

/** Espejo diafragmático de la pasada A en el cruce exacto (decisión 57). */
describe('Espejo en el cruce exacto con el pulmón', () => {
  it('la bisección de A0 deja el espejo a ≤ paso/2⁷ de la pleura, esté donde esté dentro del segmento', () => {
    for (const depth of [120, 180, 240]) {
      const step = depth / COARSE_DEPTH;
      for (let j = 0; j < 200; j++) {
        const pleura = 60 + (j / 200) * 7 * step;
        // A0: el primer centro de segmento que ya es pulmón
        const isLung = (r: number) => r >= pleura;
        const s = Math.ceil(pleura / step - 0.5);
        const rLung = (s + 0.5) * step;
        expect(isLung(rLung) && !isLung(rLung - step)).toBe(true);
        const r = mirrorCrossing(isLung, rLung, step);
        expect(Math.abs(r - pleura), `${depth} mm, pleura a ${pleura.toFixed(3)}`).toBeLessThanOrEqual(
          step / 2 ** (MIRROR_BISECTION_STEPS + 1) + 1e-12,
        );
        // antes: el centro del primer segmento, hasta un paso dentro del pulmón
        expect(rLung - pleura).toBeLessThanOrEqual(step);
      }
    }
    // 6 pasos: ≤ 0,009 mm a 18 cm, bajo la puerta de 0,05 mm del banco
    expect(180 / COARSE_DEPTH / 2 ** (MIRROR_BISECTION_STEPS + 1)).toBeLessThan(0.01);
  });

  it('A0 hace la bisección con el número de pasos de TS y A2 publica el espejo exacto desde su alcance', () => {
    expect(FRAG_TRANS_HITS).toContain(`for (int it = 0; it < ${MIRROR_BISECTION_STEPS}; it++)`);
    expect(FRAG_TRANS_HITS).toContain('mirrorSeg = float(s); hitR = 0.5 * (lo + hi);');
    // la pasada B necesita el espejo desde r_m − alcance del eco pleural, y lo refleja solo tras r_m
    expect(FRAG_TRANS_PREFIX).toContain(`h1.w < (kf + 1.0) * step + ${IFACE_REACH_MM.toFixed(4)} ? h1.w : -1.0`);
    expect(FRAG_TRANS_PREFIX).toContain('(h0.y == h0.x ? h1.w : (h0.y + 0.5) * step)');
    expect(FRAG_RAWFIELD).toContain('if (mirrorHit >= 0.0 && r > mirrorHit)');
    expect(FRAG_RAWFIELD).toContain('pleuraEcho(r - mirrorHit, dir0, normalize(t1.xyz))');
  });
});

/**
 * Prefijo dirigido de A2 (decisión 58, T5): la atenuación a lo largo del camino de una mirada dirigida,
 * sumada sobre los segmentos radiales de la mirada 0 sin clasificación nueva.
 */
describe('Prefijo dirigido de A2 (decisión 58)', () => {
  const G = GRID_GEOMETRY;
  const R = G.curvatureRadius;
  const F = CONVEX_C35_PROFILE.bEffectiveMHz;
  const TH = lookTheta(1, COMPOUND);
  const dPhi = (2 * G.halfSector) / G.lines;

  it('con θ = 0 es el gemelo de A2 de la mirada 0, bit a bit, con gel, hueso, gas y espejo', () => {
    // gel hasta 3 mm, costilla, gas intestinal en unas líneas y pulmón (espejo) en otras
    const g = segmentGridFromScene(
      (x, z) =>
        z < 3
          ? Tissue.Air
          : Math.abs(x + 20) < 5 && z > 15 && z < 22
            ? Tissue.Bone
            : Math.abs(x - 25) < 4 && z > 60 && z < 64
              ? Tissue.BowelGas
              : Tissue.Liver,
      F,
    );
    for (let l = 120; l < 170; l++) {
      const m = 70 + ((l * 7) % 5);
      setMirror(g, l, m, (m + 0.3) * g.stepMm);
      for (let s = m + 1; s < g.rows; s++) g.db[l * g.rows + s] = 0.37 + 0.001 * l;
    }
    for (let l = 0; l < G.lines; l += 3)
      for (let k = 0; k < G.rows; k += 2) {
        const a = prefixDb(g, l, k);
        const b = steeredPrefixDb(g, G, 0, l, k);
        expect(b.db, `línea ${l}, fila ${k}`).toBe(a.db);
        expect(b.sGas).toBe(a.gasHit);
        expect(b.sBone).toBe(a.boneHit);
        expect(b.sMirror).toBe(a.mirrorHit);
        expect(b.gasKind).toBe(a.gasKind);
        expect(b.element).toBeCloseTo(gridLineAngle(l), 12);
      }
    // la regla del espejo con el alcance del eco pleural: publicado desde la fila anterior si cabe
    const l = 160; // sin gas intestinal delante del espejo
    const m = g.mirrorSeg[l];
    expect(prefixDb(g, l, m - 1).mirrorHit).toBe(g.mirrorR[l] < m * g.stepMm + IFACE_REACH_MM ? g.mirrorR[l] : -1);
    expect(prefixDb(g, l, m - 3).mirrorHit).toBe(-1);
    expect(prefixDb(g, l, m).gasHit).toBe(g.mirrorR[l]);
    expect(prefixDb(g, l, m).gasKind).toBe(1);
  });

  it('en hígado homogéneo es la atenuación del rayo de la CPU sobre el camino dirigido (≤ 0,05 dB)', () => {
    const g = segmentGridFromScene(() => Tissue.Liver, F);
    const sp = START_POINTS.find((p) => p.id === 'subxiphoid')!;
    const fr = probeFrame(
      { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 },
      new AnatomyScene(NORMAL_ADULT).torso,
      CONVEX_C35,
    );
    const c = fr.curvatureCenter;
    const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    let worst = 0;
    for (const th of [TH, -TH])
      for (const l of [40, 96, 150])
        for (const k of [5, 40, 90, 159]) {
          // el camino dirigido que llega a la muestra (línea l, fila k) sale del elemento φ_k y pasa por ella
          const alpha = gridLineAngle(l);
          const rk = (k + 0.5) * g.stepMm;
          const phi = alpha - th + steerBeta(R + rk, th, R);
          const sample = pointOnSteeredLine(fr, CONVEX_C35, phi, th, alongLineMm(R + rk, th, R));
          expect(dist(sample, pointOnLine(fr, CONVEX_C35, alpha, rk))).toBeLessThan(1e-9);
          // el prefijo incluye la fila k entera: el rayo de la CPU recorre el camino hasta ρ = R + (k + 1)·paso
          const sEnd = alongLineMm(R + (k + 1) * g.stepMm, th, R);
          expect(dist(pointOnSteeredLine(fr, CONVEX_C35, phi, th, sEnd), c)).toBeCloseTo(R + (k + 1) * g.stepMm, 9);
          const n = Math.ceil(sEnd / 0.01);
          const cpu = rayAttenuationDb(
            Array.from({ length: n }, () => Tissue.Liver),
            sEnd / n,
            F,
          );
          worst = Math.max(worst, Math.abs(steeredPrefixDb(g, G, th, l, k).db - cpu));
        }
    expect(worst).toBeLessThanOrEqual(0.05);
    // y es más largo que el radial: el camino cruza cada corona en oblicuo (ds/dρ ≤ 1,007)
    const radial = prefixDb(g, 96, 159).db;
    const steered = steeredPrefixDb(g, G, TH, 96, 159).db;
    expect(steered / radial).toBeGreaterThan(1);
    expect(steered / radial).toBeLessThan(1 / Math.cos(TH));
  });

  it('espejo congelado: el camino dirigido sigue el reflejado de la línea cuyo espejo cruza', () => {
    const g = emptyGrid(G);
    const d0 = 0.2;
    g.db.fill(d0);
    // pleura inclinada: el espejo baja una fila cada 6 líneas
    const mOf = (l: number) => 60 + Math.floor(l / 6);
    for (let l = 0; l < G.lines; l++) {
      setMirror(g, l, mOf(l), (mOf(l) + 0.2) * g.stepMm);
      // tras el espejo, los segmentos del camino reflejado de cada línea llevan su propia firma
      for (let s = mOf(l) + 1; s < G.rows; s++) g.db[l * G.rows + s] = 1 + l / 1000;
    }
    const a = R * Math.sin(TH);
    for (const [j, k] of [
      [100, 120],
      [60, 90],
      [150, 159],
    ]) {
      const betaK = steerBeta(R + (k + 0.5) * g.stepMm, TH, R);
      // referencia independiente: la primera fila cuya línea atravesada ya pasó su espejo
      let expected = 0;
      let crossLine = -1;
      let crossRow = -1;
      for (let s = 0; s <= k; s++) {
        const rho = R + (s + 0.5) * g.stepMm;
        const l = Math.floor(j + (betaK - steerBeta(rho, TH, R)) / dPhi + 0.5);
        if (s >= mOf(l)) {
          crossLine = l;
          crossRow = s;
          break;
        }
        expected += d0 * (rho / Math.sqrt(rho * rho - a * a));
      }
      expect(crossLine).toBeGreaterThanOrEqual(0);
      expected += MIRROR_DB;
      for (let s = crossRow + 1; s <= k; s++) expected += 1 + crossLine / 1000;
      const p = steeredPrefixDb(g, G, TH, j, k);
      expect(p.mirrorLine).toBe(crossLine);
      expect(p.db).toBeCloseTo(expected, 10);
      expect(p.sMirror).toBeCloseTo(alongLineMm(R + g.mirrorR[crossLine], TH, R), 12);
      expect(p.sGas).toBe(p.sMirror);
      expect(p.gasKind).toBe(1);
    }
    // antes del espejo: se publica solo si el cruce queda al alcance del eco pleural desde la fila k
    const j = 100;
    const pre = steeredPrefixDb(g, G, TH, j, 60);
    expect(pre.sGas).toBe(-1);
    const ahead = mirrorLookaheadRows(g.stepMm);
    expect(ahead).toBe(Math.ceil(IFACE_REACH_MM / g.stepMm + 0.5));
    for (let k = 60; k < 90; k++) {
      const q = steeredPrefixDb(g, G, TH, j, k);
      if (q.sGas >= 0) break;
      // sin gas en el prefijo, el espejo se publica solo si su cruce está a menos del alcance del final de la fila k
      if (q.sMirror >= 0) expect(g.mirrorR[q.mirrorLine]).toBeLessThan((k + 1) * g.stepMm + IFACE_REACH_MM);
    }
  });

  it('un camino que saldría de fuera del arreglo tiene cobertura 0', () => {
    const g = segmentGridFromScene(() => Tissue.Liver, F);
    const k = 150;
    // +θ hacia el borde negativo: el elemento del camino que llega a la línea 0 está fuera del arreglo
    const out = steeredPrefixDb(g, G, TH, 0, k);
    expect(out.element).toBeLessThan(-G.halfSector);
    expect(lookCoverage(out.element, G.halfSector, G.lines, COMPOUND.taperLines)).toBe(0);
    expect(Number.isFinite(out.db)).toBe(true);
    // −θ en el mismo sitio sí sale del arreglo
    const inside = steeredPrefixDb(g, G, -TH, 0, k);
    expect(lookCoverage(inside.element, G.halfSector, G.lines, COMPOUND.taperLines)).toBe(1);
    // la banda sin cobertura a ±7° mide lo que la costura: (θ − β(ρ))/dφ líneas
    const band = Array.from({ length: 40 }, (_, l) =>
      lookCoverage(steeredPrefixDb(g, G, TH, l, k).element, G.halfSector, G.lines, 1),
    ).filter((c) => c === 0).length;
    expect(Math.abs(band - (TH - steerBeta(R + (k + 0.5) * g.stepMm, TH, R)) / dPhi)).toBeLessThanOrEqual(1);
  });

  it('el GLSL dirigido de A2 interpola sus constantes de TS', () => {
    expect(STEERED_PREFIX_GLSL).toContain(`int ahead = int(ceil(${IFACE_REACH_MM.toFixed(4)} / step + 0.5));`);
    expect(STEERED_PREFIX_GLSL).toContain(`db += ${BONE_ENTRY_DB.toFixed(1)}; boneEntered = true;`);
    expect(STEERED_PREFIX_GLSL).toContain('} else scale = rho / sqrt(rho * rho - a * a);');
    expect(STEERED_PREFIX_GLSL).toContain('sMirror = alongLineMm(uCurvR + mr, a, rc);');
    expect(STEERED_PREFIX_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/\bIFACE_REACH_MM\b|\bBONE_ENTRY_DB\b|\bMIRROR_DB\b/);
  });
});
