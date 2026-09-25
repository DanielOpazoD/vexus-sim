import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_GLSL,
  PROBE_COMPRESSION,
  compressionPlateMm,
  compressionReachMm,
  compressionSample,
  uncompress,
  warpAt,
  warpBound,
  warpNormal,
  type ProbeCompression,
} from '../anatomy/compression';
import { ANATOMY_GLSL, COMPRESSION_BASE, MAX_NODES, NODE_BASE, SCENE_TEX_H, SCENE_TEX_W } from '../anatomy/gpu/anatomy.glsl';
import { SCENE_UNIFORMS } from '../anatomy/gpu/sceneUniforms';
import { torsoDepth, torsoDepthGradient } from '../anatomy/primitives';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { CONTACT, contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, clampPose, lineAngle, lineDirection, pointOnLine, probeFrame, type ProbeFrame, type ProbePose } from '../probe/probe';

/**
 * La sonda comprime el tejido (decisión 63): gemelo TS del campo de compresión y del contacto en los puntos de
 * partida. Todas las pruebas de geometría miden sobre `uncompress` (lo que ve `toMaterial`, en CPU y GPU) y
 * comparan con el tronco rígido (`null`, el modelo de `main`), que no cumplía ninguna: la pared en cúpula bajo
 * la huella (la cara interna de 6 a 36 mm más honda en los bordes de la huella que en el centro) y los bordes sin
 * acoplar (el hueco ad hoc de `lineCoupling`).
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const torso = scene.torso;
const tr = CONVEX_C35;
const W = compressionPlateMm(torso);

function poseOf(sp: StartPoint, extra: Partial<ProbePose> = {}): ProbePose {
  return clampPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, ...extra });
}
function view(id: StartPoint['id'], extra: Partial<ProbePose> = {}): { pose: ProbePose; frame: ProbeFrame; k: ProbeCompression } {
  const pose = poseOf(
    START_POINTS.find((s) => s.id === id)!,
    extra,
  );
  const frame = probeFrame(pose, torso, tr);
  return { pose, frame, k: probeContact(pose, frame, tr, torso) };
}
/** Profundidad bajo la cara (mm) a la que la línea θ cruza la capa de profundidad radial w, con la compresión k. */
function levelDepth(frame: ProbeFrame, k: ProbeCompression | null, theta: number, w: number): number {
  for (let d = -2; d <= 160; d += 0.05) if (-torsoDepth(uncompress(pointOnLine(frame, tr, theta, d), k), torso) >= w) return d;
  return Number.NaN;
}
/**
 * Líneas bajo la huella: su cruce con la cara interna de la pared cae bajo la cara de la sonda ((R + W)·|sen θ| ≤ la
 * media huella: |θ| ≤ 20,6°), con contacto pleno. Más allá, la sección del tronco curva la pared lejos de la sonda.
 */
function footprintLines(k: ProbeCompression): number[] {
  const out: number[] = [];
  for (let i = 0; i < tr.lines; i++) {
    const th = lineAngle(i, tr);
    if ((tr.curvatureRadius + W) * Math.abs(Math.sin(th)) <= tr.footprintMm / 2 && contactCoupling(k, th) >= 0.99) out.push(i);
  }
  return out;
}
const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
/** Ángulo (°) entre una normal y la línea, en el plano de imagen (la compresión es plana en elevación). */
function inPlaneAngleDeg(frame: ProbeFrame, n: Vec3, dir: Vec3): number {
  const e = frame.elevation;
  const en = n[0] * e[0] + n[1] * e[1] + n[2] * e[2];
  const q: Vec3 = [n[0] - en * e[0], n[1] - en * e[1], n[2] - en * e[2]];
  return (Math.acos(Math.min(1, Math.abs(q[0] * dir[0] + q[1] * dir[1] + q[2] * dir[2]) / Math.hypot(...q))) * 180) / Math.PI;
}

