// @tier slow
import { describe, expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { WALL_INTERIOR_MM, brightLines, type BrightLines } from '../app/fidelity';
import { START_POINTS } from '../app/startPoints';
import type { Vec3 } from '../core/vec3';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { focalGain } from '../ultrasound/beamEcho';
import { greyOfLevel, levelOfGrey } from '../ultrasound/greyMap';
import { ElevationAnchor, type SpeckleAnchorState } from '../ultrasound/speckleField';
import { fatSeptum, muscleStriation, wallOrientation } from '../ultrasound/wallTexture';
import { TWIN_GEOMETRY as G, type TwinFrame } from './support/compoundTwin';
import { RATIO_15_DB, SKIRT_DB, TGC, WALL_MM, caliber, engine, scene, t } from './support/wallFixture';
import { normalFrame, wallTwin, type WallModel, type WallTwinOut } from './support/wallTwin';

// Tiny measurement helpers stay in the test harness, outside production coverage.
const anchorOf = (f: TwinFrame): SpeckleAnchorState => new ElevationAnchor().update(f.face, f.elevation, 0);
const median = (a: readonly number[]): number => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : Number.NaN;
};

const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * Pared realista (decisión 62) con el gemelo A → B → C → D de la mirada 0 sobre la anatomía real
 * (`support/wallTwin.ts`), con sondas a incidencia normal en la línea central: subxifoidea (transversal,
 * recto), intercostal (longitudinal) y flanco (longitudinal, entre la 9.ª y la 10.ª costillas). Las métricas
 * son las del banco de la GPU (`app/fidelity.ts`, `display.wall`: `brightLines` sobre la mediana lateral de
 * 17 líneas centrales de la envolvente compensada), las mismas que el líder mide con GPU real. El modelo
 * `base` es la pared de antes (tres bandas de moteado uniforme sin caras): cada meta falla con él, así que
 * estas pruebas fallan en `main`.
 */
const VIEWS = {
  subxiphoid: normalFrame(scene, Math.PI / 2 + 0.2, -20, false),
  intercostal: normalFrame(scene, Math.PI * 0.88, 8, true),
  flank: normalFrame(scene, Math.PI * 1.04, -14, true),
} as const;
type ViewId = keyof typeof VIEWS;
const J0 = 40;
const J1 = 151;
const CENTER = 95;

interface Metrics {
  lines: BrightLines;
  inside: number;
  liverDb: number;
  /** Gris del interior de los lóbulos con el hígado a 100 (70 dB, como la imagen). */
  lobuleGray: number;
  fatDb: number;
  septumDb: number;
  striationDb: number;
  ribDb: number;
  ribLines: number;
}

