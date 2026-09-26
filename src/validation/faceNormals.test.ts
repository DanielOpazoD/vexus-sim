// @tier slow
import { describe, expect, it } from 'vitest';
import { centralGradient } from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { faceNormalStats } from '../app/testHooks';
import { hilumNotchActive, kidneyLocal, kidneyOuterSdf, type Kidney } from '../anatomy/organs/kidney';
import { sdEllipsoidLocal } from '../anatomy/primitives';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { FRAG_QUERY } from '../ultrasound/shaders/passes.glsl';
import { AnatomyQuery } from '../anatomy/query';
import { Interface } from '../anatomy/interfaces';
import { AnatomyScene, type Classification, type FaceGeometry } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { VESSEL_META } from '../physiology/vessels';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Filas de la e2e de normales (`faceNormalStats`) sin GPU. Una GPU simulada clasifica como la CPU y
 * devuelve, por tejido, el gradiente exacto de `faceSdf` de su cara, salvo dos errores conocidos
 * plantados: la VCI con la normal girada 8° alrededor de su eje (el orden del error real de su sección
 * elíptica, 6–10°) y el contorno renal con la normal del elipsoide sin escotadura (la fórmula de la
 * GLSL). La fila del tubo mezcla todos los vasos y no ve el primero; la de la VCI sí. La del riñón
 * mezcla la escotadura; fuera de ella la normal es exacta y se puede exigir.
 */
const DEPTH = 180;
const IVC_ERROR_DEG = 8;
const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient);
const anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
const caliber = anatomy.caliberFor(engine.sample);

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const gradientOf = (m: Vec3, face: FaceGeometry): Vec3 => unit(centralGradient((q) => scene.faceSdf(q, caliber, face), m) ?? [0, 1, 0]);
/** Rotación de `n` un ángulo `a` alrededor del eje unitario `t` (Rodrigues). */
const rotate = (n: Vec3, t: Vec3, a: number): Vec3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tn = t[0] * n[0] + t[1] * n[1] + t[2] * n[2];
  const x: Vec3 = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
  return [0, 1, 2].map((i) => n[i] * c + x[i] * s + t[i] * tn * (1 - c)) as Vec3;
};
/** Normal del elipsoide del riñón más cercano, como `kidneyOuter` en la GLSL (sin la escotadura). */
const ellipsoidNormal = (m: Vec3): Vec3 => {
  const ks: Kidney[] = [scene.kidneyRight, scene.kidneyLeft];
  const qs = ks.map((k) => kidneyLocal(m, k));
  const j = kidneyOuterSdf(qs[0], ks[0]) <= kidneyOuterSdf(qs[1], ks[1]) ? 0 : 1;
  const k = ks[j];
  const nl = unit([qs[j][0] / k.radii[0] ** 2, qs[j][1] / k.radii[1] ** 2, qs[j][2] / k.radii[2] ** 2]);
  return unit([0, 1, 2].map((i) => k.u[i] * nl[0] + k.v[i] * nl[1] + k.w[i] * nl[2]) as Vec3);
};

/**
 * Qué GPU se simula: la del PR 5a (errores de normal plantados, norma 1), la del 5b (el gradiente de
 * `AnatomyScene.faceGradient`, gemelo de `faceGradient` de la GLSL: analítico en los tubos y numérico
 * en el resto), la del 5b sin la norma (normales corregidas, norma 1: la que integraba 1/|∇|) o la del 5b con
 * la cara externa de la grasa perirrenal en el gradiente del contorno renal (como antes de la revisión de la 68).
 */
let gpuMode: '5a' | '5b' | '5b-norm1' | '5b-peri-kidney' = '5a';

/**
 * Geometría que la GPU usa para el gradiente de cada muestra (`faceGradient`: por tejido, y la mitad externa de la
 * grasa perirrenal que dibuja su cara, la de esa cara).
 */
function faceOf(m: Vec3, c: Classification): FaceGeometry | null {
  const t = c.tissue;
  if (scene.faceTube(m, caliber) && t !== Tissue.Liver) return 'tube';
  if (t === Tissue.LiverCapsule) return 'liverSurface';
  if (t === Tissue.Diaphragm) return 'dome';
  if (c.interface === Interface.PerirenalFat) return gpuMode === '5b-peri-kidney' ? 'kidneyOuter' : 'perirenalOuter';
  if (t === Tissue.RenalCapsule || t === Tissue.PerirenalFat) return 'kidneyOuter';
  if (t === Tissue.Fluid || t === Tissue.BileDuctWall) return 'gallbladder';
  return null;
}

