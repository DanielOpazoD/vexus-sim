// @tier slow
import { describe, expect, it } from 'vitest';
import { WALL_INTERIOR_MM, brightLines, fidelityStats, type BrightLines } from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { Interface } from '../anatomy/interfaces';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { probeContact } from '../probe/contact';
import { greyOfLevel, levelOfGrey } from '../ultrasound/greyMap';
import { DISPLAY_MARGIN_PX, DISPLAY_REF_DB, nominalTgcDbPerCm } from '../ultrasound/renderer';
import { pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import { ElevationAnchor, type SpeckleAnchorState } from '../ultrasound/speckleField';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { fatSeptum, muscleStriation, wallOrientation } from '../ultrasound/wallTexture';
import type { TwinFrame } from './support/compoundTwin';
import { B_MHZ, normalFrame, wallTwin, type WallModel, type WallTwinOut } from './support/wallTwin';

/**
 * Pared realista (decisión 62) con el gemelo A → B → C → D de la mirada 0 sobre la anatomía real
 * (`support/wallTwin.ts`), con sondas a incidencia normal en la línea central: subxifoidea (transversal,
 * recto), intercostal (longitudinal) y flanco (longitudinal, entre la 9.ª y la 10.ª costillas). Las métricas
 * son las del banco de la GPU (`app/fidelity.ts`, `display.wall`: `brightLines` sobre la mediana lateral de
 * 17 líneas centrales de la envolvente compensada), las mismas que el líder mide con GPU real. El modelo
 * `base` es la pared de antes (tres bandas de moteado uniforme sin caras): cada meta falla con él, así que
 * estas pruebas fallan en `main`.
 */
const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient);
const anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
const caliber = anatomy.caliberFor(engine.sample);
const t = scene.torso;
const WALL_MM = t.skinMm + t.fatMm + t.muscleMm;
const TGC = nominalTgcDbPerCm(B_MHZ);
/** 1,5× en amplitud. */
const RATIO_15_DB = 20 * Math.log10(1.5);
/**
 * Sin textura (con las caras), septos y estrías no pueden pasar de esto sobre su capa (dB): lo que quede es
 * la falda de los ecos de las fascias. Con las muestras a < `WALL_INTERIOR_MM` de una cara, el gemelo daba
 * 2,1–2,8 dB de «septos» y 0,3–4,7 dB de «estrías» sin textura alguna.
 */
const SKIRT_DB = 1.5;

const VIEWS = {
  subxiphoid: normalFrame(scene, Math.PI / 2 + 0.2, -20, false),
  intercostal: normalFrame(scene, Math.PI * 0.88, 8, true),
  flank: normalFrame(scene, Math.PI * 1.04, -14, true),
} as const;
type ViewId = keyof typeof VIEWS;
const anchorOf = (f: TwinFrame): SpeckleAnchorState => new ElevationAnchor().update(f.face, f.elevation);
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

const median = (a: readonly number[]): number => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : Number.NaN;
};

/** Métricas del banco de la pared sobre un parche del gemelo (definiciones de `wallStatsOf`). */
function metrics(o: WallTwinOut): Metrics {
  const nR = o.i1 - o.i0 + 1;
  const dB = (i: number, jj: number): number => 20 * Math.log10(Math.max(o.env[i * o.nL + jj], 1e-12)) + (TGC * o.rowR(o.i0 + i)) / 10;
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
      const a0 = wallTwin(scene, caliber, f, st, { model: 'wall', noTransmission: true, ...opts });
      const b0 = wallTwin(scene, caliber, f, st, { model: 'base', noTransmission: true, ...opts });
      const now: number[] = [];
      const before: number[] = [];
      for (let k = 0; k < a0.env.length; k++) {
        const tk: Tissue = a0.tissue[k];
        if (tk !== tissue || a0.rowR(a0.i0 + Math.floor(k / a0.nL)) < WALL_MM + 6) continue;
        // sin transmisión, el mismo campo (la textura y las caras nuevas son solo de la pared): lo único que la pared
        // lleva debajo es su reverberación (decisión 76), a −50 dB bajo sus ecos: ≤ 1 % de la envolvente media del
        // tejido (≈ 1 sin transmisión), también en los puntos oscuros del moteado
        expect(Math.abs(a0.env[k] - b0.env[k])).toBeLessThanOrEqual(0.01);
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
});