/** Métricas del banco de la pared sobre un parche del gemelo (definiciones de `wallStatsOf`). */
function metrics(o: WallTwinOut): Metrics {
  const nR = o.i1 - o.i0 + 1;
  // compensada como en el banco (`envelopeLine`): la atenuación nominal y la ganancia focal de la emisión (decisión 84)
  const dB = (i: number, jj: number): number => {
    const r = o.rowR(o.i0 + i);
    return 20 * Math.log10(Math.max(o.env[i * o.nL + jj], 1e-12)) + (TGC * r) / 10 - 20 * Math.log10(focalGain(r, G.focusMm, G.beam));
  };
  // hígado de referencia: sin hueso ni pulmón delante, 5 mm bajo la pared
  const liver: number[] = [];
  for (let jj = 0; jj < o.nL; jj++) {
    let shadow = false;
    for (let i = 0; i < nR; i++) {
      const tt: Tissue = o.tissue[i * o.nL + jj];
      if (tt === Tissue.Bone || tt === Tissue.Lung) shadow = true;
      if (!shadow && tt === Tissue.Liver && o.rowR(o.i0 + i) > WALL_MM + 5) liver.push(dB(i, jj));
    }
  }
  const liverDb = median(liver);
  const c = CENTER - o.j0;
  const profile: number[] = [];
  for (let i = 0; i < nR && o.rowR(o.i0 + i) <= WALL_MM + 1; i++) {
    const v: number[] = [];
    for (let jj = c - 8; jj <= c + 8; jj++) v.push(dB(i, jj));
    profile.push(median(v) - liverDb);
  }
  const lines = brightLines(profile, o.dr);
  const grey = (x: number): number => 255 * greyOfLevel(Math.min(1, Math.max(0, levelOfGrey(100 / 255) + (x - liverDb) / 70)));
  const lob: number[] = [];
  const fatLayer: number[] = [];
  const sep: number[] = [];
  const musLayer: number[] = [];
  const str: number[] = [];
  const rib: number[] = [];
  for (let jj = 0; jj < o.nL; jj++) {
    let ib = -1;
    for (let i = 0; i < nR; i++) {
      const tt: Tissue = o.tissue[i * o.nL + jj];
      if (tt === Tissue.Bone) {
        ib = i;
        break;
      }
      const p = o.point(o.i0 + i, o.j0 + jj);
      const q = scene.classify(p, caliber);
      const sub = tt === Tissue.Fat && [Interface.SkinFat, Interface.Scarpa, Interface.DeepFascia].includes(q.interface);
      if (!sub && tt !== Tissue.Muscle) continue;
      const tex = sub ? fatSeptum(p, t) : muscleStriation(p, t);
      // lejos de toda cara: la falda axial de un eco de fascia no cuenta como septo ni como capa
      if (q.interfaceDistance < WALL_INTERIOR_MM) continue;
      (sub ? fatLayer : musLayer).push(dB(i, jj));
      if (tex[3] < 0.05 && sub) lob.push(dB(i, jj));
      else if (tex[3] > 0.7 && wallOrientation([tex[0], tex[1], tex[2]], o.dir(o.j0 + jj)) > 0.7) (sub ? sep : str).push(dB(i, jj));
    }
    if (ib < 0) continue;
    let pk = -Infinity;
    for (let i = Math.max(0, ib - Math.round(1.5 / o.dr)); i <= Math.min(nR - 1, ib + Math.round(0.5 / o.dr)); i++)
      pk = Math.max(pk, dB(i, jj));
    rib.push(pk - liverDb);
  }
  return {
    lines,
    inside: lines.depthsMm.filter((d) => d >= 0.5 && d <= WALL_MM - 1).length,
    liverDb,
    lobuleGray: grey(median(lob)),
    fatDb: median(lob) - liverDb,
    septumDb: median(sep) - median(fatLayer),
    striationDb: median(str) - median(musLayer),
    ribDb: median(rib),
    ribLines: rib.length,
  };
}

const runs = new Map<string, { out: WallTwinOut; m: Metrics }>();
function run(view: ViewId, model: WallModel, noTexture = false): { out: WallTwinOut; m: Metrics } {
  const key = `${view}/${model}/${noTexture}`;
  let r = runs.get(key);
  if (!r) {
    const f = VIEWS[view];
    const out = wallTwin(scene, caliber, f, anchorOf(f), { model, j0: J0, j1: J1, r0: 0, r1: 95, noTexture });
    r = { out, m: metrics(out) };
    runs.set(key, r);
  }
  return r;
}
const tag = (m: Metrics): string =>
  JSON.stringify({ ...m, lines: m.lines.depthsMm.map((d, k) => `${d.toFixed(1)} mm +${m.lines.excessDb[k].toFixed(1)}`) });

