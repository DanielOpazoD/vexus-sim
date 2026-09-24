// @tier slow
import { describe, expect, it } from 'vitest';
import { fidelityStats, type FidelityStats, type TransmissionFrame } from '../app/fidelity';
import { COMPOUND, compoundEnvelope, lookTheta } from '../ultrasound/compound';
import { SPECKLE_CLEARANCE_MM, SPECKLE_PATCH, speckleMask, speckleStats, type EnvelopeFrame } from '../app/speckle';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { diaphragmHeight } from '../anatomy/primitives';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame } from '../probe/probe';
import { lateralFwhmMm } from '../ultrasound/beamModel';
import { COARSE_DEPTH, DISPLAY_MARGIN_PX, type DisplayFrame } from '../ultrasound/renderer';
import { pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { mirrorCrossing } from '../ultrasound/transmission';
import { detect, psf, whiteField } from './syntheticSpeckle';

/**
 * El banco de fidelidad sobre la anatomía real, sin GPU: el sano en apnea en las ventanas subxifoidea,
 * intercostal y renal, una envolvente de moteado ideal atenuada ×0,1 fuera del hígado (si la máscara
 * deja entrar otro tejido, la fracción oscura y las grietas lo delatan) y una imagen «mostrada» pintada
 * por tejido (hígado 100, sangre 0, pared de vaso 180, cápsula hepática, diafragma y cápsula renal 200,
 * el resto 60). Comprueba la geometría de `fidelityStats` de extremo a extremo: la máscara del hígado,
 * el perfil sin pendiente inventada, las paredes anteriores con su incidencia real y el banco de
 * interfaces (porta, cápsula, diafragma y Morison).
 */
const DEPTH = 180;
const FOCUS = 90;
const W = 320;
const H = 229;
const GRID_MM = 0.5;
const NR = DEPTH / GRID_MM;

const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient);
const anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
const G = { lines: CONVEX_C35.lines, samples: 1024 };
const speckle = detect(G, psf(G, whiteField(G, 7), 1.5, 1.0), Math.hypot);
const thetaOf = (u: number): number => -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / G.lines;

const FACE_GRAY = 200;
const frames = new Map<StartPoint['id'], ReturnType<typeof probeFrame>>();
const planes = new Map<StartPoint['id'], { sim: Simulator; env: EnvelopeFrame; img: DisplayFrame; gain: Float32Array }>();

function measure(id: StartPoint['id']): FidelityStats {
  const sp = START_POINTS.find((s) => s.id === id)!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  frames.set(id, frame);
  const display = sectorLayout(W, H, CONVEX_C35, DEPTH, DISPLAY_MARGIN_PX);
  const sim = {
    transducer: CONVEX_C35,
    profile: CONVEX_C35_PROFILE,
    bmode: { depthMm: DEPTH, focusMm: FOCUS, dynamicRangeDb: 60 },
    anatomy,
    frame,
    pose,
    sample: engine.sample,
    renderer: { display },
  } as unknown as Simulator;
  const tissueAt = (theta: number, r: number): Tissue =>
    anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, theta, r), engine.sample).tissue;
  // envolvente: moteado ideal en el hígado, ×0,1 en cualquier otro tejido (rejilla de 0,5 mm)
  const gain = new Float32Array(speckle.data.length).fill(1);
  for (let u = 0; u < G.lines; u++)
    for (let k = 0; k < NR; k++) {
      if (tissueAt(thetaOf(u), (k + 0.5) * GRID_MM) === Tissue.Liver) continue;
      for (let v = Math.ceil((k * GRID_MM * G.samples) / DEPTH - 0.5); v < Math.ceil(((k + 1) * GRID_MM * G.samples) / DEPTH - 0.5); v++)
        if (v >= 0 && v < G.samples) gain[v * G.lines + u] = 0.1;
    }
  const env = { ...speckle, data: Float32Array.from(speckle.data, (x, i) => x * gain[i]) };
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const b = pixelToBeam(display, CONVEX_C35, DEPTH, x, y);
      if (!b) continue;
      const t = tissueAt(b.theta, b.r);
      gray[y * W + x] =
        t === Tissue.Liver
          ? 100
          : t === Tissue.Blood
            ? 0
            : t === Tissue.VesselWallThin || t === Tissue.VesselWallPortal
              ? 180
              : t === Tissue.LiverCapsule || t === Tissue.Diaphragm || t === Tissue.RenalCapsule
                ? FACE_GRAY
                : 60;
    }
  const img = { width: W, height: H, gray };
  planes.set(id, { sim, env, img, gain });
  return fidelityStats(sim, env, img, { samples: true });
}