/** GPU simulada: tejido de la CPU y el gradiente de la cara que dibuja ese tejido según `gpuMode`. */
function gpuQuery(points: Float32Array) {
  const n = points.length / 3;
  const tissue = new Int32Array(n);
  const normal = new Float32Array(n * 3);
  const gradNorm = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const m = anatomy.deformation.toMaterial([points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], engine.sample.resp);
    const c = scene.classify(m, caliber);
    const t = c.tissue;
    tissue[i] = t;
    const face = faceOf(m, c);
    let nv: Vec3 = t === Tissue.Lung ? gradientOf(m, 'dome') : [0, 1, 0];
    if (gpuMode === '5a') {
      const tube = scene.faceTube(m, caliber);
      if (face) nv = gradientOf(m, face);
      if (face === 'tube' && tube?.vessel && VESSEL_META[tube.vessel].system === 'ivc')
        nv = rotate(nv, tube.hit.tangent, (IVC_ERROR_DEG * Math.PI) / 180);
      if (face === 'kidneyOuter') nv = ellipsoidNormal(m);
    } else if (face) {
      const g = scene.faceGradient(m, caliber, face)!;
      nv = g.normal;
      if (gpuMode === '5b') gradNorm[i] = g.norm;
    }
    normal.set(nv, i * 3);
  }
  return { tissue, vessel: new Int32Array(n).fill(-1), velocity: new Float32Array(n * 3), normal, gradNorm };
}

function stats(id: StartPoint['id']) {
  const sp = START_POINTS.find((s) => s.id === id)!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const sim = {
    transducer: CONVEX_C35,
    profile: CONVEX_C35_PROFILE,
    bmode: { depthMm: DEPTH },
    anatomy,
    scene,
    frame: probeFrame(pose, scene.torso, CONVEX_C35),
    pose,
    sample: engine.sample,
    gpuQuery,
  } as unknown as Simulator;
  return faceNormalStats(sim);
}

describe('e2e de normales: filas de la VCI y de la escotadura renal (sin GPU)', () => {
  it('la escotadura hiliar solo pesa cerca del hilio: en el polo lateral el contorno es el elipsoide', () => {
    const k = scene.kidneyRight;
    const lateral: Vec3 = [0, -k.radii[1], 0];
    expect(hilumNotchActive(lateral, k)).toBe(false);
    expect(kidneyOuterSdf(lateral, k)).toBe(sdEllipsoidLocal(lateral, k.radii));
    expect(hilumNotchActive([0, k.radii[1], 0], k)).toBe(true);
  });

  it('subxifoidea: la fila del tubo pasa con la VCI girada 8°; la de la VCI lo delata', () => {
    const r = stats('subxiphoid');
    expect(r.tubeIvc.points).toBeGreaterThanOrEqual(50);
    expect(r.tubeIvcBody.points).toBeGreaterThanOrEqual(50);
    expect(r.tubeIvc.mismatched).toBe(0);
    // la puerta de la e2e sobre el tubo entero no lo ve
    expect(r.tube.p05).toBeGreaterThanOrEqual(0.98);
    expect(r.tube.p50).toBeGreaterThanOrEqual(0.99);
    // en el cuerpo de la VCI la normal es perpendicular al eje: todo el cuerpo a cos 8°
    const cos = Math.cos((IVC_ERROR_DEG * Math.PI) / 180);
    expect(r.tubeIvcBody.p50).toBeCloseTo(cos, 3);
    expect(r.tubeIvcBody.min).toBeGreaterThan(cos - 1e-3);
  });

  it('ventana renal: la escotadura hunde la fila del riñón y fuera de ella la normal del elipsoide es exacta', () => {
    const r = stats('renal');
    expect(r.kidneyOuter.p01).toBeLessThan(0.98);
    expect(r.kidneyOuterNotch.points).toBeGreaterThanOrEqual(50);
    expect(r.kidneyOuterNotch.p50).toBeLessThan(0.98);
    expect(r.kidneyOuterNotchFree.points).toBeGreaterThanOrEqual(50);
    expect(r.kidneyOuterNotchFree.p01).toBeGreaterThan(0.999);
  });

  it('flanco: sin escotadura en el plano, la fila sin escotadura es la del riñón entero', () => {
    const r = stats('flank');
    expect(r.kidneyOuterNotch.points).toBe(0);
    expect(r.kidneyOuterNotchFree.points).toBeGreaterThanOrEqual(50);
    expect(r.kidneyOuterNotchFree.points).toBe(r.kidneyOuter.points);
    expect(r.kidneyOuterNotchFree.p01).toBe(r.kidneyOuter.p01);
  });
});

