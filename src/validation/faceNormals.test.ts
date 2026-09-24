// @tier slow
import { describe, expect, it } from 'vitest';
import { centralGradient } from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { faceNormalStats } from '../app/testHooks';
import { hilumNotchActive, kidneyLocal, kidneyOuterSdf, type Kidney } from '../anatomy/organs/kidney';
import { sdEllipsoidLocal, tubeQuery, type Tube } from '../anatomy/primitives';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { FRAG_QUERY } from '../ultrasound/shaders/passes.glsl';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, type FaceGeometry } from '../anatomy/scene';
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
 * Normal de `tubeQuery` en la GLSL del PR 5b, portada tal cual: en la sección elíptica el gradiente
 * escala la componente AP dos veces (d/dist la escalaba una) y, dentro del segmento, resta el
 * crecimiento del radio a lo largo del eje. Solo para esta prueba: TS no tiene normales de tubo.
 */
function glslTubeNormal(m: Vec3, tube: Tube, apScale: number, rs: number, seg: number, s: number): Vec3 {
  const a = tube.nodes[seg];
  const b = tube.nodes[seg + 1];
  const ab = [0, 1, 2].map((i) => b.p[i] - a.p[i]);
  const len = Math.hypot(ab[0], ab[1], ab[2]);
  const tg = ab.map((x) => x / len);
  const d = [0, 1, 2].map((i) => m[i] - (a.p[i] + ab[i] * s));
  const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  let g: number[];
  let dist: number;
  if (apScale !== 1) {
    const along = dot(d, tg);
    const perp = d.map((x, i) => x - tg[i] * along);
    perp[1] /= apScale;
    dist = Math.hypot(perp[0], perp[1], perp[2], along);
    const q = [...perp];
    q[1] /= apScale;
    const qt = dot(q, tg);
    g = q.map((x, i) => x - tg[i] * qt + tg[i] * along);
  } else {
    dist = Math.hypot(d[0], d[1], d[2]);
    g = d;
  }
  const taper = s > 0 && s < 1 ? (rs * (b.r - a.r)) / len : 0;
  return unit(g.map((x, i) => x / dist - tg[i] * taper) as Vec3);
}

/** La VCI (y su impacto) cuya luz da la cara `tube` en m, con el calibre del instante. */
function ivcHit(m: Vec3) {
  let best: { tube: Tube; apScale: number; rs: number; seg: number; s: number; d: number } | null = null;
  for (const v of scene.vessels) {
    if (VESSEL_META[v.id].system !== 'ivc') continue;
    const tube = { ...v.tube, apScale: caliber.ivcApScale };
    const rs = caliber.radiusScale(v.id);
    const hit = tubeQuery(m, tube, rs);
    if (!best || hit.d < best.d) best = { tube, apScale: caliber.ivcApScale, rs, seg: hit.segment, s: hit.s, d: hit.d };
  }
  return best!;
}

/** Qué GPU se simula: la del PR 5a (errores plantados) o la del 5b (normales corregidas, portadas). */
let gpuMode: '5a' | '5b' = '5a';

/** GPU simulada: tejido de la CPU y la normal de la cara que dibuja ese tejido, con los dos errores plantados. */
function gpuQuery(points: Float32Array) {
  const n = points.length / 3;
  const tissue = new Int32Array(n);
  const normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = anatomy.deformation.toMaterial([points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], engine.sample.resp);
    const t = scene.classify(m, caliber).tissue;
    tissue[i] = t;
    const tube = scene.faceTube(m, caliber);
    let nv: Vec3 = [0, 1, 0];
    if (tube && t !== Tissue.Liver) {
      nv = gradientOf(m, 'tube');
      if (tube.vessel && VESSEL_META[tube.vessel].system === 'ivc') {
        if (gpuMode === '5a') nv = rotate(nv, tube.hit.tangent, (IVC_ERROR_DEG * Math.PI) / 180);
        else {
          const h = ivcHit(m);
          nv = glslTubeNormal(m, h.tube, h.apScale, h.rs, h.seg, h.s);
        }
      }
    } else if (t === Tissue.LiverCapsule) nv = gradientOf(m, 'liverSurface');
    else if (t === Tissue.Diaphragm || t === Tissue.Lung) nv = gradientOf(m, 'dome');
    else if (t === Tissue.RenalCapsule || t === Tissue.PerirenalFat)
      nv = gpuMode === '5a' ? ellipsoidNormal(m) : gradientOf(m, 'kidneyOuter');
    else if (t === Tissue.Fluid || t === Tissue.BileDuctWall) nv = gradientOf(m, 'gallbladder');
    normal.set(nv, i * 3);
  }
  return { tissue, vessel: new Int32Array(n).fill(-1), velocity: new Float32Array(n * 3), normal };
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

describe('e2e de normales con las normales del PR 5b (sin GPU)', () => {
  // La GLSL de 5b saca la normal de la VCI del gradiente de su sección elíptica (con el afilamiento
  // del radio) y la del contorno renal y la cápsula del gradiente numérico de su distancia
  // (`faceNormal`, mismo paso que el banco). La fórmula de la VCI, portada, debe dar el gradiente de
  // `faceSdf` en todo el cuerpo: es la fila que la e2e pasa a exigir.
  it('subxifoidea y flanco: la VCI con la normal de la sección elíptica coincide con el gradiente', () => {
    // el port de `glslTubeNormal` es el de la GLSL: el gradiente de la sección y el afilamiento
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    expect(glsl).toContain('vec3 q = perp; q.y /= apScale; g = q - tg * dot(q, tg) + tg * along;');
    expect(glsl).toContain('float taper = s > 0.0 && s < 1.0 ? rs * (b.w - a.w) * inversesqrt(len2) : 0.0;');
    expect(glsl).toContain('vec3 gn = g / max(dist, 1e-6) - tg * taper;');
    // y el contorno renal y la cápsula usan el gradiente de su distancia con el paso del banco
    expect(glsl).toContain('vec3 kidneyOuterGradient(vec3 m)');
    expect(glsl).toContain('vec3 faceNormal(Cls c, vec3 m)');
    // la e2e lee la normal que usa el eco
    expect(FRAG_QUERY).toContain('o2 = vec4(faceNormal(c, m), 0.0);');
    gpuMode = '5b';
    try {
      for (const id of ['subxiphoid', 'flank'] as const) {
        const r = stats(id);
        expect(r.tubeIvcBody.points, id).toBeGreaterThanOrEqual(50);
        expect(r.tubeIvcBody.p01, `${id}: ${r.tubeIvcBody.worst}`).toBeGreaterThan(0.999);
        expect(r.tubeIvc.p05, `${id}: ${r.tubeIvc.worst}`).toBeGreaterThan(0.99);
        expect(r.tube.p05, id).toBeGreaterThanOrEqual(0.98);
      }
      const renal = stats('renal');
      expect(renal.kidneyOuter.p01).toBeGreaterThan(0.999);
      expect(renal.kidneyOuterNotch.p01).toBeGreaterThan(0.999);
    } finally {
      gpuMode = '5a';
    }
  });
});