const subxiphoid = measure('subxiphoid');
const intercostal = measure('intercostal');
const renal = measure('renal');

describe('banco de fidelidad sobre la anatomía del sano, sin GPU', () => {
  it('la envolvente se mide solo en hígado: el moteado ideal sale ideal aunque el resto esté a ×0,1', () => {
    for (const s of [subxiphoid, intercostal]) {
      expect(s.envelope.patches).toBeGreaterThan(10);
      expect(s.envelope.snr).toBeGreaterThan(1.8);
      expect(s.envelope.snr).toBeLessThan(2.1);
      expect(s.envelope.darkFraction).toBeGreaterThan(0.055);
      expect(s.envelope.darkFraction).toBeLessThan(0.085);
      expect(s.envelope.crackIndex).toBeLessThan(0.1);
    }
    const band = subxiphoid.bands.find((b) => b.patches > 5)!;
    expect(band.beamFwhmMm).toBeCloseTo(lateralFwhmMm(band.depthMm, FOCUS, CONVEX_C35_PROFILE.beam), 10);
  });

  it('la máscara de la imagen cae en hígado puro y el perfil plano no tiene pendiente', () => {
    for (const s of [subxiphoid, intercostal]) {
      const d = s.display!;
      expect(d.liver.pixels).toBeGreaterThan(500);
      expect(d.liver.p50).toBe(100);
      expect(Math.abs(d.liver.mean - 100)).toBeLessThan(3);
      expect(Math.abs(d.profile.slopeDbPerCm)).toBeLessThan(0.1);
      expect(d.colorOn).toBe(false);
      // la luz pintada a 0 y el diafragma a 200: el centro de la luz y la saturación los encuentran
      expect(d.lumen.pixels).toBeGreaterThan(50);
      expect(d.lumen.p50).toBe(0);
      if (Number.isFinite(d.diaphragmSaturated)) expect(d.diaphragmSaturated).toBe(0);
    }
  });

  it('encuentra las paredes anteriores con su incidencia real y da el cociente pintado', () => {
    // subxifoidea: la mayoría a 20–40°; intercostal: la VH cruza oblicua (20–60°), ninguna a < 20°
    const sub = subxiphoid.display!.walls.find((b) => b.fromDeg === 20)!;
    expect(sub.walls).toBeGreaterThan(20);
    expect(sub.ratio).toBeCloseTo(1.8, 5);
    expect(sub.deltaDb).toBeGreaterThan(10);
    const oblique = intercostal.display!.walls.filter((b) => b.fromDeg >= 20);
    expect(oblique.reduce((n, b) => n + b.walls, 0)).toBeGreaterThan(20);
    for (const b of oblique) expect(b.ratio).toBeCloseTo(1.8, 5);
  });

  it('el banco de interfaces encuentra la porta, la cápsula, el diafragma y Morison con su cara pintada', () => {
    const all = [subxiphoid, intercostal, renal].map((s) => s.display!);
    const walls = (pick: (d: (typeof all)[number]) => { walls: number; ratio: number }[]) =>
      all.flatMap((d) => pick(d)).filter((b) => b.walls > 0);
    // subxifoidea: porta y diafragma; subxifoidea e intercostal: cápsula bajo la pared; intercostal:
    // Morison (hígado → grasa perirrenal → cápsula renal). La ventana renal ve el riñón por detrás y el
    // hígado debajo: allí Morison va en el otro orden y el banco no lo cuenta.
    const n = (bins: { walls: number }[]) => bins.reduce((a, b) => a + b.walls, 0);
    expect(n(walls((d) => d.wallSystems.portal))).toBeGreaterThan(10);
    expect(n(walls((d) => d.capsule))).toBeGreaterThan(50);
    expect(n(walls((d) => d.diaphragm))).toBeGreaterThan(5);
    expect(n(walls((d) => d.renalCapsule))).toBeGreaterThan(5);
    // la tabla histórica es la suma de VCI y suprahepáticas
    for (const d of all) d.walls.forEach((b, j) => expect(b.walls).toBe(d.wallSystems.ivc[j].walls + d.wallSystems.hepaticVein[j].walls));
    // la cara pintada a 200 sobre el hígado a 100: cociente 2 en todas las caras de órgano
    for (const b of [...walls((d) => d.capsule), ...walls((d) => d.diaphragm), ...walls((d) => d.renalCapsule)])
      expect(b.ratio).toBeCloseTo(FACE_GRAY / 100, 5);
    // sin la transmisión de la GPU no hay espejo con el que comparar: el desfase es NaN, no un 0 falso
    for (const b of subxiphoid.display!.diaphragm.filter((x) => x.walls > 0)) expect(b.mirrorOffsetMm).toBeNaN();
    expect(subxiphoid.faceSamples!.length).toBeGreaterThan(100);
  });

  it('la incidencia del diafragma es la de la normal de la cúpula en el cruce exacto con la pleura', () => {
    // normal geométrica de la superficie z = altura(x, y) de la cúpula, sin pasar por `faceSdf`
    const frame = frames.get('subxiphoid')!;
    const samples = subxiphoid.faceSamples!.filter((f) => f.kind === 'diaphragm');
    expect(samples.length).toBeGreaterThan(5);
    for (const f of samples) {
      const theta = thetaOf(f.u);
      const at = (r: number) => anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, theta, r), engine.sample);
      // primer pulmón tras el borde (pasos de 0,05 mm) y bisección hasta el cruce
      let hi = f.rb;
      while (at(hi).tissue !== Tissue.Lung) hi += 0.05;
      let lo = hi - 0.05;
      for (let i = 0; i < 30; i++) {
        const mid = 0.5 * (lo + hi);
        if (at(mid).tissue === Tissue.Lung) hi = mid;
        else lo = mid;
      }
      const m = at(hi).material;
      const h = 1e-3;
      const zd = (x: number, y: number): number => diaphragmHeight(x, y, scene.diaphragm, scene.torso);
      const n = [(zd(m[0] + h, m[1]) - zd(m[0] - h, m[1])) / (2 * h), (zd(m[0], m[1] + h) - zd(m[0], m[1] - h)) / (2 * h), -1];
      const d = lineDirection(frame, theta);
      const cos = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / Math.hypot(n[0], n[1], n[2]);
      expect(Math.abs(f.incidenceDeg - (Math.acos(Math.min(1, cos)) * 180) / Math.PI), `línea ${f.u}`).toBeLessThan(0.5);
    }
  });

  it('la guarda de Rayleigh solo mide hígado a ≥ 6 mm de todo, vasos incluidos: el moteado ideal sale ideal', () => {
    // la misma máscara que la envolvente del banco (`clearLiverGrid`), con todas las muestras del parche
    for (const id of ['subxiphoid', 'intercostal'] as const) {
      const { sim, env } = planes.get(id)!;
      const s = speckleStats(sim, env);
      expect(s.patches, id).toBeGreaterThan(200);
      expect(s.snr, id).toBeGreaterThan(1.9);
      expect(s.snr, id).toBeLessThan(2.1);
    }
  });
  it('el espejo de la pasada A queda en el cruce exacto: el suelo del desfase baja de ~1 mm a < 0,01 mm', () => {
    // A0 halla el primer segmento grueso de pulmón (paso 180/160 = 1,125 mm) y la bisección de 6 pasos lo
    // lleva al cruce (decisión 57): |espejo − pleura| ≤ 0,009 mm. `mirrorFloorMm` lo emula en la CPU; una
    // GPU que coloca el espejo así mide justo ese suelo, y una que lo deja en el centro del segmento (la
    // marcha gruesa de antes) se aparta hasta un paso y no pasa la puerta de 0,05 mm del banco.
    const step = DEPTH / COARSE_DEPTH;
    const samples = subxiphoid.faceSamples!.filter((f) => f.kind === 'diaphragm');
    expect(samples.length).toBeGreaterThan(5);
    for (const f of samples) {
      expect(f.mirrorFloorMm, `línea ${f.u}`).toBeGreaterThanOrEqual(0);
      expect(f.mirrorFloorMm, `línea ${f.u}`).toBeLessThan(0.01);
    }
    // transmisión de la GPU simulada, sin penumbra: el espejo de A0 (bisección) o el de la marcha gruesa
    const { sim, env, img } = planes.get('subxiphoid')!;
    const frame = frames.get('subxiphoid')!;
    const withMirror = (exact: boolean): TransmissionFrame => {
      const n = G.lines * COARSE_DEPTH;
      const tx: TransmissionFrame = {
        lines: G.lines,
        samples: COARSE_DEPTH,
        single: new Float32Array(n).fill(1),
        aperture: new Float32Array(n).fill(1),
        mirrorHit: new Float32Array(n).fill(-1),
      };
      for (let u = 0; u < G.lines; u++) {
        const isLung = (r: number) =>
          anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, thetaOf(u), r), engine.sample).tissue === Tissue.Lung;
        for (let s = 0; s < COARSE_DEPTH; s++) {
          const r = (s + 0.5) * step;
          if (!isLung(r)) continue;
          tx.mirrorHit[(COARSE_DEPTH - 1) * G.lines + u] = exact ? mirrorCrossing(isLung, r, step) : r;
          break;
        }
      }
      return tx;
    };
    const diaphragm = (tx: TransmissionFrame) => fidelityStats(sim, env, img, { samples: true, transmission: tx });
    const exact = diaphragm(withMirror(true));
    const gpu = exact.faceSamples!.filter((f) => f.kind === 'diaphragm');
    expect(gpu.length).toBe(samples.length);
    for (const f of gpu) expect(f.mirrorOffsetMm, `línea ${f.u}`).toBeCloseTo(f.mirrorFloorMm!, 4);
    for (const b of exact.display!.diaphragm.filter((x) => x.walls > 0)) expect(b.mirrorOffsetMm).toBeLessThan(0.01);
    const coarse = diaphragm(withMirror(false)).display!.diaphragm.filter((x) => x.walls > 0);
    expect(Math.max(...coarse.map((b) => b.mirrorOffsetMm))).toBeGreaterThan(0.5);
  });

  it('cada muestra de los parches de Rayleigh es hígado a ≥ 6 mm del borde del hígado en 3D y del borde del sector', () => {
    // La rejilla solo ve el plano: con ella sola entraban parches a 4,5–5 mm de una frontera del hígado
    // fuera del plano (3 en la subxifoidea y 2 en la intercostal) y junto al borde del sector, que
    // contaba como hígado. La máscara exige además la `boundaryDistance` de cada muestra.
    for (const id of ['subxiphoid', 'intercostal'] as const) {
      const { sim, env } = planes.get(id)!;
      const frame = frames.get(id)!;
      const inside = speckleMask(sim, env);
      const { axial: AX, lateral: LAT } = SPECKLE_PATCH;
      const dTheta = (2 * CONVEX_C35.halfSector) / G.lines;
      let patches = 0;
      for (let u0 = 0; u0 + LAT <= G.lines; u0 += LAT)
        for (let v0 = 0; v0 + AX <= G.samples; v0 += AX) {
          let ok = true;
          for (let u = u0; ok && u < u0 + LAT; u++) for (let v = v0; ok && v < v0 + AX; v++) if (!inside(u, v)) ok = false;
          if (!ok) continue;
          patches++;
          for (let u = u0; u < u0 + LAT; u++)
            for (let v = v0; v < v0 + AX; v++) {
              const r = ((v + 0.5) / G.samples) * DEPTH;
              const q = anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, thetaOf(u), r), engine.sample);
              expect(q.tissue, `${id} (${u}, ${v})`).toBe(Tissue.Liver);
              expect(q.boundaryDistance, `${id} (${u}, ${v})`).toBeGreaterThanOrEqual(SPECKLE_CLEARANCE_MM);
              const arc = (CONVEX_C35.curvatureRadius + r) * dTheta;
              expect(Math.min(u + 1, G.lines - u) * arc, `${id} (${u}, ${v})`).toBeGreaterThan(SPECKLE_CLEARANCE_MM);
            }
        }
      expect(patches, id).toBe(speckleStats(sim, env).patches);
      expect(patches, id).toBeGreaterThan(200);
    }
  });
});