// ——— El banco de la GPU sobre la envolvente del gemelo ———

const W = 800;
const H = 572;
const DEPTH = 180;

interface BenchOpts {
  noTexture?: boolean;
  noFaces?: readonly Interface[];
}
const benchRuns = new Map<string, ReturnType<typeof benchOnTwinUncached>>();
/** `benchOnTwinUncached`, una vez por pose y variante del gemelo. */
function benchOnTwin(id: StartPoint['id'], o: BenchOpts = {}) {
  const key = `${id}/${o.noTexture ?? false}/${(o.noFaces ?? []).join(',')}`;
  let d = benchRuns.get(key);
  if (!d) {
    d = benchOnTwinUncached(id, o);
    benchRuns.set(key, d);
  }
  return d;
}

/** `fidelityStats` en la pose de partida con la envolvente del gemelo y la imagen de su cadena de grises. */
function benchOnTwinUncached(id: StartPoint['id'], bo: BenchOpts) {
  const sp = START_POINTS.find((s) => s.id === id)!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const f: TwinFrame = {
    center: frame.curvatureCenter,
    axial: frame.axial,
    lateral: frame.lateral,
    elevation: frame.elevation,
    face: frame.face,
  };
  const o = wallTwin(scene, caliber, f, anchorOf(f), { model: 'wall', j0: 0, j1: CONVEX_C35.lines - 1, r0: 0, r1: DEPTH, ...bo });
  const samples = o.i1 - o.i0 + 1;
  const env = { lines: o.nL, samples, data: Float32Array.from(o.env) };
  const display = sectorLayout(W, H, CONVEX_C35, DEPTH, DISPLAY_MARGIN_PX);
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bm = pixelToBeam(display, CONVEX_C35, DEPTH, x, y);
      if (!bm) continue;
      const u = Math.min(
        o.nL - 1,
        Math.max(0, Math.round(((bm.theta + CONVEX_C35.halfSector) / (2 * CONVEX_C35.halfSector)) * o.nL - 0.5)),
      );
      const v = Math.min(samples - 1, Math.max(0, Math.round(bm.r / o.dr - 0.5)));
      // cadena de la imagen: ganancia 0, compensación nominal (techo 50 dB), referencia y 70 dB de rango
      const db = 20 * Math.log10(Math.max(o.env[v * o.nL + u], 1e-7)) + Math.min(50, (TGC * bm.r) / 10) + DISPLAY_REF_DB;
      gray[y * W + x] = Math.round(255 * greyOfLevel(Math.min(1, Math.max(0, (db + 70) / 70))));
    }
  const sim = {
    transducer: CONVEX_C35,
    profile: CONVEX_C35_PROFILE,
    bmode: { depthMm: DEPTH, focusMm: 90, dynamicRangeDb: 70 },
    anatomy,
    scene,
    frame,
    pose,
    // el acoplamiento de las líneas (decisión 63); la anatomía y el marco de este gemelo son los del tronco rígido
    contact: probeContact(pose, CONVEX_C35, scene.torso),
    sample: engine.sample,
    renderer: { display },
  } as unknown as Simulator;
  return fidelityStats(sim, env, { width: W, height: H, gray }).display!;
}

