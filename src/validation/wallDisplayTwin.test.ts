// @tier slow
import { describe, expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { fidelityStats } from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { greyOfLevel } from '../ultrasound/greyMap';
import { DISPLAY_MARGIN_PX, DISPLAY_REF_DB } from '../ultrasound/renderer';
import { pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import { ElevationAnchor, type SpeckleAnchorState } from '../ultrasound/speckleField';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { type TwinFrame } from './support/compoundTwin';
import { wallTwin } from './support/wallTwin';

import { RATIO_15_DB, SKIRT_DB, TGC, anatomy, caliber, engine, scene } from './support/wallFixture';

// Tiny measurement helpers stay in the test harness, outside production coverage.
const anchorOf = (f: TwinFrame): SpeckleAnchorState => new ElevationAnchor().update(f.face, f.elevation, 0);
const median = (a: readonly number[]): number => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : Number.NaN;
};

const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

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

/**
 * La cara interna de la pared (`Interface.Peritoneum`) en la ventana renal, línea a línea (decisión 65): el exceso de
 * potencia de la envolvente a ±0,6 mm del cruce (el final del tramo de muestras de la cara: su dueño es la grasa de la
 * pared) sobre la del tejido a 1,5–4 mm a cada lado (dB; ~0 si no hay línea), según lo que hay detrás (el primer
 * tejido que no es la grasa de la pared): grasa retroperitoneal o perirrenal, o el hígado.
 */
function renalWallFace(noFacets: boolean): { fat: number[]; liver: number[] } {
  const sp = START_POINTS.find((s) => s.id === 'renal')!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const f: TwinFrame = {
    center: frame.curvatureCenter,
    axial: frame.axial,
    lateral: frame.lateral,
    elevation: frame.elevation,
    face: frame.face,
  };
  const o = wallTwin(scene, caliber, f, anchorOf(f), { model: 'wall', j0: 0, j1: CONVEX_C35.lines - 1, r0: 0, r1: 60, noFacets });
  const nR = o.i1 - o.i0 + 1;
  const pow = (i: number, jj: number): number => o.env[i * o.nL + jj] ** 2;
  const out = { fat: [] as number[], liver: [] as number[] };
  const n = (mm: number) => Math.round(mm / o.dr);
  for (let jj = 0; jj < o.nL; jj++) {
    let a = -1;
    let b = -1;
    for (let i = 0; i < nR; i++) {
      if (o.face[i * o.nL + jj] === Number(Interface.Peritoneum)) {
        if (a < 0) a = i;
        b = i;
      } else if (a >= 0) break;
    }
    if (a < 0 || b + n(4) >= nR || b - n(4) < 0) continue;
    let across: Tissue | undefined;
    for (let i = b + 1; i < nR && across === undefined; i++) {
      const tt: Tissue = o.tissue[i * o.nL + jj];
      if (tt !== Tissue.Fat) across = tt;
    }
    let line = 0;
    let nl = 0;
    let bg = 0;
    let nb = 0;
    for (let k = -n(4); k <= n(4); k++) {
      const d = Math.abs(k) * o.dr;
      if (d <= 0.6) {
        line += pow(b + k, jj);
        nl++;
      } else if (d >= 1.5) {
        bg += pow(b + k, jj);
        nb++;
      }
    }
    const excess = 10 * Math.log10(line / nl / (bg / nb));
    if (across === Tissue.RetroperitonealFat || across === Tissue.PerirenalFat) out.fat.push(excess);
    else if (across === Tissue.LiverCapsule || across === Tissue.Liver) out.liver.push(excess);
  }
  return out;
}

const summary = (x: { fat: number[]; liver: number[] }) => ({
  fat: `${x.fat.length} líneas, mediana ${median(x.fat).toFixed(1)} dB, media ${mean(x.fat).toFixed(1)}`,
  liver: `${x.liver.length} líneas, mediana ${median(x.liver).toFixed(1)} dB, media ${mean(x.liver).toFixed(1)}`,
});

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
      // ≤ 2 % como la e2e (decisión 65: con las facetas y la difusa, algún pico de fascia llega al blanco, 1 de 94 en la
      // subxifoidea; lo que se vigila es la línea blanca y uniforme de la primera versión de la 62)
      expect(w.lineSaturated, msg).toBeLessThanOrEqual(0.02);
      expect(w.lineCv, msg).toBeGreaterThanOrEqual(0.3);
      if (id === 'flank') expect(w.ribPeakDb - w.lineLevelDb, msg).toBeGreaterThanOrEqual(6);
    }
  });

  it('decisión 65: en la ventana renal la cara interna de la pared se apaga donde hay grasa detrás y sigue contra el hígado', () => {
    // detrás del peritoneo parietal posterior (el compartimento retroperitoneal) no hay peritoneo: la grasa extraperitoneal
    // de la pared sigue en la retroperitoneal y su R_ef baja a la de una fascia (0,03); contra el área desnuda del hígado
    // el salto grasa/hígado sigue ahí. Línea a línea, el exceso de potencia en el cruce sobre el tejido de alrededor,
    // frente al eco de la decisión 57 (gemelo, 26-09-2026): grasa −0,4 → −6,4 dB en 91 líneas, hígado 2,7 → 2,1 dB en
    // 65. La primera versión apagaba también las del hígado (la ganancia solo miraba el compartimento). Con el relieve
    // de las capas de la decisión 88 la transversalis, a ~2 mm, se inclina dentro de la ventana del fondo (1,5–4 mm) y
    // su eco cambia de un modelo de eco al otro: el contraste es −0,2 → −4,0 dB, la línea sigue sin estar (< 0) y cae
    // ≥ 3,5 dB. Sin las muestras a ≤ 1 mm de la transversalis en el fondo cae 6,4 dB (3,8 → −2,6), como en main (6,0):
    // no es la cara del peritoneo la que cambia; pero ese fondo aparta también las líneas contra el hígado (7,4 → 3,7 dB),
    // que la ventana de siempre, con la transversalis dentro, compara a ±1,5 dB
    const after = renalWallFace(false);
    const before = renalWallFace(true);
    const msg = JSON.stringify({ after: summary(after), before: summary(before) });
    expect(after.fat.length, msg).toBeGreaterThanOrEqual(60);
    expect(after.liver.length, msg).toBeGreaterThanOrEqual(30);
    // grasa con grasa: ya no hay línea (nada sobre el tejido de alrededor) y cae ≥ 3,5 dB
    expect(median(after.fat), msg).toBeLessThan(0);
    expect(median(after.fat), msg).toBeLessThan(median(before.fat) - 3.5);
    // contra el hígado: la misma línea que con el eco de la 57, a ±1,5 dB, sobre el tejido de alrededor
    expect(Math.abs(median(after.liver) - median(before.liver)), msg).toBeLessThan(1.5);
    expect(median(after.liver), msg).toBeGreaterThan(0.5);
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
