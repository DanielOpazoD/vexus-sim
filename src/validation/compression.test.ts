import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_GLSL,
  PROBE_COMPRESSION,
  compressionPlateMm,
  compressionReachMm,
  compressionSample,
  compressionSpanMm,
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
import { CONTACT, contactCoupling, probeContact, type ProbeContact } from '../probe/contact';
import { CONVEX_C35, clampPose, lineAngle, lineDirection, pointOnLine, probeFrame, type ProbeFrame, type ProbePose } from '../probe/probe';

/**
 * La sonda comprime el tejido (decisión 63): gemelo TS del campo de compresión y del contacto en los puntos de
 * partida. Todas las pruebas de geometría miden sobre `uncompress` (lo que ve `toMaterial`, en CPU y GPU) con el
 * marco efectivo (la sonda hundida) y comparan con el tronco rígido (`null`, el modelo de `main`), que no cumplía
 * ninguna: la pared en cúpula bajo la huella y los bordes sin acoplar (el hueco ad hoc de `lineCoupling`).
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const torso = scene.torso;
const tr = CONVEX_C35;
const W = compressionPlateMm(torso);

function poseOf(sp: StartPoint, extra: Partial<ProbePose> = {}): ProbePose {
  return clampPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, ...extra });
}
function view(id: StartPoint['id'], extra: Partial<ProbePose> = {}): { pose: ProbePose; frame: ProbeFrame; k: ProbeContact } {
  const pose = poseOf(
    START_POINTS.find((s) => s.id === id)!,
    extra,
  );
  const k = probeContact(pose, tr, torso);
  return { pose, frame: k.frame, k };
}
/**
 * Estructura honda que corta la línea central de cada ventana y cuánto se acerca a la sonda al apretar: lo hondo, casi δ
 * (`full`, > δ/2); lo que queda dentro del empuje, a medias (`half`, > δ/5: el riñón a ~60 mm de la porta, decisión 69,
 * y la VSH media a ~90 mm de la subcostal, con 24 mm de hundimiento que el tejido absorbe hasta 175 mm); el riñón justo
 * bajo la pared del flanco, casi nada (`none`, < 0,3·δ: el empuje se lo lleva). La línea central de la intercostal no
 * corta vasos (el ligamento venoso) y la de la transversa epigástrica pasa entre la VCI y la aorta hasta la vértebra.
 */