describe('la sonda comprime el tejido (decisión 63): la pared bajo la huella queda paralela a la cara', () => {
  // Gemelo, bajo la huella (116 de 192 líneas): la cara interna de la pared (peritoneo y pleura) del tronco rígido
  // iba de 28,6 a 34,6 mm en el flanco, de 28,3 a 36,0 en el renal, de 28,1 a 46,9 en la intercostal y de 21,8 a
  // 57,7 en la subxifoidea basculada; con la compresión, 28,00–28,05 / 28,00–28,05 / 28,0–29,4 / 25,4–36,6 mm.
  // En la subxifoidea (26° de basculación) el talón hunde la piel 6 mm y la pared se lleva la mitad adelgazando
  // (`wallIndentationShare`: la cara interna sube a 25,4 mm), y el lado de la punta queda lejos de concéntrico (el
  // tope del desplazamiento de la placa, `plateShiftMaxMm`).
  const cases: Array<[StartPoint['id'], number, number]> = [
    ['flank', 0.5, W - 0.3],
    ['renal', 0.5, W - 0.3],
    ['intercostal', 2.5, W - 0.3],
    ['subxiphoid', 12, W - 3.5],
  ];
  it.each(cases)(
    '%s: piel en la cara y cara interna a la misma profundidad en todas las líneas (dispersión ≤ %s mm)',
    (id, maxSpread, minInner) => {
      const { frame, k } = view(id);
      const lines = footprintLines(k);
      expect(lines.length, id).toBeGreaterThan(100);
      const skin = lines.map((i) => levelDepth(frame, k, lineAngle(i, tr), 0));
      const inner = lines.map((i) => levelDepth(frame, k, lineAngle(i, tr), W));
      const innerRigid = lines.map((i) => levelDepth(frame, null, lineAngle(i, tr), W));
      const tag = `${id}: piel ${Math.min(...skin).toFixed(2)}–${Math.max(...skin).toFixed(2)}, cara interna ${Math.min(...inner).toFixed(2)}–${Math.max(...inner).toFixed(2)} (rígido ${Math.min(...innerRigid).toFixed(1)}–${Math.max(...innerRigid).toFixed(1)})`;
      // la piel llega a la cara (sin gel: la sonda apoya) y la cara interna de la pared queda a W de ella
      for (const d of skin) expect(Math.abs(d), tag).toBeLessThan(0.15);
      expect(Math.min(...inner), tag).toBeGreaterThan(minInner);
      expect(spread(inner), tag).toBeLessThanOrEqual(maxSpread);
      // el tronco rígido (main): la cúpula
      expect(spread(innerRigid), tag).toBeGreaterThan(5);
    },
  );

  it('en el mundo la normal de las capas de la pared apunta a lo largo de la línea bajo la huella (el eco las ve de frente)', () => {
    // piel, media pared y cara interna, en el plano de imagen, por la jacobiana (J^T de la inversa): flanco y
    // renal ≤ 2,0° en toda la huella (rígido: hasta 20–24°); en ±15° de la intercostal ≤ 7°. En la subxifoidea
    // basculada solo el lado del talón, ≤ 10° (la pared adelgaza hacia el talón: 8,7°); el de la punta tiene la
    // placa con tope (ver la prueba de arriba)
    for (const id of ['flank', 'renal', 'intercostal', 'subxiphoid'] as const) {
      const { frame, k } = view(id);
      let worst = 0;
      let worstCentral = 0;
      let worstRigid = 0;
      for (const i of footprintLines(k)) {
        const th = lineAngle(i, tr);
        const dir = lineDirection(frame, th);
        for (const w of [0.5, W / 2, W - 0.5]) {
          const p = pointOnLine(frame, tr, th, levelDepth(frame, k, th, w));
          const a = inPlaneAngleDeg(frame, warpNormal(warpAt(p, k), torsoDepthGradient(uncompress(p, k), torso)), dir);
          worst = Math.max(worst, a);
          const central = id === 'subxiphoid' ? th <= 0 : Math.abs(th) <= (15 * Math.PI) / 180;
          if (central) worstCentral = Math.max(worstCentral, a);
          const pr = pointOnLine(frame, tr, th, levelDepth(frame, null, th, w));
          worstRigid = Math.max(worstRigid, inPlaneAngleDeg(frame, torsoDepthGradient(pr, torso), dir));
        }
      }
      const tag = `${id}: ≤ ${worst.toFixed(2)}° (±15°: ${worstCentral.toFixed(2)}°; rígido ${worstRigid.toFixed(1)}°)`;
      expect(worstCentral, tag).toBeLessThan(id === 'subxiphoid' ? 10 : 7);
      if (id === 'flank' || id === 'renal') expect(worst, tag).toBeLessThan(2.5);
      expect(worstRigid, tag).toBeGreaterThan(15);
    }
  });

  it('acoplamiento = contacto conseguido: la huella apoya entera en el flanco y el renal, casi entera en la intercostal y la subxifoidea', () => {
    // main (hueco ad hoc de lineCoupling): media 0,833 / 0,764 / 0,935 / 0,783 (flanco, renal, intercostal,
    // subxifoidea) y 160 / 148 / 180 / 151 líneas ≥ 0,5; ahora 1 / 1 / 0,947 / 0,973 y 192 / 192 / 182 / 187
    const mean = (k: ProbeCompression) => {
      let c = 0;
      for (let i = 0; i < tr.lines; i++) c += contactCoupling(k, lineAngle(i, tr)) / tr.lines;
      return c;
    };
    for (const id of ['flank', 'renal'] as const) {
      const { k } = view(id);
      for (let i = 0; i < tr.lines; i++) expect(contactCoupling(k, lineAngle(i, tr)), `${id} línea ${i}`).toBeGreaterThan(0.99);
    }
    expect(mean(view('intercostal').k)).toBeGreaterThan(0.93);
    expect(mean(view('subxiphoid').k)).toBeGreaterThan(0.95);
    // apretar ensancha el contacto; flotar sobre la piel lo quita (el gel salva ~2 mm)
    expect(mean(view('intercostal', { lift: -3 }).k)).toBeGreaterThan(mean(view('intercostal').k) + 0.03);
    const hover = mean(view('flank', { lift: 3.5 }).k);
    expect(hover).toBeGreaterThan(0.05);
    expect(hover).toBeLessThan(0.7);
    expect(mean(view('flank', { lift: CONTACT.gelMm + CONTACT.gelRampMm + 0.1 }).k)).toBe(0);
  });

  it('lo hondo no se mueve: VCI, suprahepáticas y riñón a más de 60 mm, < 1 mm en las cuatro ventanas', () => {
    // gemelo: ≤ 0,26 mm (renal), 0 en las demás; en la placa (≤ W) el tejido se mueve hasta 25 mm
    for (const sp of START_POINTS) {
      const { frame, k } = view(sp.id);
      let worst = 0;
      let n = 0;
      for (let i = 0; i < tr.lines; i += 3)
        for (let d = 60; d <= 180; d += 1.5)
          for (const e of [-2, 0, 2]) {
            const p0 = pointOnLine(frame, tr, lineAngle(i, tr), d);
            const p: Vec3 = [p0[0] + frame.elevation[0] * e, p0[1] + frame.elevation[1] * e, p0[2] + frame.elevation[2] * e];
            const m = uncompress(p, k);
            const c = scene.classify(m, BASELINE_CALIBER);
            const vessel = c.tissue === Tissue.Blood && /^(ivc|hv)/.test(c.vessel ?? '');
            const kidney = [Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule].includes(c.tissue);
            if (!vessel && !kidney) continue;
            n++;
            worst = Math.max(worst, Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2]));
          }
      expect(n, sp.id).toBeGreaterThan(200);
      expect(worst, sp.id).toBeLessThan(1);
    }
  });

  it('con la sonda levantada no hay contacto ni deformación: la identidad exacta', () => {
    // 12 mm: también la subxifoidea, cuyo talón (26° de basculación) hunde la piel 6 mm con la sonda en contacto
    for (const sp of START_POINTS)
      for (const lift of [12, 20]) {
        const { frame, k } = view(sp.id, { lift });
        expect(k.contact.every((c) => c === 0) && k.nodes.every((n) => n[0] === 0 && n[1] === 0), `${sp.id} a ${lift} mm`).toBe(true);
        for (let i = 0; i < tr.lines; i += 7)
          for (let d = -5; d < 120; d += 3.1) {
            const p = pointOnLine(frame, tr, lineAngle(i, tr), d);
            expect(uncompress(p, k)).toEqual(p);
          }
      }
  });

  it('sin pliegues: en un barrido de poses la distancia material a lo largo de cada línea crece (dr/dd ≥ 0,39)', () => {
    // por construcción dr/dd = b > 0 en la placa y ≥ 1 − 1,5/2,5 bajo ella; el barrido lo comprueba en la tabla
    // real (presión, flotación, basculación, inclinación y giro), en el plano y a ±3 mm de él
    let worst = Infinity;
    let where = '';
    for (const sp of START_POINTS)
      for (const lift of [-6, -2, 0, 2])
        for (const rock of [-0.5, 0, 0.5])
          for (const tilt of [-0.4, 0, 0.4]) {
            const { frame, k } = view(sp.id, { lift, rock: (sp.rock ?? 0) + rock, tilt: (sp.tilt ?? 0) + tilt });
            const C = frame.curvatureCenter;
            for (let i = 0; i < tr.lines; i += 12)
              for (const e of [-3, 0, 3]) {
                let prev = -Infinity;
                for (let d = -3; d < 110; d += 0.5) {
                  const p0 = pointOnLine(frame, tr, lineAngle(i, tr), d);
                  const p: Vec3 = [p0[0] + frame.elevation[0] * e, p0[1] + frame.elevation[1] * e, p0[2] + frame.elevation[2] * e];
                  const m = uncompress(p, k);
                  // distancia material al eje de curvatura, en el plano de la cara
                  const q: Vec3 = [m[0] - C[0], m[1] - C[1], m[2] - C[2]];
                  const qe = q[0] * frame.elevation[0] + q[1] * frame.elevation[1] + q[2] * frame.elevation[2];
                  const r = Math.hypot(q[0] - qe * frame.elevation[0], q[1] - qe * frame.elevation[1], q[2] - qe * frame.elevation[2]);
                  if (prev > -Infinity && (r - prev) / 0.5 < worst) {
                    worst = (r - prev) / 0.5;
                    where = `${sp.id} lift ${lift} rock ${rock} tilt ${tilt} línea ${i} e ${e} d ${d}`;
                  }
                  prev = r;
                }
              }
          }
    expect(worst, where).toBeGreaterThanOrEqual(0.39);
  });
});