describe('banco de la pared de la GPU (display.wall) sobre el gemelo en las poses de partida', () => {
  it('subxifoidea y flanco: líneas, lóbulos oscuros, septos, estrías y cortical en las metas', () => {
    for (const id of ['subxiphoid', 'flank'] as const) {
      const d = benchOnTwin(id);
      const w = d.wall;
      const msg = `${id}: ${JSON.stringify({ ...w, profileDb: undefined })}, hígado ${d.liver.p50}`;
      // la cadena de grises deja el hígado a media escala, como en la GPU
      expect(d.liver.p50, msg).toBeGreaterThan(85);
      expect(d.liver.p50, msg).toBeLessThan(120);
      expect(w.profileLines, msg).toBeGreaterThanOrEqual(5);
      expect(w.linesInside, msg).toBeGreaterThanOrEqual(3);
      expect(w.fatToLiver, msg).toBeLessThanOrEqual(0.6);
      expect(w.septumDb, msg).toBeGreaterThanOrEqual(RATIO_15_DB);
      expect(w.striationDb, msg).toBeGreaterThanOrEqual(RATIO_15_DB);
      if (id === 'flank') {
        expect(w.ribLines, msg).toBeGreaterThan(5);
        expect(w.ribPeakDb, msg).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('las líneas de la pared a incidencia normal: gris-blancas, sin saturar, bajo la cortical y variando a lo largo', () => {
    // Capturas con GPU (25-09-2026): con σz 0,05 las fascias y el peritoneo eran líneas blancas uniformes, +15–29 dB
    // sobre el hígado y saturadas como la pleura y la cortical. Gemelo con σz 0,075: 8,1 / 9,2 / 6,4 / 13,7 dB en
    // las cuatro vistas, 0–0,2 % de picos saturados y un CV del pico a lo largo de cada línea de 55–73 %.
    for (const id of ['subxiphoid', 'intercostal', 'flank', 'renal'] as const) {
      const w = benchOnTwin(id).wall;
      const msg = `${id}: ${JSON.stringify({ lineLevelDb: w.lineLevelDb, lineSaturated: w.lineSaturated, lineCv: w.lineCv })}`;
      expect(w.lineLevelDb, msg).toBeGreaterThanOrEqual(4);
      expect(w.lineLevelDb, msg).toBeLessThanOrEqual(16);
      expect(w.lineSaturated, msg).toBeLessThanOrEqual(0.01);
      expect(w.lineCv, msg).toBeGreaterThanOrEqual(0.3);
      if (id === 'flank') expect(w.ribPeakDb - w.lineLevelDb, msg).toBeGreaterThanOrEqual(6);
    }
  });

  it('septos y estrías del banco: sin textura, con las caras, < 1,5 dB (no cuentan la falda de las fascias)', () => {
    for (const id of ['subxiphoid', 'flank'] as const) {
      const w = benchOnTwin(id, { noTexture: true }).wall;
      const msg = `${id}: ${JSON.stringify({ ...w, profileDb: undefined })}`;
      expect(w.septumSamples, msg).toBeGreaterThan(50);
      expect(w.striationSamples, msg).toBeGreaterThan(50);
      expect(w.septumDb, msg).toBeLessThan(SKIRT_DB);
      expect(w.striationDb, msg).toBeLessThan(SKIRT_DB);
    }
  });

  it('la cápsula bajo la pared no mide el peritoneo: la línea de los dos va aparte y la cápsula sola sigue brillando', () => {
    for (const id of ['subxiphoid', 'flank'] as const) {
      const d = benchOnTwin(id);
      const msg = `${id}: ${JSON.stringify({ capsule: d.capsule, peritoneum: d.peritoneum })}`;
      // la grasa preperitoneal y el peritoneo están siempre encima de la cápsula, dentro de su ventana: la
      // cápsula sola no tiene registros bajo la pared (antes de separarlos, la puerta de la cápsula medía
      // esta línea: 64 registros a 0–20° en la subxifoidea)
      expect(
        d.capsule.reduce((a, b) => a + b.walls, 0),
        msg,
      ).toBe(0);
      const line = d.peritoneum[0];
      expect(line.walls, msg).toBeGreaterThanOrEqual(20);
      // la línea del peritoneo y la cápsula, en el rango de la cápsula de la decisión 57 (referencias
      // 1,3–2,1 a 0–20°): el peritoneo de la decisión 62 no la blanquea (con σz 0,04 y s 0,3, 2,27–2,40)
      expect(line.ratio, msg).toBeGreaterThanOrEqual(1.4);
      expect(line.ratio, msg).toBeLessThanOrEqual(2.1);
      // sin la cara del peritoneo, los mismos registros miden la cápsula sola: la cara de la decisión 57
      // sigue ahí bajo la pared
      const alone = benchOnTwin(id, { noFaces: [Interface.Peritoneum] }).peritoneum[0];
      expect(alone.walls, msg).toBe(line.walls);
      expect(alone.ratio, `${msg}, sola ${JSON.stringify(alone)}`).toBeGreaterThanOrEqual(1.4);
      // y sin ninguna de las dos, la línea desaparece: la puerta mide esas dos caras y nada más
      const none = benchOnTwin(id, { noFaces: [Interface.Peritoneum, Interface.LiverCapsule] }).peritoneum[0];
      expect(none.ratio, `${msg}, sin caras ${JSON.stringify(none)}`).toBeLessThan(1.3);
    }
  });
});
