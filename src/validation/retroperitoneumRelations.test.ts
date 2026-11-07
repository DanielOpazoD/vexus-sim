import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kidneyLocal, kidneyOuterSdf, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { RETROPERITONEUM_GLSL, psoasSdf, quadratusSdf, retroperitoneum } from '../anatomy/organs/retroperitoneum';
import { classifyKidneys } from '../anatomy/people/default/classifier';
import { kidneyAtSource } from '../anatomy/people/default/cpu';
import { KIDNEY_FRAMES } from '../anatomy/people/default/kidneyFrames';
import { PARAVERTEBRAL, paravertebralSdf, withParavertebral } from '../anatomy/people/default/paravertebral';
import { uncompress } from '../anatomy/compression';
import { spineDistances, torsoDepth } from '../anatomy/primitives';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { COSTAL_BODY_STRIDE } from '../anatomy/referenceBody';
import type { VesselId } from '../physiology/vessels';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { abdominalAtlasSdf, setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { KIDNEYS, movedKidneyFrame } from '../../tools/anatomy/move-kidneys';
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

/** Contorno de un riñón (por defecto, el derecho) en una rejilla de 1,5 mm alrededor de su centro. */
function rightKidneyPoints(k = scene.kidneyRight): Vec3[] {
  const pts: Vec3[] = [];
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
    // a su distancia de la línea media (s0028 / s0440: 62 / 60 mm); la altura, en la decisión 330
    expect(-c[0]).toBeGreaterThan(55);
    expect(-c[0]).toBeLessThan(70);
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

const centroid = (pts: readonly Vec3[]): Vec3 => [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length) as Vec3;
/** Centroide de los puntos donde `inside` (rejilla de `step` mm en la caja dada). */
function centroidWhere(inside: (p: Vec3) => boolean, lo: Vec3, hi: Vec3, step: number): Vec3 {
  const pts: Vec3[] = [];
  for (let x = lo[0]; x <= hi[0]; x += step)
    for (let y = lo[1]; y <= hi[1]; y += step) for (let z = lo[2]; z <= hi[2]; z += step) if (inside([x, y, z])) pts.push([x, y, z]);
  return centroid(pts);
}
const liverCentroid = () => centroidWhere((p) => scene.liverInteriorMargin(p) > 0, [-170, -130, -200], [100, 130, 60], 4);
/** y del centroide de la columna lumbar del atlas (cuerpo, arco y transversas, |x| ≤ 60) en la franja z ± 15 mm. */
function vertebraY(z: number): number {
  let s = 0,
    n = 0;
  for (let zz = z - 15; zz <= z + 15; zz += 1.5)
    for (let y = -140; y <= 0; y += 1.5)
      for (let x = -60; x <= 60; x += 1.5)
        if (abdominalAtlasSdf([x, y, zz], 8) < 0) {
          s += y;
          n++;
        }
  return s / n;
}

describe('los dos riñones bajo el hígado y el bazo (decisión 330)', () => {
  // Cifras de los TAC (s0028 / s0440): una persona cada uno, orden de magnitud, no metas. No es validación clínica.
  it('suben hacia el hígado, el izquierdo más alto que el derecho', () => {
    const liver = liverCentroid()[2];
    const right = centroid(rightKidneyPoints())[2],
      left = centroid(rightKidneyPoints(scene.kidneyLeft))[2];
    // centro hepático − centro renal, en altura: derecho 79 / 73 mm, izquierdo 64 / 54; antes 99,5 y 86,2. El derecho no
    // pasa de ~85: más arriba, la cara visceral del hígado aplana su polo superior hasta los dedos del seno (decisión 305)
    expect(liver - right).toBeLessThan(90);
    expect(liver - right).toBeGreaterThan(70);
    expect(liver - left).toBeLessThan(72);
    expect(liver - left).toBeGreaterThan(50);
    // el izquierdo, 15 / 19 mm más alto; antes 13,3
    expect(left - right).toBeGreaterThan(14);
    expect(left - right).toBeLessThan(25);
  });

  it('el derecho se inclina en el plano coronal y deja de quedar detrás de la columna', () => {
    const pts = rightKidneyPoints(),
      c = centroid(pts);
    const C = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pts.reduce((s, p) => s + (p[i] - c[i]) * (p[j] - c[j]), 0) / pts.length));
    let v = [0, 0, 1];
    for (let it = 0; it < 200; it++) {
      const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]);
      const l = Math.hypot(...w);
      v = w.map((x) => x / l);
    }
    if (v[2] < 0) v = v.map((x) => -x);
    // inclinación coronal (polo superior medial): 18° / 23° en los TAC, 10,7° antes
    expect((Math.atan2(v[0], v[2]) * 180) / Math.PI).toBeGreaterThan(14);
    // centro renal frente al centroide vertebral a su altura: ≈ +11 mm en los dos TAC, +7,2 en main 9e7b8d0, −11,9 tras la
    // 329 (18 mm hacia atrás). Más adelante, el colon y el duodeno lo impiden sin moverlos (ver decisión 330)
    expect(c[1] - vertebraY(c[2])).toBeGreaterThan(-8);
  });

  it('ninguno invade el hígado, el bazo, el páncreas, la vesícula, el tubo digestivo, el psoas, el hueso ni las costillas', () => {
    for (const k of [scene.kidneyRight, scene.kidneyLeft]) {
      const pts = rightKidneyPoints(k);
      expect(pts.length * 3.375e-3).toBeGreaterThan(115);
      const inside = { liver: 0, gut: 0, spleen: 0, pancreas: 0, gallbladder: 0, psoas: 0, bone: 0, spine: 0, rib: 0, wall: 0 };
      for (const p of pts) {
        for (const [name, f] of [
          ['liver', 4],
          ['gut', 1],
          ['spleen', 3],
          ['pancreas', 0],
          ['gallbladder', 7],
          ['psoas', 9],
          ['bone', 8],
        ] as const)
          if (abdominalAtlasSdf(p, f) < 0) inside[name]++;
        if (spineDistances(p, scene.spine).bone < 0) inside.spine++;
        const rib = thoracicValue(p);
        // antes, una costilla atravesaba 1,6 cm³ del riñón derecho echado hacia atrás (decisión 329)
        if (rib.d < 0 && thoracicMaterial(rib.label) === 'bone') inside.rib++;
        // ≥ 4 mm de la cara interna de la pared (main 9e7b8d0: 10,7; tras la 329, 3,4 en el borde posterolateral derecho)
        if (torsoDepth(p, scene.torso) + scene.wallThickness() > -4) inside.wall++;
      }
      expect(inside).toEqual({ liver: 0, gut: 0, spleen: 0, pancreas: 0, gallbladder: 0, psoas: 0, bone: 0, spine: 0, rib: 0, wall: 0 });
    }
  });

  it('el izquierdo queda bajo el bazo, con la cola del páncreas delante', () => {
    const left = rightKidneyPoints(scene.kidneyLeft),
      c = centroid(left),
      top = Math.max(...left.map((p) => p[2]));
    const spleen = centroidWhere((p) => abdominalAtlasSdf(p, 3) < 0, [40, -110, -150], [140, 10, -20], 2);
    let spleenTop = -Infinity;
    for (let x = 40; x <= 140; x += 2)
      for (let y = -110; y <= 10; y += 2)
        for (let z = -150; z <= -20; z += 2) if (abdominalAtlasSdf([x, y, z], 3) < 0) spleenTop = Math.max(spleenTop, z);
    // el bazo, lateral y por encima del centro renal (52 / 49 mm en los TAC; aquí menos: el bazo estimado del modelo es bajo)
    expect(spleen[0]).toBeGreaterThan(c[0] + 20);
    expect(spleen[2] - c[2]).toBeGreaterThan(20);
    expect(spleenTop).toBeGreaterThan(top);
    // la cola del páncreas por delante del riñón izquierdo y por encima de su centro
    const tail = centroidWhere((p) => p[0] > 40 && abdominalAtlasSdf(p, 0) < 0, [40, -60, -180], [110, 40, -60], 2);
    expect(tail[1]).toBeGreaterThan(c[1] + 15);
    expect(tail[2]).toBeGreaterThan(c[2]);
  });

  it('los vasos renales siguen al riñón y conservan sus relaciones', () => {
    const nodes = (id: VesselId) => scene.vesselById.get(id)!.tube.nodes;
    const along = (id: VesselId) => {
      const n = nodes(id),
        out: { p: Vec3; r: number }[] = [];
      for (let i = 0; i < n.length - 1; i++)
        for (let t = 0; t < 1; t += 0.01)
          out.push({ p: [0, 1, 2].map((k) => n[i].p[k] + t * (n[i + 1].p[k] - n[i].p[k])) as Vec3, r: n[i].r + t * (n[i + 1].r - n[i].r) });
      return out;
    };
    const atZ = (id: VesselId, z: number) => along(id).reduce((a, b) => (Math.abs(b.p[2] - z) < Math.abs(a.p[2] - z) ? b : a));
    // la arteria renal derecha pasa por detrás de la VCI (V15): donde cruza su eje, ≥ 7 mm por detrás de él
    const artery = along('renalArteryRight').find((q) => q.p[0] <= atZ('ivcInfra', q.p[2]).p[0])!;
    expect(atZ('ivcInfra', artery.p[2]).p[1] - artery.p[1]).toBeGreaterThan(7);
    // la vena renal izquierda cruza por delante de la aorta y por debajo del origen de la AMS (V17–V18)
    const vein = along('renalVeinLeft').find((q) => q.p[0] <= atZ('aorta', q.p[2]).p[0])!;
    const aorta = atZ('aorta', vein.p[2]);
    expect(vein.p[1] - aorta.p[1]).toBeGreaterThan(aorta.r + vein.r);
    expect(nodes('sma')[0].p[2] - vein.p[2]).toBeGreaterThan(10);
    // en cada hilio, la vena por delante de la arteria (V16)
    for (const [v, a] of [
      ['renalVeinRight', 'renalArteryRight'],
      ['renalVeinLeft', 'renalArteryLeft'],
    ] as const)
      expect(nodes(v)[1].p[1]).toBeGreaterThan(nodes(a).at(-2)!.p[1]);
    // el tramo hiliar (seno → hilio → primer nodo fijo) no entra en el hígado, el bazo ni el tubo digestivo
    for (const id of ['renalVeinRight', 'renalVeinLeft', 'renalArteryRight', 'renalArteryLeft'] as const) {
      const n = nodes(id),
        hilar = id.startsWith('renalVein') ? [n[0], n[1], n[2]] : [n.at(-1)!, n.at(-2)!, n.at(-3)!];
      for (let i = 0; i < 2; i++)
        for (let t = 0; t <= 1; t += 0.02) {
          const p = [0, 1, 2].map((k) => hilar[i].p[k] + t * (hilar[i + 1].p[k] - hilar[i].p[k])) as Vec3;
          const r = hilar[i].r + t * (hilar[i + 1].r - hilar[i].r);
          for (const f of [4, 3, 1]) expect(abdominalAtlasSdf(p, f) - r, `${id} ${f}`).toBeGreaterThan(0);
        }
    }
  });

  it('la renal focalizada no abre un peine de sombras óseas en el campo profundo de todo el sector', () => {
    const sp = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === 'renal')!;
    const k = probeContact({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
    // Tramos de líneas vecinas con hueso entre 10 y 18 cm (la profundidad de la captura), estén o no detrás del riñón: con la
    // pose de la 329, 4 (transversas y costillas bajo el polo inferior); la búsqueda de la 330 los penaliza
    let runs = 0,
      previous = false;
    for (let l = 0; l < 129; l++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * l) / 128;
      let bone = false;
      for (let r = 100; r < 180 && !bone; r += 1.5)
        bone = TISSUES[scene.classify(uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k), BASELINE_CALIBER).tissue].bone;
      if (bone && !previous) runs++;
      previous = bone;
    }
    expect(runs).toBeLessThanOrEqual(2);
  });

  it('la piel no sigue a los riñones movidos: el ajuste parietal los lee en su posición fuente', () => {
    // Muestras del perfil del flanco posterior derecho donde la 329 sacó la piel hasta 9,15 mm al echar el riñón atrás:
    // vuelven a las de main 9e7b8d0 (131,25, 143,36 y 125,83 mm; tras la 329, 140,40, 145,12 y 130,27)
    const profile = scene.torso.profile!;
    for (const [row, k, main] of [
      [26, 75, 131.2513],
      [24, 72, 143.3593],
      [28, 74, 125.8302],
    ])
      expect(Math.abs(profile[row * COSTAL_BODY_STRIDE + k] - main)).toBeLessThan(0.01);
    // el marco fuente de cada riñón se lleva a su marco movido
    for (const [side, f] of KIDNEY_FRAMES.entries()) {
      const moved = kidneyAtSource(f.source.center, 5 + side);
      for (let i = 0; i < 3; i++) expect(moved[i]).toBeCloseTo(f.center[i], 9);
    }
    expect(kidneyAtSource([1, 2, 3], 4)).toEqual([1, 2, 3]);
  });

  it('los marcos de la persona son los que da la herramienta que movió los campos', () => {
    for (const [side, spec] of [KIDNEYS.right, KIDNEYS.left].entries()) {
      const f = movedKidneyFrame(spec),
        g = KIDNEY_FRAMES[side];
      for (let i = 0; i < 3; i++) {
        expect(g.center[i]).toBeCloseTo(f.center[i], 6);
        expect(g.long[i]).toBeCloseTo(f.u[i], 6);
        expect(g.hilumHint[i]).toBeCloseTo(f.v[i], 6);
        expect(g.source.center[i]).toBe(spec.source.center[i]);
      }
    }
  });
});