const CENTRAL_LANDMARK: Record<StartPoint['id'], { landmark: Tissue; vessel?: RegExp; approach: 'full' | 'half' | 'none' }> = {
  subxiphoid: { landmark: Tissue.Blood, vessel: /^ivc/, approach: 'full' },
  epigastric: { landmark: Tissue.Vertebra, approach: 'full' },
  intercostal: { landmark: Tissue.LigamentumVenosum, approach: 'full' },
  subcostal: { landmark: Tissue.Blood, vessel: /^hvMiddle$/, approach: 'half' },
  flank: { landmark: Tissue.Blood, vessel: /^ivc/, approach: 'full' },
  // Primer parénquima junto a la pared; no es el riñón profundo de la pose portal anterior.
  portal: { landmark: Tissue.Liver, approach: 'none' },
  portalTrunk: { landmark: Tissue.RenalCortex, approach: 'half' },
  renal: { landmark: Tissue.RenalCortex, approach: 'none' },
  // Medición geométrica de la nueva ventana: 69,5 → 61,5 mm con δ=18,77 mm.
  hepatorenal: { landmark: Tissue.RenalCortex, approach: 'half' },
};
/** Profundidad bajo la cara (mm) a la que la línea θ cruza la capa de profundidad radial w, con la compresión k. */
function levelDepth(frame: ProbeFrame, k: ProbeCompression | null, theta: number, w: number): number {
  for (let d = -2; d <= 160; d += 0.05) if (-torsoDepth(uncompress(pointOnLine(frame, tr, theta, d), k), torso) >= w) return d;
  return Number.NaN;
}
/** Líneas acopladas (contacto ≥ `min`). */
function coupledLines(k: ProbeCompression, min = 0.5): number[] {
  const out: number[] = [];
  for (let i = 0; i < tr.lines; i++) if (contactCoupling(k, lineAngle(i, tr)) >= min) out.push(i);
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
/** Distancia material al eje de curvatura en el plano de la cara (la coordenada radial de `uncompress`). */
function materialRadius(frame: ProbeFrame, m: Vec3): number {
  const C = frame.curvatureCenter;
  const q: Vec3 = [m[0] - C[0], m[1] - C[1], m[2] - C[2]];
  const e = frame.elevation;
  const qe = q[0] * e[0] + q[1] * e[1] + q[2] * e[2];
  return Math.hypot(q[0] - qe * e[0], q[1] - qe * e[1], q[2] - qe * e[2]);
}

describe('la sonda comprime el tejido (decisión 63): solo empuja y la pared bajo las líneas acopladas queda paralela a la cara', () => {
  // Gemelo (líneas acopladas de 192; la cara interna de la pared, peritoneo y pleura, bajo ellas): flanco 192,
  // 28,35–29,00 mm; renal 192, 27,85–29,05; intercostal 128 (±22,6°), 28,00–30,40; subxifoidea 154 (−34°…+20,5°),
  // 27,40–30,25. El tronco rígido bajo las mismas líneas: una cúpula de 11–40 mm.
  const cases: Array<[StartPoint['id'], number, number]> = [
    ['flank', 192, 1],
    ['renal', 192, 1.5],
    ['intercostal', 110, 3],
    ['subxiphoid', 140, 3],
  ];
  it.each(cases)(
    '%s: ≥ %s líneas acopladas; bajo ellas la piel en la cara y cada capa de la pared a la misma profundidad (cara interna ≤ %s mm)',
    (id, minLines, maxSpread) => {
      const { frame, k } = view(id);
      const lines = coupledLines(k);
      expect(lines.length, id).toBeGreaterThanOrEqual(minLines);
      const at = (kk: ProbeCompression | null, w: number) => lines.map((i) => levelDepth(frame, kk, lineAngle(i, tr), w));
      const skin = at(k, 0);
      const mid = at(k, W / 2);
      const inner = at(k, W);
      const innerRigid = at(null, W);
      const tag = `${id}: piel ${Math.min(...skin).toFixed(2)}–${Math.max(...skin).toFixed(2)}, media pared Δ ${spread(mid).toFixed(2)}, cara interna ${Math.min(...inner).toFixed(2)}–${Math.max(...inner).toFixed(2)} (rígido Δ ${spread(innerRigid).toFixed(1)})`;
      // la piel llega a la cara (el gel salva lo que falte en las líneas de transición)
      for (const d of skin) expect(Math.abs(d), tag).toBeLessThan(0.5);
      // ninguna capa de la pared se dobla alejándose de la cara bajo una línea acoplada: todas quedan a su
      // profundidad (la cara interna a W … W + tolerancia + la mitad de la rampa)
      expect(spread(mid), tag).toBeLessThanOrEqual(maxSpread);
      expect(spread(inner), tag).toBeLessThanOrEqual(maxSpread);
      expect(Math.max(...inner), tag).toBeLessThanOrEqual(W + CONTACT.wallTolMm + CONTACT.wallRampMm);
      // el tronco rígido (main): la cúpula
      expect(spread(innerRigid), tag).toBeGreaterThan(8);
    },
  );

  it('en el mundo la normal de las capas de la pared apunta a lo largo de la línea bajo las líneas de contacto pleno', () => {
    // piel, media pared y cara interna, en el plano de imagen, por la jacobiana (J^T de la inversa): ≤ 2,3° / 3,5° /
    // 7,8° / 6,4° (flanco, renal, intercostal, subxifoidea); rígido 34–60°. La tabla es lineal entre nodos: la
    // pendiente de las capas oscila con el periodo de un nodo. Las pocas líneas de transición (contacto entre 0,5
    // y 0,99: 0 / 0 / 2 / 4) apoyan por el gel y sus capas siguen la piel sin hundir (< 2 mm, la prueba de arriba)
    for (const id of ['flank', 'renal', 'intercostal', 'subxiphoid'] as const) {
      const { frame, k } = view(id);
      let worst = 0;
      let worstRigid = 0;
      for (const i of coupledLines(k, 0.99)) {
        const th = lineAngle(i, tr);
        const dir = lineDirection(frame, th);
        for (const w of [0.5, W / 2, W - 0.5]) {
          const p = pointOnLine(frame, tr, th, levelDepth(frame, k, th, w));
          worst = Math.max(worst, inPlaneAngleDeg(frame, warpNormal(warpAt(p, k), torsoDepthGradient(uncompress(p, k), torso)), dir));
          const pr = pointOnLine(frame, tr, th, levelDepth(frame, null, th, w));
          worstRigid = Math.max(worstRigid, inPlaneAngleDeg(frame, torsoDepthGradient(pr, torso), dir));
        }
      }
      const tag = `${id}: ≤ ${worst.toFixed(2)}° (rígido ${worstRigid.toFixed(1)}°)`;
      expect(worst, tag).toBeLessThan(id === 'flank' || id === 'renal' ? 6 : 9);
      expect(worstRigid, tag).toBeGreaterThan(15);
    }
  });

  it('solo empuja y solo comprime a lo largo de la línea: s ≤ 0 y dr/dd ≥ 1 en un barrido de poses (sin pliegues ni estiramiento)', () => {
    // por construcción s_D ≥ s₀, s_D ≤ 0 y la caída multiplica s_D por algo decreciente; el barrido lo comprueba
    // en la tabla real (presión, flotación, basculación, inclinación y giro), en el plano y a ±3 mm de él. El
    // estiramiento radial (mundo/material) es 1/(dr/dd) ≤ 1: la cota de la revisión era ≤ 1,1. A lo ancho, en
    // cambio, el tejido empujado se abre (ρ/(ρ + s)): ≤ 1,33 en el flanco, 1,41 en el renal, 1,36 en la
    // intercostal y 1,67 en el talón de la subxifoidea (24 mm de empuje)
    let worstRate = Infinity;
    let maxShift = -Infinity;
    let maxPush = 0;
    let where = '';
    for (const sp of START_POINTS)
      for (const lift of [-6, -2, 0, 2])
        for (const rock of [-0.5, 0, 0.5])
          for (const tilt of [-0.4, 0, 0.4]) {
            const { frame, k } = view(sp.id, { lift, rock: (sp.rock ?? 0) + rock, tilt: (sp.tilt ?? 0) + tilt });
            maxPush = Math.max(maxPush, -Math.min(...k.nodes.map((n) => n[0])));
            for (let i = 0; i < tr.lines; i += 12)
              for (const e of [-3, 0, 3]) {
                let prev = -Infinity;
                for (let d = -3; d < k.reachMm + 5; d += 0.5) {
                  const p0 = pointOnLine(frame, tr, lineAngle(i, tr), d);
                  const p: Vec3 = [p0[0] + frame.elevation[0] * e, p0[1] + frame.elevation[1] * e, p0[2] + frame.elevation[2] * e];
                  const c = compressionSample(p, k);
                  maxShift = Math.max(maxShift, c.shift);
                  const r = materialRadius(frame, uncompress(p, k));
                  if (prev > -Infinity && (r - prev) / 0.5 < worstRate) {
                    worstRate = (r - prev) / 0.5;
                    where = `${sp.id} lift ${lift} rock ${rock} tilt ${tilt} línea ${i} e ${e} d ${d}`;
                  }
                  prev = r;
                }
              }
          }
    expect(maxShift).toBeLessThanOrEqual(0);
    expect(worstRate, where).toBeGreaterThanOrEqual(1 - 1e-6);
    // el empuje de la piel (a lo largo de la línea) queda lejos del eje de curvatura (R = 60 mm)
    expect(maxPush).toBeLessThan(0.6 * tr.curvatureRadius);
  });

  it('acoplamiento = contacto conseguido: entero en el flanco y el renal; los bordes que no apoyan, sin acoplar y con transición suave', () => {
    // main (hueco ad hoc de lineCoupling): media 0,833 / 0,764 / 0,935 / 0,783 (flanco, renal, intercostal,
    // subxifoidea). Ahora 1 / 1 en el flanco y el renal; en la intercostal (a lo largo del espacio, casi transversal:
    // la pared lateral del tórax tiene 69 mm de radio en la sección) la pared de los bordes, más allá de ±23°, no
    // queda paralela ni con la presión máxima (haría falta hundir la sonda 50 mm); en la subxifoidea basculada, la
    // punta más allá de +20°
    for (const id of ['flank', 'renal'] as const) {
      const { k } = view(id);
      for (let i = 0; i < tr.lines; i++) expect(contactCoupling(k, lineAngle(i, tr)), `${id} línea ${i}`).toBeGreaterThan(0.99);
    }
    for (const id of ['intercostal', 'subxiphoid'] as const) {
      const { k } = view(id);
      const c = Array.from({ length: tr.lines }, (_, i) => contactCoupling(k, lineAngle(i, tr)));
      // un solo tramo acoplado que contiene el centro
      const on = c.map((x) => x >= 0.5);
      const edges = on.slice(1).filter((x, i) => x !== on[i]).length;
      expect(on[tr.lines / 2], id).toBe(true);
      expect(edges, id).toBeLessThanOrEqual(2);
      expect(on[tr.lines - 1], id).toBe(false);
      // la transición ocupa unas líneas: de ≥ 0,99 a ≤ 0,01 en ≥ 4 líneas, sin saltos de más de 0,25 entre dos
      let jump = 0;
      for (let i = 1; i < tr.lines; i++) jump = Math.max(jump, Math.abs(c[i] - c[i - 1]));
      expect(jump, id).toBeLessThan(0.25);
    }
    const mean = (k: ProbeCompression) => {
      let c = 0;
      for (let i = 0; i < tr.lines; i++) c += contactCoupling(k, lineAngle(i, tr)) / tr.lines;
      return c;
    };
    // apretar ensancha el contacto; flotar sobre la piel lo quita (el gel salva ~2 mm)
    expect(mean(view('intercostal', { lift: -3 }).k)).toBeGreaterThan(mean(view('intercostal').k) + 0.02);
    const hover = mean(view('flank', { lift: 2 }).k);
    expect(hover).toBeGreaterThan(0.05);
    expect(hover).toBeLessThan(0.7);
    expect(mean(view('flank', { lift: CONTACT.gelMm + CONTACT.gelRampMm + 0.1 }).k)).toBe(0);
  });

  it('apretar acerca el campo cercano a la sonda: la cara se hunde δ y lo hondo aparece hasta δ mm menos profundo', () => {
    // δ: 20,0 subxifoidea (tope 26 con 6 mm de hundimiento del talón ya en la pose), 16,0 intercostal (tope),
    // 14,8 flanco y 17,4 renal. La VCI de la subxifoidea de 123 → 107 mm, el ligamento venoso de la intercostal de
    // 132 → 116,5, la VCI del flanco de 127 → 112,5 y la corteza renal de 39 → 38,5; con la decisión 83, 18,6 en la
    // epigástrica (la vértebra de 134,5 → 117,5) y 24,0 en la subcostal (la VSH media de 90,5 → 81)
    for (const sp of START_POINTS) {
      const { pose, frame, k } = view(sp.id);
      const rigid = probeFrame(pose, torso, tr);
      const d = k.summary.indentMm;
      expect(d, sp.id).toBeGreaterThan(10);
      expect(d, sp.id).toBeLessThanOrEqual(k.summary.capacityMm);
      const moved = [0, 1, 2].map((a) => rigid.face[a] - frame.face[a]);
      // a lo largo del eje de la sonda: el mismo plano de imagen, con el origen más abajo en la línea central
      for (let a = 0; a < 3; a++) expect(moved[a], sp.id).toBeCloseTo(-rigid.axial[a] * d, 9);
      // una estructura honda a lo largo de la línea central, con y sin la sonda hundida (una por ventana: una nueva
      // debe declarar la suya)
      const { landmark, vessel, approach } = CENTRAL_LANDMARK[sp.id];
      const depthOf = (fr: ProbeFrame, kk: ProbeCompression | null): number => {
        for (let r = 30; r < 180; r += 0.25) {
          const c = scene.classify(uncompress(pointOnLine(fr, tr, 0, r), kk), BASELINE_CALIBER);
          if (c.tissue === landmark && (!vessel || vessel.test(c.vessel ?? ''))) return r;
        }
        return Number.NaN;
      };
      const before = depthOf(rigid, null);
      const after = depthOf(frame, k);
      const tag = `${sp.id}: ${before.toFixed(1)} → ${after.toFixed(1)} mm (δ ${d.toFixed(1)})`;
      expect(before - after, tag).toBeLessThan(d + 1);
      if (approach === 'none') expect(Math.abs(before - after), tag).toBeLessThan(0.3 * d);
      else if (approach === 'half') expect(before - after, tag).toBeGreaterThan(0.2 * d);
      else expect(before - after, tag).toBeGreaterThan(0.5 * d);
    }
  });

  it('lo hondo: más allá del alcance nada se mueve; los vasos y el riñón a más de 60 mm, menos que la cara', () => {
    // gemelo (mundo): ≤ 11,6 / 7,7 / 9,4 / 13,6 mm (subxifoidea, intercostal, flanco, renal; el riñón está justo
    // bajo la pared del renal) con δ de 15–20 mm; alcance 172 / 124 / 117 / 133 mm
    for (const sp of START_POINTS) {
      const { frame, k } = view(sp.id);
      expect(k.reachMm, sp.id).toBeLessThan(180);
      let worst = 0;
      let n = 0;
      for (let i = 0; i < tr.lines; i += 3)
        for (let d = 60; d <= 180; d += 1.5)
          for (const e of [-2, 0, 2]) {
            const p0 = pointOnLine(frame, tr, lineAngle(i, tr), d);
            const p: Vec3 = [p0[0] + frame.elevation[0] * e, p0[1] + frame.elevation[1] * e, p0[2] + frame.elevation[2] * e];
            const m = uncompress(p, k);
            if (d >= k.reachMm) expect(m, `${sp.id} ${d}`).toEqual(p);
            const c = scene.classify(m, BASELINE_CALIBER);
            const vessel = c.tissue === Tissue.Blood && /^(ivc|hv)/.test(c.vessel ?? '');
            const kidney = [Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule].includes(c.tissue);
            if (!vessel && !kidney) continue;
            n++;
            worst = Math.max(worst, Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2]));
          }
      expect(n, sp.id).toBeGreaterThan(200);
      // En la nueva pose oblicua el talón hunde más que el eje central. El empuje superficial
      // máximo se mide en los nodos de toda la cara; δ central no es su cota geométrica.
      const facePush = Math.max(...k.nodes.map((node) => -node[0]));
      expect(worst, sp.id).toBeLessThan(facePush);
      // Mantener además la banda histórica para las ventanas previamente calibradas.
      if (sp.id !== 'portal') expect(worst, sp.id).toBeLessThan(0.8 * k.summary.indentMm);
    }
  });

  it('con la sonda levantada no hay contacto ni deformación: la identidad exacta', () => {
    // 12 mm: también la subxifoidea, cuyo talón (26° de basculación) hunde la piel 6 mm con la sonda en contacto
    for (const sp of START_POINTS)
      for (const lift of [12, 20]) {
        const { frame, k } = view(sp.id, { lift });
        expect(k.summary.indentMm).toBe(0);
        expect(k.contact.every((c) => c === 0) && k.nodes.every((n) => n[0] === 0 && n[1] === 0), `${sp.id} a ${lift} mm`).toBe(true);
        for (let i = 0; i < tr.lines; i += 7)
          for (let d = -5; d < 120; d += 3.1) {
            const p = pointOnLine(frame, tr, lineAngle(i, tr), d);
            expect(uncompress(p, k)).toEqual(p);
          }
      }
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
    expect(COMPRESSION_GLSL).toContain(`#define COMP_LAT_TAPER ${c.lateralTaperSin.toFixed(4)}`);
    expect(COMPRESSION_GLSL).toContain(`#define COMP_ELEV_TAPER ${c.elevationTaperMm.toFixed(4)}`);
    for (const fn of ['compressionSample', 'uncompress', 'warpAt', 'warpNormal', 'warpBound'])
      expect(COMPRESSION_GLSL, fn).toMatch(new RegExp(`\\b${fn}\\(`));
    expect(ANATOMY_GLSL).toContain(COMPRESSION_GLSL);
    expect(ANATOMY_GLSL).toMatch(/vec3 toMaterial\(vec3 p\) \{\n\s+vec3 q = uncompress\(p\);\n\s+vec3 m = q;\n\s+float D = uResp.x;/);
    // sin atan (el arranque con SwiftShader) y sin indexado dinámico de uniforms: la tabla va en la textura de escena
    expect(COMPRESSION_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/\batan\s*\(/);
    expect(COMPRESSION_GLSL).toContain('sceneTexel(COMP_BASE + i)');
    expect(ANATOMY_GLSL).toContain(`#define COMP_BASE ${NODE_BASE + MAX_NODES}`);
    expect(COMPRESSION_BASE).toBe(NODE_BASE + MAX_NODES);
    expect(SCENE_TEX_W * SCENE_TEX_H).toBeGreaterThanOrEqual(COMPRESSION_BASE + c.nodes);
    // el esquema único sube el marco (tres vec4) con R + alcance en uCompC.w; sin compresión, uCompC.w = 0 (la
    // GLSL no desplaza nada). El radio viaja en la tabla (su .w)
    const names = SCENE_UNIFORMS.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(['uCompC', 'uCompAx', 'uCompLat']));
    const ctx = { sample: null as never, tubeCount: 0, compression: null };
    expect(Array.from(SCENE_UNIFORMS.find((u) => u.name === 'uCompC')!.value(scene, ctx))[3]).toBe(0);
    const withK = { ...ctx, compression: k };
    expect(Array.from(SCENE_UNIFORMS.find((u) => u.name === 'uCompC')!.value(scene, withK))[3]).toBeCloseTo(k.radiusMm + k.reachMm, 4);
    expect(Array.from(SCENE_UNIFORMS.find((u) => u.name === 'uCompAx')!.value(scene, withK))[3]).toBeCloseTo(Math.sin(k.halfAngle), 12);
    expect(COMPRESSION_GLSL).toContain('float g = compressionProfile(rho - v.w, v.xyz, gd, gp);');
    // el alcance: el máximo de D + S en la tabla, y s = 0 a partir de él
    expect(k.reachMm).toBe(Math.max(...k.nodes.map((n) => n[2] + compressionSpanMm(n[1]))));
    expect(compressionReachMm(k.nodes)).toBe(k.reachMm);
  });
});