describe('e2e de normales con los gradientes del PR 5b (sin GPU)', () => {
  // La GLSL de 5b saca el gradiente de la VCI de su sección elíptica (con el afilamiento del radio) y el
  // del contorno renal, la cápsula, el diafragma y la vesícula de diferencias centrales de su distancia
  // (`faceGradient`, mismo paso que el banco). El gemelo TS (`faceGradient` de la escena, analítico en
  // los tubos con `tubeFaceGradient`) debe dar el gradiente de `faceSdf` en dirección y en norma: son las
  // filas que la e2e exige.
  it('subxifoidea y flanco: la VCI con el gradiente de la sección elíptica coincide con el de faceSdf', () => {
    // el gemelo `tubeFaceGradient` es el de la GLSL: el gradiente de la sección y el afilamiento, sin normalizar
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    expect(glsl).toContain('vec3 q = perp; q.y /= apScale; g = q - tg * dot(q, tg) + tg * along;');
    expect(glsl).toContain('float taper = s > 0.0 && s < 1.0 ? rs * (b.w - a.w) * inversesqrt(len2) : 0.0;');
    expect(glsl).toContain('vec3 gn = g / max(dist, 1e-6) - tg * taper;');
    expect(glsl).toContain('n = dist > 0.0 && dot(gn, gn) > 0.0 ? gn : vec3(0.0, 1.0, 0.0);');
    // y el resto de caras usan el gradiente de su distancia con el paso del banco
    expect(glsl).toContain('vec3 kidneyOuterGradient(vec3 m)');
    expect(glsl).toContain('vec4 faceGradient(Cls c, vec3 m)');
    // la e2e lee el gradiente que usa el eco (xyz la normal, w la norma)
    expect(FRAG_QUERY).toContain('o2 = faceGradient(c, m);');
    gpuMode = '5b';
    try {
      for (const id of ['subxiphoid', 'flank'] as const) {
        const r = stats(id);
        expect(r.tubeIvcBody.points, id).toBeGreaterThanOrEqual(50);
        expect(r.tubeIvcBody.p01, `${id}: ${r.tubeIvcBody.worst}`).toBeGreaterThan(0.999);
        expect(r.tubeIvc.p05, `${id}: ${r.tubeIvc.worst}`).toBeGreaterThan(0.99);
        expect(r.tube.p05, id).toBeGreaterThanOrEqual(0.98);
        // la norma: la analítica frente a diferencias centrales de 0,02 mm
        expect(r.tubeIvcBody.normErrP95, id).toBeLessThan(1e-3);
        expect(r.tube.normErrP95, id).toBeLessThan(1e-3);
      }
      const renal = stats('renal');
      expect(renal.kidneyOuter.p01).toBeGreaterThan(0.999);
      expect(renal.kidneyOuterNotch.p01).toBeGreaterThan(0.999);
      // fuera de los tubos, el mismo cálculo que la referencia (salvo el punto, que la GPU recibe en float32)
      // (una muestra cuya plantilla de diferencias centrales cabalga la arista del min entre hígado y pared puede
      // cambiar de rama con el redondeo float32 del punto: 1e-4 en la cápsula posterolateral desde la decisión 68, que
      // movió las muestras; el p95 sigue en 1e-7)
      for (const row of ['kidneyOuter', 'kidneyOuterNotch', 'liverSurface'] as const) {
        expect(renal[row].normErrP95, row).toBeLessThan(1e-6);
        expect(renal[row].normErrMax, row).toBeLessThan(row === 'liverSurface' ? 2e-4 : 1e-5);
      }
      // la cara externa de la grasa perirrenal (Morison), con el gradiente de su propia distancia (revisión de la 68)
      expect(renal.perirenalOuter.points).toBeGreaterThanOrEqual(50);
      expect(renal.perirenalOuter.p01).toBeGreaterThan(0.999);
      expect(renal.perirenalOuter.normErrP95).toBeLessThan(1e-6);
      expect(renal.perirenalOuter.normErrMax).toBeLessThan(1e-5);
      // la cúpula, desde la subxifoidea (la vista intercostal de partida va por el 8.º espacio desde la decisión
      // 62 y apenas la ve)
      const sub = stats('subxiphoid');
      expect(sub.dome.points).toBeGreaterThan(50);
      expect(sub.dome.normErrMax).toBeLessThan(1e-5);
    } finally {
      gpuMode = '5a';
    }
  });

  it('una GPU con la cara externa de la grasa perirrenal en el gradiente del contorno renal la delata su fila', () => {
    // la superficie es el contorno menos el grosor local de la grasa, no el contorno: con su gradiente la normal se
    // apartaba hasta 15° (p01 0,965 en la ventana renal) y la norma un 15 % (revisión de la decisión 68)
    gpuMode = '5b-peri-kidney';
    try {
      const r = stats('renal');
      expect(r.perirenalOuter.points).toBeGreaterThanOrEqual(50);
      expect(r.perirenalOuter.p01).toBeLessThan(0.98);
      expect(r.perirenalOuter.normErrP95).toBeGreaterThan(0.1);
    } finally {
      gpuMode = '5a';
    }
  });

  it('una GPU sin la norma del gradiente (δ = ifd/cosθ) la delata la fila de la VCI', () => {
    // la subxifoidea mira las paredes AP de la VCI, donde |∇| = 1/apScale ≈ 1,29
    gpuMode = '5b-norm1';
    try {
      const r = stats('subxiphoid');
      expect(r.tubeIvcBody.p01).toBeGreaterThan(0.999);
      expect(r.tubeIvcBody.normErrP95).toBeGreaterThan(0.1);
    } finally {
      gpuMode = '5a';
    }
  });
});
