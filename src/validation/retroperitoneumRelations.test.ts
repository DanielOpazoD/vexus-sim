import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kidneyLocal, kidneyOuterSdf, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { RETROPERITONEUM_GLSL, psoasSdf, quadratusSdf, retroperitoneum } from '../anatomy/organs/retroperitoneum';
import { classifyKidneys } from '../anatomy/people/default/classifier';
import { PARAVERTEBRAL, paravertebralSdf, withParavertebral } from '../anatomy/people/default/paravertebral';
import { uncompress } from '../anatomy/compression';
import { spineDistances, torsoDepth } from '../anatomy/primitives';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { abdominalAtlasSdf, setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';
import { setThoracicAtlas, thoracicMaterial, thoracicValue } from './support/legacyPerson/thoracicAtlas';

/**
 * Relaciones básicas del retroperitoneo de la anatomía por defecto (`docs/anatomia/relaciones-tac.md`), con el
 * clasificador real y el atlas cargado. Las cifras de los TAC (s0028 / s0440) son de una persona cada uno: orden de
 * magnitud, no metas. No es validación clínica.
 */
let scene: AnatomyScene;
beforeAll(() => {
  for (const [path, set] of [
    ['src/anatomy/abdominal-atlas.gzip.bin', setAbdominalAtlas],
    ['src/anatomy/thoracic-atlas.gzip.bin', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync(path));
    set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
  scene = new AnatomyScene(NORMAL_ADULT);
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

/** Rejilla de 2,5 mm (15,625 mm³ por punto) detrás de los cuerpos vertebrales, de la torácica baja al sacro. */
const STEP = 2.5;
function* posteriorGrid(): Generator<Vec3> {
  for (let z = -270; z <= 10; z += STEP) for (let y = -150; y <= -40; y += STEP) for (let x = -90; x <= 90; x += STEP) yield [x, y, z];
}

/** El campo paravertebral en m con las mismas entradas que la clasificación. */
function paravertebral(m: Vec3): number {
  const person = scene.person.cpu;
  const insideWall = -torsoDepth(m, scene.torso) - scene.wallThickness();
  const dPeri = classifyKidneys(scene, m).dPeriMm;
  return paravertebralSdf(m, insideWall, dPeri, psoasSdf(m, person), quadratusSdf(m, insideWall, dPeri, person));
}

describe('masa paravertebral (decisión 328)', () => {
  it('hay músculo a cada lado de la columna, con un volumen del orden de los autóctonos de los TAC', () => {
    // Volumen clasificado como músculo dentro del campo paravertebral (sin el cuadrado lumbar de delante).
    const cm3 = [0, 0];
    for (const m of posteriorGrid())
      if (paravertebral(m) < 0 && scene.classify(m, BASELINE_CALIBER).tissue === Tissue.QuadratusLumborum)
        cm3[m[0] < 0 ? 0 : 1] += STEP ** 3 / 1000;
    // Autóctonos de s0028 / s0440 entre T11 y L5 (el mismo tramo, ~230 mm): 580 / 499 cm³ los dos lados; 824 / 699 en
    // todo el TAC. Banda [0,8 × 499; 1,6 × 580]: la pared posterior del modelo queda más lejos de las transversas que en
    // esos TAC. Antes de la decisión: 0.
    expect(cm3[0] + cm3[1]).toBeGreaterThan(400);
    expect(cm3[0] + cm3[1]).toBeLessThan(930);
    for (const side of cm3) expect(side / (cm3[0] + cm3[1])).toBeGreaterThan(0.4);
  });

  it('la GLSL escribe los mismos números que la CPU (sus constantes viven solo en la clausura por defecto)', () => {
    const P = PARAVERTEBRAL,
      f = (v: number) => v.toFixed(1);
    expect(P.zTop).toBe(0);
    for (const text of [
      `abs(m.x) - ${f(P.xLateral - P.roundMm)}`,
      `abs(m.y + ${f(-(P.yFront + P.yBack) / 2)}) - ${f((P.yFront - P.yBack) / 2 - P.roundMm)}`,
      `length(max(c, 0.0)) - ${f(P.roundMm)}, max(${f(P.xMedial)} - abs(m.x), max(-insideWall, -dPeri) / 1.25)`,
      `max(${f(P.psoasClearanceMm)} - dPsoas, ${f(P.quadratusClearanceMm)} - dQuadratus)`,
      `max(m.z, ${f(P.zBottom)} - m.z)`,
    ])
      expect(RETROPERITONEUM_GLSL).toContain(text);
  });

  it('withParavertebral da el mismo tejido y la misma distancia que evaluar siempre el campo entero', () => {
    // Referencia: el campo completo en cada punto, sin la cota de la caja que ahorra el psoas y el cuadrado lejos de ella.
    const person = scene.person.cpu;
    let n = 0,
      inside = 0;
    for (const m of posteriorGrid()) {
      if (++n % 7) continue;
      const insideWall = -torsoDepth(m, scene.torso) - scene.wallThickness();
      const dPeri = classifyKidneys(scene, m).dPeriMm;
      const retro = retroperitoneum(m, insideWall, dPeri, m, person);
      let expected = retro;
      if (retro[0] === Tissue.RetroperitonealFat || retro[0] === Tissue.Bowel) {
        const dP = psoasSdf(m, person);
        const dV = paravertebralSdf(m, insideWall, dPeri, dP, quadratusSdf(m, insideWall, dPeri, person));
        expected = dV < 0 ? [Tissue.QuadratusLumborum, Math.min(-dV, dP)] : [retro[0], Math.min(retro[1], dV)];
        if (dV < 0) inside++;
      }
      expect(withParavertebral(retro, m, insideWall, dPeri, person)).toEqual(expected);
    }
    expect(inside).toBeGreaterThan(1000);
  });

  it('las transversas y las láminas están rodeadas de músculo, no de grasa', () => {
    // Tejido blando a ≤ 3 mm del hueso del arco (detrás del cuerpo vertebral) entre las vértebras L1 y L5.
    let fat = 0,
      muscle = 0,
      n = 0;
    for (let z = -230; z <= -60; z += 2)
      for (let y = -100; y <= -62; y += 1.5)
        for (const x of [-60, -50, -40, -30, -20, 20, 30, 40, 50, 60]) {
          const m: Vec3 = [x, y, z];
          const bone = spineDistances(m, scene.spine).bone;
          if (bone <= 0 || bone > 3) continue;
          const t = scene.classify(m, BASELINE_CALIBER).tissue;
          if (t === Tissue.Vertebra || t === Tissue.Bone || t === Tissue.Cartilage) continue;
          n++;
          if (t === Tissue.RetroperitonealFat) fat++;
          if (t === Tissue.QuadratusLumborum || t === Tissue.Psoas) muscle++;
        }
    expect(n).toBeGreaterThan(200);
    expect(fat / n).toBeLessThan(0.15);
    expect(muscle / n).toBeGreaterThan(0.75);
  });

  it('no se solapa con el riñón, su grasa, el psoas, el hígado, la pared ni las costillas', () => {
    const person = scene.person.cpu;
    let inside = 0;
    const overlap = { kidney: 0, perirenal: 0, psoas: 0, liver: 0, wall: 0, ribReplaced: 0 };
    let ribInside = 0;
    for (const m of posteriorGrid()) {
      if (paravertebral(m) >= 0) continue;
      inside++;
      for (const k of [scene.kidneyRight, scene.kidneyLeft]) {
        if (kidneyOuterSdf(kidneyLocal(m, k), k) < 0) overlap.kidney++;
        if (perirenalOuterSdf(kidneyLocal(m, k), k) < 0) overlap.perirenal++;
      }
      if (psoasSdf(m, person) < 0) overlap.psoas++;
      if (abdominalAtlasSdf(m, 4) < 0) overlap.liver++;
      if (torsoDepth(m, scene.torso) + scene.wallThickness() > 0) overlap.wall++;
      const rib = thoracicValue(m);
      if (rib.d < 0 && thoracicMaterial(rib.label) === 'bone') {
        ribInside++;
        if (scene.classify(m, BASELINE_CALIBER).tissue !== Tissue.Bone) overlap.ribReplaced++;
      }
    }
    expect(inside).toBeGreaterThan(20000);
    // Riñón, grasa perirrenal, psoas y pared: el campo se cierra contra ellos (cero puntos). Hígado: la clasificación le
    // da prioridad; el campo solo puede tocar su borde (< 0,5 % de la masa). Costillas: como las transversas, las cabezas
    // y los cuellos de T11–T12 quedan dentro del músculo (≈ 2 % del campo) y siguen siendo hueso: el músculo las rodea.
    expect({ ...overlap, liver: 0 }).toEqual({ kidney: 0, perirenal: 0, psoas: 0, liver: 0, wall: 0, ribReplaced: 0 });
    expect(overlap.liver / inside).toBeLessThan(0.005);
    expect(ribInside / inside).toBeLessThan(0.04);
  });
});

/** Contorno del riñón derecho en una rejilla de 1,5 mm alrededor de su centro. */
function rightKidneyPoints(): Vec3[] {
  const k = scene.kidneyRight,
    pts: Vec3[] = [];
  for (let x = -70; x <= 70; x += 1.5)
    for (let y = -70; y <= 70; y += 1.5)
      for (let z = -90; z <= 90; z += 1.5) {
        const p: Vec3 = [k.center[0] + x, k.center[1] + y, k.center[2] + z];
        if (kidneyOuterSdf(kidneyLocal(p, k), k) < 0) pts.push(p);
      }
  return pts;
}

describe('riñón derecho inclinado y más cerca del hígado (decisión 329)', () => {
  it('su eje largo se inclina como en los TAC, con el polo superior medial y posterior', () => {
    const pts = rightKidneyPoints();
    const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
    const C = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pts.reduce((s, p) => s + (p[i] - c[i]) * (p[j] - c[j]), 0) / pts.length));
    let v = [0, 0, 1];
    for (let it = 0; it < 200; it++) {
      const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]);
      const l = Math.hypot(...w);
      v = w.map((x) => x / l);
    }
    if (v[2] < 0) v = v.map((x) => -x);
    const inclination = (Math.acos(v[2]) * 180) / Math.PI;
    // Primer eje de PCA con +z, la medida de relaciones-tac.md: 9,7° antes; s0028 / s0440, 32,5° / 33,1°
    expect(inclination).toBeGreaterThan(25);
    expect(inclination).toBeLessThan(36);
    expect(v[0]).toBeGreaterThan(0.1); // hacia la línea media (x > 0 es la izquierda del paciente)
    expect(v[1]).toBeLessThan(-0.3); // hacia atrás
    // sigue más bajo que el izquierdo (s0028 / s0440: 15 / 19 mm) y a su distancia de la línea media (62 / 60 mm)
    expect(scene.kidneyLeft.center[2] - c[2]).toBeGreaterThan(10);
    expect(-c[0]).toBeGreaterThan(55);
    expect(-c[0]).toBeLessThan(70);
    // más cerca del hígado en altura que antes (106 mm), sin llegar a los 79 / 73 de los TAC: lo impide el riñón
    // izquierdo, que también está bajo (ver decisión 329)
    let lc = 0,
      ln = 0;
    for (let x = -170; x <= 100; x += 4)
      for (let y = -130; y <= 130; y += 4)
        for (let z = -200; z <= 60; z += 4)
          if (scene.liverInteriorMargin([x, y, z]) > 0) {
            lc += z;
            ln++;
          }
    expect(lc / ln - c[2]).toBeLessThan(101);
  });

  it('no invade el hígado, el tubo digestivo, el psoas ni la columna', () => {
    const pts = rightKidneyPoints();
    expect(pts.length * 3.375e-3).toBeGreaterThan(110);
    const inside = { liver: 0, gut: 0, psoas: 0, bone: 0 };
    for (const p of pts) {
      if (abdominalAtlasSdf(p, 4) < 0) inside.liver++;
      if (abdominalAtlasSdf(p, 1) < 0) inside.gut++;
      if (psoasSdf(p, scene.person.cpu) < 0) inside.psoas++;
      if (spineDistances(p, scene.spine).bone < 0) inside.bone++;
    }
    expect(inside).toEqual({ liver: 0, gut: 0, psoas: 0, bone: 0 });
  });

  it('la renal focalizada ya no corta la columna en fila: el riñón queda en eje largo sin peine de sombras', () => {
    const sp = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === 'renal')!;
    const k = probeContact({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
    const renal = new Set([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule]);
    // Tramos de líneas vecinas con hueso detrás del riñón, a 18 cm (la profundidad de la captura): antes, 4–8 sombras
    // separadas (transversas L1–L5 y costillas 11–12)
    let runs = 0,
      previous = false;
    for (let l = 0; l < 129; l++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * l) / 128;
      let kidney = false,
        shadow = false;
      for (let r = 1; r < 180 && !shadow; r += 0.75) {
        const t = scene.classify(uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k), BASELINE_CALIBER).tissue;
        if (renal.has(t)) kidney = true;
        else if (kidney && TISSUES[t].bone) shadow = true;
      }
      if (shadow && !previous) runs++;
      previous = shadow;
    }
    expect(runs).toBeLessThanOrEqual(2);
  });
});