describe('pared realista con el gemelo de la imagen (decisión 62)', () => {
  it('apnea espiratoria: el marco material es el del mundo (el gemelo no deforma)', () => {
    expect(Math.abs(engine.sample.resp.diaphragmCaudalMm)).toBeLessThan(1e-6);
  });

  it('≥ 3 líneas brillantes distintas dentro de la pared (≥ +6 dB sobre la mediana local); antes, a lo sumo una', () => {
    for (const view of Object.keys(VIEWS) as ViewId[]) {
      const now = run(view, 'wall').m;
      const before = run(view, 'base').m;
      expect(now.inside, `${view}: ${tag(now)}`).toBeGreaterThanOrEqual(3);
      expect(now.lines.count, view).toBeGreaterThanOrEqual(4);
      // hoy: la piel (con el transitorio) y la cápsula bajo la pared, fuera del tramo interior
      expect(before.inside, `${view} antes: ${tag(before)}`).toBeLessThanOrEqual(1);
    }
  });

  it('grasa: el interior de los lóbulos, ≤ 0,6 × el gris del hígado; los septos, ≥ 1,5× la mediana de su capa', () => {
    for (const view of Object.keys(VIEWS) as ViewId[]) {
      const now = run(view, 'wall').m;
      const before = run(view, 'base').m;
      expect(now.fatDb, `${view}: ${tag(now)}`).toBeLessThan(0);
      expect(now.lobuleGray, `${view}: ${tag(now)}`).toBeLessThanOrEqual(60);
      expect(now.septumDb, `${view}: ${tag(now)}`).toBeGreaterThanOrEqual(RATIO_15_DB);
      // antes: la grasa uniforme a 0,55 (≈ 80 de gris) y sin septos
      expect(before.lobuleGray, view).toBeGreaterThan(70);
      expect(before.septumDb, view).toBeLessThan(RATIO_15_DB);
    }
  });

  it('músculo: las estrías del perimisio, ≥ 1,5× la mediana de su capa', () => {
    for (const view of Object.keys(VIEWS) as ViewId[]) {
      const now = run(view, 'wall').m;
      expect(now.striationDb, `${view}: ${tag(now)}`).toBeGreaterThanOrEqual(RATIO_15_DB);
      expect(run(view, 'base').m.striationDb, view).toBeLessThan(RATIO_15_DB);
    }
  });

  it('septos y estrías miden la textura, no la falda de las caras: sin textura, con las caras, < 1,5 dB', () => {
    for (const view of Object.keys(VIEWS) as ViewId[]) {
      const m = run(view, 'wall', true).m;
      expect(m.septumDb, `${view}: ${tag(m)}`).toBeLessThan(SKIRT_DB);
      expect(m.striationDb, `${view}: ${tag(m)}`).toBeLessThan(SKIRT_DB);
      // las caras siguen ahí: las líneas de la pared no dependen de la textura
      expect(m.inside, `${view}: ${tag(m)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('cortical costal: pico ≥ +15 dB sobre el hígado en las costillas del flanco, con su sombra', () => {
    const now = run('flank', 'wall').m;
    const before = run('flank', 'base').m;
    expect(now.ribLines, tag(now)).toBeGreaterThan(20);
    expect(now.ribDb, tag(now)).toBeGreaterThanOrEqual(15);
    // antes: el moteado del hueso (0,9) tras la pérdida de entrada, sin cara
    expect(before.ribDb, tag(before)).toBeLessThan(15);
  });

  it('anclada: girar la sonda una línea sobre su centro de curvatura da la misma pared desplazada una línea', () => {
    const f = VIEWS.flank;
    const st = anchorOf(f);
    const d = (2 * CONVEX_C35.halfSector) / CONVEX_C35.lines;
    const rot = (a: Vec3, b: Vec3, s: number): Vec3 => [0, 1, 2].map((k) => a[k] * Math.cos(d) + s * b[k] * Math.sin(d)) as Vec3;
    const g: TwinFrame = { ...f, axial: rot(f.axial, f.lateral, 1), lateral: rot(f.lateral, f.axial, -1) };
    const opts = { model: 'wall' as const, r0: 0, r1: WALL_MM + 2, noTransient: true };
    const a = wallTwin(scene, caliber, f, st, { ...opts, j0: 81, j1: 111 });
    const b = wallTwin(scene, caliber, g, st, { ...opts, j0: 80, j1: 110 });
    // la línea j de la sonda girada es la j + 1 de la de partida: el mismo material, la misma pared
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    let n = 0;
    const va: number[] = [];
    for (let i = 0; i <= a.i1 - a.i0; i++)
      for (let jj = 0; jj < a.nL; jj++) {
        const x = Math.log(a.env[i * a.nL + jj]);
        const y = Math.log(b.env[i * b.nL + jj]);
        sab += x * y;
        saa += x * x;
        sbb += y * y;
        n++;
        va.push(x);
      }
    expect(sab / Math.sqrt(saa * sbb)).toBeGreaterThan(0.999);
    // y la pared no es uniforme: hay estructura que conservar
    const mean = va.reduce((s, x) => s + x, 0) / n;
    expect(Math.sqrt(va.reduce((s, x) => s + (x - mean) ** 2, 0) / n)).toBeGreaterThan(0.5);
  });

  it('el hígado y el riñón no cambian: el mismo campo bajo la pared, y la misma SNR con la transmisión', () => {
    // la ventana renal de partida (el riñón derecho en eje largo bajo el hígado)
    const sp = START_POINTS.find((x) => x.id === 'renal')!;
    const rf = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
    const renal: TwinFrame = { center: rf.curvatureCenter, axial: rf.axial, lateral: rf.lateral, elevation: rf.elevation, face: rf.face };
    for (const [f, tissue] of [
      [VIEWS.subxiphoid, Tissue.Liver],
      [renal, Tissue.RenalCortex],
    ] as const) {
      const st = anchorOf(f);
      const opts = { j0: 60, j1: 131, r0: WALL_MM + 4, r1: 130 };
      const aT = wallTwin(scene, caliber, f, st, { model: 'wall', ...opts });
      const bT = wallTwin(scene, caliber, f, st, { model: 'base', ...opts });
      // sin transmisión ni los ecos parásitos de la decisión 76, que llevan la pared debajo (las réplicas se miden abajo)
      const clean = { noTransmission: true, noReverb: true, noPedestal: true };
      const a0 = wallTwin(scene, caliber, f, st, { model: 'wall', ...clean, ...opts });
      const b0 = wallTwin(scene, caliber, f, st, { model: 'base', ...clean, ...opts });
      const now: number[] = [];
      const before: number[] = [];
      for (let k = 0; k < a0.env.length; k++) {
        const tk: Tissue = a0.tissue[k];
        if (tk !== tissue || a0.rowR(a0.i0 + Math.floor(k / a0.nL)) < WALL_MM + 6) continue;
        // sin transmisión, bit a bit el mismo campo (la textura y las caras nuevas son solo de la pared)
        expect(a0.env[k]).toBe(b0.env[k]);
        now.push(aT.env[k]);
        before.push(bT.env[k]);
      }
      expect(now.length, Tissue[tissue]).toBeGreaterThan(500);
      // con la transmisión, la misma estadística: la grasa preperitoneal atenúa algo menos que el músculo que
      // sustituye (+0,1–0,6 dB según la línea; tras la PSF lateral no es un factor por muestra)
      const stats = (a: number[]) => {
        const m = a.reduce((x, y) => x + y, 0) / a.length;
        return { mean: m, snr: m / Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) };
      };
      const sNow = stats(now);
      const sBefore = stats(before);
      expect(Math.abs(sNow.snr / sBefore.snr - 1), Tissue[tissue]).toBeLessThan(0.02);
      const gainDb = 20 * Math.log10(sNow.mean / sBefore.mean);
      expect(gainDb, Tissue[tissue]).toBeGreaterThan(0);
      expect(gainDb, Tissue[tissue]).toBeLessThan(0.8);
    }
  });

  it('decisión 88: bajo una costilla no queda ninguna cara (la línea que el juez ciego vio cruzar la costilla)', () => {
    // el flanco 12 mm más craneal, la pose de la pareja 6 de la ronda 4: en las líneas que cruzan hueso, lejos de su borde
    // (≥ 6 líneas: la PSF lateral lleva ahí la del tejido de al lado), nada entre la cara profunda de la costilla y 3 mm
    // más abajo (la transversalis, el peritoneo o la pleura) pasa de −30 dB del hígado, el negro de la imagen. Antes, con 6
    // dB de entrada, la cuerda fina del borde dejaba −16/−26 dB y el pedestal de la decisión 76 llevaba el peritoneo y la
    // pleura de las líneas vecinas a −10/−18 dB dentro de la sombra
    const sp = START_POINTS.find((x) => x.id === 'flank')!;
    const pf = probeFrame(
      { phi: sp.phi, z: sp.z + 12, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 },
      scene.torso,
      CONVEX_C35,
    );
    const f: TwinFrame = { center: pf.curvatureCenter, axial: pf.axial, lateral: pf.lateral, elevation: pf.elevation, face: pf.face };
    const o = wallTwin(scene, caliber, f, anchorOf(f), { model: 'wall', j0: 20, j1: 171, r0: 0, r1: 60 });
    const nR = o.i1 - o.i0 + 1;
    // lejos del borde de la costilla: a 3–5 líneas la PSF lateral aún lleva la cápsula de la línea vecina a −20 dB (la
    // borrosidad del borde, física); a ≥ 6 líneas (~3 mm), no
    const EDGE = 6;
    // el hígado de referencia, sin hueso delante
    const liver: number[] = [];
    const boneEnd = new Int32Array(o.nL).fill(-1);
    const tissueAt = (i: number, jj: number): Tissue => o.tissue[i * o.nL + jj];
    for (let jj = 0; jj < o.nL; jj++) {
      for (let i = 0; i < nR; i++) if (tissueAt(i, jj) === Tissue.Bone) boneEnd[jj] = i;
      if (boneEnd[jj] >= 0) continue;
      for (let i = 0; i < nR; i++) if (tissueAt(i, jj) === Tissue.Liver) liver.push(o.env[i * o.nL + jj]);
    }
    const ref = mean(liver);
    let lines = 0;
    let worst = -Infinity;
    let where = '';
    for (let jj = EDGE; jj < o.nL - EDGE; jj++) {
      let interior = true;
      for (let d = -EDGE; d <= EDGE; d++) if (boneEnd[jj + d] < 0) interior = false;
      if (!interior) continue;
      lines++;
      for (let i = boneEnd[jj] + 1; i <= Math.min(nR - 1, boneEnd[jj] + Math.round(3 / o.dr)); i++) {
        const e = 20 * Math.log10(o.env[i * o.nL + jj] / ref);
        if (e > worst) {
          worst = e;
          where = `línea ${o.j0 + jj}, ${o.rowR(o.i0 + i).toFixed(2)} mm, ${Tissue[o.tissue[i * o.nL + jj]]}`;
        }
      }
    }
    expect(liver.length).toBeGreaterThan(2000);
    expect(lines, 'líneas bajo las costillas').toBeGreaterThan(20);
    expect(worst, where).toBeLessThan(-30);
  });

  it('la reverberación de la pared (decisión 76), con la transmisión: ≤ −45 dB bajo la pared y ningún fantasma en la sombra costal', () => {
    // el flanco de partida: costillas dentro de la pared, con su sombra; las réplicas pagan la transmisión hasta W
    const sp = START_POINTS.find((x) => x.id === 'flank')!;
    const pf = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
    const flank: TwinFrame = { center: pf.curvatureCenter, axial: pf.axial, lateral: pf.lateral, elevation: pf.elevation, face: pf.face };
    for (const f of [VIEWS.subxiphoid, flank]) {
      const st = anchorOf(f);
      const opts = { j0: 40, j1: 151, r0: 0, r1: 110 };
      const a = wallTwin(scene, caliber, f, st, { model: 'wall', ...opts });
      const b = wallTwin(scene, caliber, f, st, { model: 'wall', noReverb: true, ...opts });
      let d2 = 0;
      let b2 = 0;
      let sum = 0;
      let n = 0;
      for (let k = 0; k < a.env.length; k++) {
        const tk: Tissue = a.tissue[k];
        if (a.rowR(a.i0 + Math.floor(k / a.nL)) < WALL_MM + 6 || tk !== Tissue.Liver) continue;
        d2 += (a.env[k] - b.env[k]) ** 2;
        b2 += b.env[k] ** 2;
        sum += b.env[k];
        n++;
      }
      expect(n).toBeGreaterThan(5000);
      expect(10 * Math.log10(d2 / b2)).toBeLessThan(-45);
      // sombra (envolvente sin réplicas < 2 % de la media del hígado en su entorno de ±3 líneas y ±1 mm) bajo la pared: las
      // réplicas no la encienden. Un nulo del moteado del hígado (una muestra suelta bajo el 2 %) no es sombra: la réplica
      // de −50 dB de la pared lo levantaba al 3,3 % en la subxifoidea, que no tiene costillas (decisión 88, con el relieve
      // nuevo de las capas)
      const rows = a.i1 - a.i0 + 1;
      const box = Math.round(1 / a.dr);
      const dark = (k: number): boolean => {
        const i = Math.floor(k / a.nL);
        const j = k % a.nL;
        let s = 0;
        let c = 0;
        for (let di = -box; di <= box; di++)
          for (let dj = -3; dj <= 3; dj++) {
            if (i + di < 0 || i + di >= rows || j + dj < 0 || j + dj >= a.nL) continue;
            s += b.env[(i + di) * a.nL + j + dj];
            c++;
          }
        return s / c < 0.02 * (sum / n);
      };
      let shadowA = 0;
      let shadowB = 0;
      let shadowN = 0;
      for (let k = 0; k < a.env.length; k++) {
        const tk: Tissue = a.tissue[k];
        if (a.rowR(a.i0 + Math.floor(k / a.nL)) < WALL_MM + 6 || b.env[k] >= 0.02 * (sum / n) || tk === Tissue.Lung || !dark(k)) continue;
        shadowA = Math.max(shadowA, a.env[k]);
        shadowB = Math.max(shadowB, b.env[k]);
        shadowN++;
      }
      if (f === flank) expect(shadowN, 'la sombra costal del flanco').toBeGreaterThan(200);
      // sin la transmisión de la pared, el eco de la costilla se copiaba en su propia sombra a 10–40 % de la media
      expect(shadowA / (sum / n), `sombra: ${shadowB.toExponential(2)} sin réplicas`).toBeLessThan(0.03);
    }
  });
});