/**
 * El banco con las tres miradas del anillo (decisión 58), sin GPU: la mirada 0 es el moteado de arriba y las
 * dirigidas, moteados independientes con el mismo ×0,1 fuera del hígado; el compuesto, el gemelo de K
 * (`compoundEnvelope`, con la cobertura de cada mirada). Transmisión 1 en todas (sin sombras) salvo donde
 * se pide lo contrario.
 */
describe('banco de fidelidad con las tres miradas del anillo, sin GPU', () => {
  const thetas = COMPOUND.order.map((_, i) => lookTheta(i));
  const others = [8, 9].map((seed) => detect(G, psf(G, whiteField(G, seed), 1.5, 1.0), Math.hypot));
  const tx = (aperture: number): TransmissionFrame => {
    const n = G.lines * COARSE_DEPTH;
    return {
      lines: G.lines,
      samples: COARSE_DEPTH,
      single: new Float32Array(n).fill(1),
      aperture: new Float32Array(n).fill(aperture),
      mirrorHit: new Float32Array(n).fill(-1),
    };
  };
  function withLooks(id: StartPoint['id'], look2Aperture = 1): FidelityStats {
    const { sim, env, img, gain } = planes.get(id)!;
    const envelopes = [env, ...others.map((o) => ({ ...o, data: Float32Array.from(o.data, (x, i) => x * gain[i]) }))];
    const data = compoundEnvelope(
      thetas.map((theta, i) => ({ theta, data: envelopes[i].data })),
      {
        lines: G.lines,
        samples: G.samples,
        depthMm: DEPTH,
        halfSector: CONVEX_C35.halfSector,
        curvatureRadius: CONVEX_C35.curvatureRadius,
      },
    );
    return fidelityStats(sim, { ...env, data }, img, {
      looks: { thetas, envelopes, transmissions: [tx(1), tx(1), tx(look2Aperture)] },
    });
  }
  const sub = withLooks('subxiphoid');

  it('miradas independientes: ρ ≈ 0, N_eff ≈ 3, la SNR sube √N_eff y el grano no cambia', () => {
    const c = sub.compound!;
    const bands = c.bands.filter((b) => b.compound.patches >= 5);
    expect(bands.length).toBeGreaterThan(0);
    for (const b of bands) {
      const tag = JSON.stringify({
        r0: b.r0,
        rho: [b.rho0p, b.rho0m, b.rhoPm],
        nEff: b.nEff,
        gain: b.snrGain,
        grain: [b.grainRatioLateral, b.grainRatioAxial],
      });
      for (const r of [b.rho0p, b.rho0m, b.rhoPm]) expect(Math.abs(r), tag).toBeLessThan(0.1);
      expect(b.nEff, tag).toBeGreaterThan(2.5);
      expect(b.nEff, tag).toBeLessThanOrEqual(3.3);
      expect(Math.abs(b.snrGain / Math.sqrt(b.nEff) - 1), tag).toBeLessThan(0.1);
      expect(b.grainRatioLateral, tag).toBeGreaterThan(0.9);
      expect(b.grainRatioLateral, tag).toBeLessThan(1.1);
      expect(b.grainRatioAxial, tag).toBeGreaterThan(0.9);
      expect(b.grainRatioAxial, tag).toBeLessThan(1.1);
      expect(b.compound.darkFraction, tag).toBeLessThan(0.035);
      for (const t of b.perLook) expect(Math.abs(t.meanRatio - 1), tag).toBeLessThan(0.05);
      // la ley con β de ±7° y el grano medido: ρ(0,±) de 0,2 a 0,8 según la profundidad
      expect(b.law1, tag).toBeGreaterThan(b.law2);
    }
    for (const seam of c.seam)
      if (Number.isFinite(seam.ratio)) expect(Math.abs(seam.ratio - Math.sqrt(2 / 3)), JSON.stringify(seam)).toBeLessThan(0.08);
  });

  it('el hígado puro es el de las tres miradas: la sombra de una dirigida lo quita, sin la costura', () => {
    const one = subxiphoid.envelope.patches;
    expect(sub.envelope.patches).toBeGreaterThan(0);
    expect(sub.envelope.patches).toBeLessThanOrEqual(one);
    const shadowed = withLooks('subxiphoid', 0.5);
    expect(shadowed.envelope.patches).toBe(0);
    for (const b of shadowed.compound!.bands) expect(b.compound.patches).toBe(0);
    expect(shadowed.display!.liver.pixels).toBe(0);
    // con transmisión 1 en todo el plano (ninguna sombra en la pasada A), la umbra no se mide
    expect(sub.display!.shadow.umbraShiftMm).toBeNaN();
  });
});