describe('gemelo del campo y de su jacobiana (TS = GLSL)', () => {
  const { frame, k } = view('subxiphoid');

  it('el gradiente analítico de s es el de las diferencias centrales dentro de la media huella elevacional', () => {
    let worst = 0;
    for (let th = -0.7; th <= 0.7; th += 0.017)
      for (let d = -5; d < 100; d += 1.37)
        for (const e of [-k.halfElevationMm, -2, 0, 3, k.halfElevationMm]) {
          const p0 = pointOnLine(frame, tr, th, d);
          const p: Vec3 = [p0[0] + frame.elevation[0] * e, p0[1] + frame.elevation[1] * e, p0[2] + frame.elevation[2] * e];
          const w = warpAt(p, k);
          const h = 1e-4;
          for (let a = 0; a < 3; a++) {
            const pp: Vec3 = [p[0], p[1], p[2]];
            const pm: Vec3 = [p[0], p[1], p[2]];
            pp[a] += h;
            pm[a] -= h;
            const num = (compressionSample(pp, k).shift - compressionSample(pm, k).shift) / (2 * h);
            worst = Math.max(worst, Math.abs(num - w.grad[a]));
          }
          expect(w.shift).toBeCloseTo(compressionSample(p, k).shift, 10);
        }
    // la tabla es lineal a tramos: junto a un nodo la diferencia central promedia las dos pendientes
    expect(worst).toBeLessThan(1e-3);
  });

  it('warpNormal es el gradiente en el mundo de un campo material (J^T), y warpBound lo acota', () => {
    for (const th of [-0.5, -0.2, 0, 0.3, 0.55])
      for (const d of [0.5, 9, 20, 27, 40, 55]) {
        const p = pointOnLine(frame, tr, th, d);
        const w = warpAt(p, k);
        const n = torsoDepthGradient(uncompress(p, k), torso);
        const got = warpNormal(w, n);
        const h = 1e-4;
        for (let a = 0; a < 3; a++) {
          const pp: Vec3 = [p[0], p[1], p[2]];
          const pm: Vec3 = [p[0], p[1], p[2]];
          pp[a] += h;
          pm[a] -= h;
          const num = (torsoDepth(uncompress(pp, k), torso) - torsoDepth(uncompress(pm, k), torso)) / (2 * h);
          expect(Math.abs(num - got[a]), `θ ${th} d ${d} eje ${a}`).toBeLessThan(2e-3);
        }
        expect(Math.hypot(...got)).toBeLessThanOrEqual(Math.hypot(...n) * warpBound(w) + 1e-9);
      }
  });

  it('toWorld deshace toMaterial con la compresión y la respiración', () => {
    const q = new AnatomyQuery(scene);
    q.setProbeCompression(k);
    const resp = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).step().resp;
    for (const th of [-0.5, 0, 0.4])
      for (const d of [-2, 3, 17, 33, 51, 90]) {
        const p = pointOnLine(frame, tr, th, d);
        const back = q.deformation.toWorld(q.deformation.toMaterial(p, resp), resp);
        expect(Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2])).toBeLessThan(1e-3);
      }
  });

  it('la GLSL lleva las mismas constantes y funciones, y toMaterial deshace la compresión antes que la respiración', () => {
    const c = PROBE_COMPRESSION;
    expect(COMPRESSION_GLSL).toContain(`#define COMP_NODES ${c.nodes}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_DECAY_MM ${c.decayMm.toFixed(4)}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_SPAN_PER_SHIFT ${c.decaySpanPerShift.toFixed(4)}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_PLATE_SHIFT_MAX ${c.plateShiftMaxMm.toFixed(4)}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_LAT_TAPER ${c.lateralTaperSin.toFixed(4)}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_ELEV_TAPER ${c.elevationTaperMm.toFixed(4)}`);
    for (const fn of ['compressionSample', 'uncompress', 'warpAt', 'warpNormal', 'warpBound'])
      expect(COMPRESSION_GLSL, fn).toMatch(new RegExp(`\\b${fn}\\(`));
    expect(ANATOMY_GLSL).toContain(COMPRESSION_GLSL);
    expect(ANATOMY_GLSL).toMatch(
      /vec3 toMaterial\(vec3 p\) \{\n\s+vec3 q = uncompress\(p\);\n\s+vec3 m = q;\n\s+for \(int i = 0; i < 2; i\+\+\) m = q - respDisplacement\(m\);/,
    );
    // sin atan (el arranque con SwiftShader) y sin indexado dinámico de uniforms: la tabla va en la textura de escena
    expect(COMPRESSION_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/\batan\s*\(/);
    expect(COMPRESSION_GLSL).toContain('sceneTexel(COMP_BASE + i)');
    expect(ANATOMY_GLSL).toContain(`#define COMP_BASE ${NODE_BASE + MAX_NODES}`);
    expect(COMPRESSION_BASE).toBe(NODE_BASE + MAX_NODES);
    expect(SCENE_TEX_W * SCENE_TEX_H).toBeGreaterThanOrEqual(COMPRESSION_BASE + c.nodes);
    // el esquema único sube el marco (tres vec4); sin compresión, uCompC.w = 0 (la GLSL no desplaza nada)
    const names = SCENE_UNIFORMS.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(['uCompC', 'uCompAx', 'uCompLat']));
    const ctx = { sample: null as never, tubeCount: 0, compression: null };
    expect(Array.from(SCENE_UNIFORMS.find((u) => u.name === 'uCompC')!.value(scene, ctx))[3]).toBe(0);
    const withK = { ...ctx, compression: k };
    expect(Array.from(SCENE_UNIFORMS.find((u) => u.name === 'uCompAx')!.value(scene, withK))[3]).toBeCloseTo(Math.sin(k.halfAngle), 12);
    expect(compressionReachMm(W)).toBe(W + Math.max(2 * c.decayMm, c.decaySpanPerShift * c.plateShiftMaxMm));
  });
});
