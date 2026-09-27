import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { ANATOMY_GLSL, NODE_BASE, MAX_TUBES, TUBE_HEADER_TEXELS } from '../anatomy/gpu/anatomy.glsl';
import {
  TUBE_SHAPE,
  tubeFaceGradient,
  tubeHash,
  tubeNoise,
  tubeQuery,
  tubeShapeMaxFactor,
  tubeShapeOf,
  tubeShapeTexel,
  type Tube,
} from '../anatomy/primitives';
import { Tissue } from '../anatomy/tissues';
import { PW_GATE_VESSELS, tubeShapeClassOf } from '../anatomy/vesselTree';
import { CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { VESSEL_META } from '../physiology/vessels';

/**
 * Vasos orgánicos (decisión 90): la sección anisótropa y el radio modulado de cada vaso, su gemelo GLSL (la forma viaja en
 * el téxel H4 de la cabecera de cada tubo) y la VCI con su recorrido y su calibre, sin tocar el sitio de medida.
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p: Vec3, d: Vec3, t: number): Vec3 => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe('Forma orgánica de los vasos (decisión 90)', () => {
  it('las suprahepáticas y la porta llevan su forma anclada (semilla = su índice en la lista de la GPU); el resto, ninguna', () => {
    scene.vessels.forEach((v, i) => {
      const cls = tubeShapeClassOf(v.id);
      const system = VESSEL_META[v.id].system;
      expect(cls !== null, v.id).toBe((system === 'hepaticVein' || system === 'portal') && !PW_GATE_VESSELS.includes(v.id));
      if (!cls) {
        expect(v.tube.shape, v.id).toBeUndefined();
        return;
      }
      expect(v.tube.shape?.seed, v.id).toBe(i);
      expect(v.tube.shape, v.id).toEqual(tubeShapeOf(i, cls, v.tube.nodes));
      // ŵ unitaria y perpendicular a la cuerda del tubo (del primer nodo al último); κ dentro del rango de su clase
      const s = v.tube.shape!;
      const [p0, p1] = [v.tube.nodes[0].p, v.tube.nodes.at(-1)!.p];
      expect(Math.hypot(...s.w)).toBeCloseTo(1, 12);
      expect(Math.abs(dot(s.w, unit([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]])))).toBeLessThan(1e-9);
      const k = TUBE_SHAPE.classes[cls].kappa;
      expect(s.kappa).toBeGreaterThanOrEqual(k[0]);
      expect(s.kappa).toBeLessThanOrEqual(k[1]);
    });
    for (const d of scene.ducts) expect(d.tube.shape, d.id).toBeUndefined();
    // el radio smoothstep, solo en la VCI infrahepática (explícito, no deducido de su sección elíptica): la supradiafragmática
    // conserva el embudo lineal de la decisión 85, y ningún tubo lleva a la vez forma y radio smoothstep (el téxel H4)
    expect(scene.vessels.filter((v) => v.tube.smoothRadius).map((v) => v.id)).toEqual(['ivcInfra']);
    expect([...scene.vessels, ...scene.ducts].filter((v) => v.tube.shape && v.tube.smoothRadius)).toEqual([]);
    expect(scene.vessels.filter((v) => v.tube.shape && VESSEL_META[v.id].system === 'ivc')).toEqual([]);
    // los vasos de las puertas PW de la cadena del alumno (la suprahepática derecha y el tronco portal, con sus ramas), la
    // cadena renal (interlobares junto a su arteria) y las arterias quedan como estaban
    for (const id of [
      'hvRight',
      'pvTrunk',
      'interlobarVein2',
      'interlobarArtery2',
      'renalVeinLeft',
      'aorta',
      'hepaticArtery',
      'ivcInfra',
    ] as const)
      expect(scene.vesselById.get(id)!.tube.shape, id).toBeUndefined();
    expect(scene.vessels.filter((v) => v.id === 'hvRight' && v.flowFactor !== undefined).every((v) => !v.tube.shape)).toBe(true);
    // la misma escena da las mismas formas (el paciente no cambia su anatomía)
    const again = new AnatomyScene(NORMAL_ADULT);
    expect(again.vessels.map((v) => v.tube.shape)).toEqual(scene.vessels.map((v) => v.tube.shape));
    // las venas no son círculos: κ medio de sus clases a mitad de rango
    const veins = scene.vessels.filter((v) => tubeShapeClassOf(v.id) === 'vein');
    const mean = veins.reduce((a, v) => a + v.tube.shape!.kappa, 0) / veins.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.7);
  });

  it('la sección es una elipse de área conservada: semiejes r·(1 + κ)^(±1/4), y la vena distendida se redondea', () => {
    // tubo recto sintético sin ruido (amp 0) para aislar la sección
    const w: Vec3 = unit([0.3, 0.8, 0]);
    const tube: Tube = {
      kind: 'tube',
      nodes: [
        { p: [0, 0, -20], r: 4 },
        { p: [0, 0, 20], r: 4 },
      ],
      apScale: 1,
      shape: { seed: 3, w, kappa: 0.6, amp: 0 },
    };
    const minor = w;
    const major = unit(cross([0, 0, 1], w));
    const edge = (dir: Vec3, scale: number) => {
      let lo = 0;
      let hi = 10;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (tubeQuery(along([0, 0, 0], dir, m), tube, scale).d < 0) lo = m;
        else hi = m;
      }
      return lo;
    };
    const a = edge(major, 1);
    const b = edge(minor, 1);
    expect(a).toBeCloseTo(4 * Math.pow(1.6, 0.25), 6);
    expect(b).toBeCloseTo(4 * Math.pow(1.6, -0.25), 6);
    expect(a * b).toBeCloseTo(16, 6);
    // con la escala de radio 1,6 (la congestión grave), κ/1,6²: casi redonda
    const a2 = edge(major, 1.6);
    const b2 = edge(minor, 1.6);
    expect(b2 / a2).toBeGreaterThan(b / a);
    expect(b2 / a2).toBeCloseTo(1 / Math.sqrt(1 + 0.6 / 2.56), 6);
    // y la curvatura de la cara en los extremos de los ejes es la de la elipse: a/b² y b/a²
    const hitA = tubeQuery(along([0, 0, 0], major, a), tube, 1);
    const hitB = tubeQuery(along([0, 0, 0], minor, b), tube, 1);
    expect(tubeFaceGradient(along([0, 0, 0], major, a), tube, 1, hitA).curvature).toBeCloseTo(a / (b * b), 6);
    expect(tubeFaceGradient(along([0, 0, 0], minor, b), tube, 1, hitB).curvature).toBeCloseTo(b / (a * a), 6);
    // el mayor saliente que cuenta la contención de las ramas cubre la elipse y el ruido de la clase
    expect(tubeShapeMaxFactor('vein', 1)).toBeGreaterThanOrEqual((1 + TUBE_SHAPE.classes.vein.amp) * Math.pow(1.9, 0.25) - 1e-12);
  });

  it('en los vasos curvos del modelo la sección apenas crece donde el segmento se aparta de la cuerda hacia ŵ (≤ 4 % de área)', () => {
    // el área de la sección perpendicular a un segmento de tangente t es πr²·√(1 + κ)/√(1 + κ·(1 − (ŵ·t)²)): 1 si ŵ ⊥ t.
    // Con ŵ perpendicular al primer segmento, el codo de 65° de la rama lateral izquierda de la porta crecía un 14 %
    const factor = (w: Vec3, kappa: number, t: Vec3) => Math.sqrt(1 + kappa) / Math.sqrt(1 + kappa * (1 - dot(w, t) ** 2));
    let worst = 1;
    for (const c of CASES) {
      for (const v of new AnatomyScene(c).vessels) {
        const sh = v.tube.shape;
        if (!sh) continue;
        const n = v.tube.nodes;
        for (let i = 0; i < n.length - 1; i++) {
          const t = unit([n[i + 1].p[0] - n[i].p[0], n[i + 1].p[1] - n[i].p[1], n[i + 1].p[2] - n[i].p[2]]);
          worst = Math.max(worst, factor(sh.w, sh.kappa, t));
        }
      }
    }
    expect(worst).toBeLessThan(1.04);
    // y la fórmula es la sección real: el área medida (sin ruido) en el segmento más inclinado hacia ŵ de un vaso de varios
    // segmentos, por bisección de la luz en 720 radios de su plano perpendicular
    const v = scene.vesselById.get('pvLeftLateral')!;
    const tube: Tube = { ...v.tube, shape: { ...v.tube.shape!, amp: 0 } };
    const n = tube.nodes;
    const segs = n.slice(0, -1).map((a, i) => unit([n[i + 1].p[0] - a.p[0], n[i + 1].p[1] - a.p[1], n[i + 1].p[2] - a.p[2]]));
    const i = segs.reduce((best, t, k) => (Math.abs(dot(tube.shape!.w, t)) > Math.abs(dot(tube.shape!.w, segs[best])) ? k : best), 0);
    expect(segs.length).toBeGreaterThan(1);
    const t = segs[i];
    const e1 = unit(cross(t, [0.3, 0.5, 0.8]));
    const e2 = cross(t, e1);
    const c: Vec3 = [0, 1, 2].map((j) => (n[i].p[j] + n[i + 1].p[j]) / 2) as Vec3;
    let area = 0;
    for (let k = 0; k < 720; k++) {
      const a = (2 * Math.PI * k) / 720;
      const dir: Vec3 = [0, 1, 2].map((j) => e1[j] * Math.cos(a) + e2[j] * Math.sin(a)) as Vec3;
      let lo = 0;
      let hi = 20;
      for (let it = 0; it < 50; it++) {
        const m = (lo + hi) / 2;
        if (tubeQuery(along(c, dir, m), tube, 1).d < 0) lo = m;
        else hi = m;
      }
      area += (lo * lo * Math.PI) / 720;
    }
    const r = (n[i].r + n[i + 1].r) / 2;
    expect(area / (Math.PI * r * r)).toBeCloseTo(factor(tube.shape!.w, tube.shape!.kappa, t), 3);
  });

  it('el ruido del radio a lo largo del eje: acotado por la amplitud, continuo, correlado a centímetros e independiente a más de dos celdas', () => {
    const L = TUBE_SHAPE.latticeMm;
    const values: number[] = [];
    for (let s = 0; s <= 40 * L; s += 0.5) {
      const [n] = tubeNoise(17, s);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      values.push(n);
    }
    // continuo en las fronteras de celda (valor y derivada nula por el fundido smoothstep)
    for (let c = 1; c < 10; c++) {
      const [l, dl] = tubeNoise(17, c * L - 1e-9);
      const [r, dr] = tubeNoise(17, c * L + 1e-9);
      expect(Math.abs(l - r)).toBeLessThan(1e-6);
      expect(Math.abs(dl) + Math.abs(dr)).toBeLessThan(1e-6);
    }
    // la derivada analítica es la numérica
    for (const s of [3.3, 17.9, 44.1, 101.7]) {
      const num = (tubeNoise(17, s + 1e-4)[0] - tubeNoise(17, s - 1e-4)[0]) / 2e-4;
      expect(tubeNoise(17, s)[1]).toBeCloseTo(num, 6);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const corr = (lag: number) => {
      const k = Math.round(lag / 0.5);
      let num = 0;
      let den = 0;
      for (let i = 0; i + k < values.length; i++) num += (values[i] - mean) * (values[i + k] - mean);
      for (const v of values) den += (v - mean) ** 2;
      return num / den;
    };
    expect(Math.abs(mean)).toBeLessThan(0.15);
    expect(corr(5)).toBeGreaterThan(0.8);
    expect(Math.abs(corr(3 * L))).toBeLessThan(0.25);
    // otro tubo, otro ruido
    expect(tubeNoise(18, 45)[0]).not.toBeCloseTo(tubeNoise(17, 45)[0], 3);
    // el hash entero (el mismo en la GLSL, uint): valores de referencia de lowbias32, calculados aparte con BigInt
    expect(tubeHash(0)).toBe(0);
    expect(tubeHash(1)).toBe(0x688990c0);
    expect(tubeHash(0x12345678)).toBe(0xf5e71c96);
    expect(tubeHash(0xffffffff)).toBe(0x6768824a);
  });

  it('el gradiente analítico (normal y norma del eco) es el de la distancia con la forma, dentro del segmento y en las tapas', () => {
    let worst = 1;
    let normErr = 0;
    let n = 0;
    const check = (p: Vec3, tube: Tube) => {
      const hit = tubeQuery(p, tube, 1);
      const { gradient } = tubeFaceGradient(p, tube, 1, hit);
      const h = 1e-4;
      const g: Vec3 = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const pp: Vec3 = [...p];
        const pm: Vec3 = [...p];
        pp[a] += h;
        pm[a] -= h;
        g[a] = (tubeQuery(pp, tube, 1).d - tubeQuery(pm, tube, 1).d) / (2 * h);
      }
      const gl = Math.hypot(...g);
      const al = Math.hypot(...gradient);
      worst = Math.min(worst, dot(g, gradient) / (gl * al));
      normErr = Math.max(normErr, Math.abs(al / gl - 1));
      n++;
    };
    for (const v of scene.vessels.filter((x) => x.tube.shape && x.flowFactor === undefined)) {
      const nodes = v.tube.nodes;
      // la tapa del primer nodo: puntos más allá de él, junto a su superficie
      const t0 = unit([nodes[0].p[0] - nodes[1].p[0], nodes[0].p[1] - nodes[1].p[1], nodes[0].p[2] - nodes[1].p[2]]);
      const side = unit(cross(t0, [0.3, 0.5, 0.8]));
      const cap = along(along(nodes[0].p, t0, 0.6 * nodes[0].r), side, 0.6 * nodes[0].r);
      if (tubeQuery(cap, v.tube, 1).s === 0) check(cap, v.tube);
      for (let i = 0; i < nodes.length - 1; i++)
        for (const t of [0.13, 0.5, 0.87]) {
          const c: Vec3 = [0, 1, 2].map((j) => nodes[i].p[j] + (nodes[i + 1].p[j] - nodes[i].p[j]) * t) as Vec3;
          const ax = unit([nodes[i + 1].p[0] - nodes[i].p[0], nodes[i + 1].p[1] - nodes[i].p[1], nodes[i + 1].p[2] - nodes[i].p[2]]);
          const e1 = unit(cross(ax, [0.3, 0.5, 0.8]));
          const e2 = cross(ax, e1);
          for (let k = 0; k < 6; k++) {
            const ang = (k * Math.PI) / 3 + 0.2;
            const dir: Vec3 = [
              e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang),
              e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang),
              e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang),
            ];
            // cerca de la pared: 0,3 mm dentro de la luz local en esa dirección
            let lo = 0;
            let hi = 3 * nodes[i].r + 3;
            for (let it = 0; it < 50; it++) {
              const m = (lo + hi) / 2;
              if (tubeQuery(along(c, dir, m), v.tube, 1).d < 0) lo = m;
              else hi = m;
            }
            const p = along(c, dir, Math.max(0, lo - 0.3));
            if (tubeQuery(p, v.tube, 1).segment === i) check(p, v.tube);
          }
        }
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeGreaterThan(0.9999);
    expect(normErr).toBeLessThan(1e-4);
  });

  it('la velocidad sigue uniforme por vaso (decisión 6): en el eje, la misma en todo su recorrido aunque el radio ondule', () => {
    // en apnea espiratoria el mundo es el marco material (sin desplazamiento respiratorio ni sonda)
    const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
    const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 2 });
    for (let i = 0; i < 400; i++) engine.step();
    const q = new AnatomyQuery(scene);
    const hv = scene.vesselById.get('hvMiddle')!;
    const scale = q.caliberFor(engine.sample).radiusScale('hvMiddle');
    const nodes = hv.tube.nodes;
    const speeds: number[] = [];
    // radio local sobre el lineal de sus nodos: lo que pone la forma (el cono de los nodos solo no lo cambia)
    const radii: number[] = [];
    // del segundo nodo a la desembocadura, sin el último tramo (dentro del tronco común y la VCI)
    for (let i = 1; i < nodes.length - 2; i++)
      for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const c: Vec3 = [0, 1, 2].map((j) => nodes[i].p[j] + (nodes[i + 1].p[j] - nodes[i].p[j]) * t) as Vec3;
        const w = q.classifyWorld(c, engine.sample);
        if (w.vessel !== 'hvMiddle' || !w.bloodVelocity || !w.vesselHit) continue;
        speeds.push(Math.hypot(...w.bloodVelocity));
        radii.push(w.vesselHit.r / tubeQuery(c, { ...hv.tube, shape: undefined }, scale).r);
      }
    expect(speeds.length).toBeGreaterThan(8);
    // el radio local cambia con la forma (su ruido a lo largo del eje) y la velocidad en el eje no: u·(n + 2)/n
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.03);
    const peak = (Math.abs(engine.sample.velocities.hvMiddle) * (hv.profileN + 2)) / hv.profileN;
    for (const s of speeds) expect(s / peak).toBeCloseTo(1, 6);
    // y el área que usa la fisiología no depende de la forma (radio de referencia)
    expect(scene.vesselAreas().hvMiddle).toBeCloseTo(Math.PI * hv.refRadius * hv.refRadius, 9);
  });

  it('la GLSL es el gemelo: la forma viaja en el téxel H4 de cada tubo y el ruido usa el mismo hash, celda y sal', () => {
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    expect(TUBE_HEADER_TEXELS).toBe(5);
    expect(NODE_BASE).toBe(MAX_TUBES * TUBE_HEADER_TEXELS);
    expect(glsl).toContain(`#define TUBE_HDR ${TUBE_HEADER_TEXELS}`);
    expect(glsl).toContain(
      'vec4 h4 = sceneTexel(t * TUBE_HDR + 4); vec3 wt = h4.xyz; float amp = max(h4.w, 0.0); bool smoothR = h4.w < 0.0;',
    );
    // el radio smoothstep, por la marca de H4 (no por la sección elíptica), en la consulta y en la cara
    expect(glsl).toContain('bool smoothR = h4.w < 0.0;');
    expect(glsl).toContain('float r = (a.w + (b.w - a.w) * (smoothR ? s * s * (3.0 - 2.0 * s) : s)) * rs;');
    expect(glsl).toContain('float rLin = (a.w + (b.w - a.w) * (smoothR ? s * s * (3.0 - 2.0 * s) : s)) * rs;');
    expect(glsl).not.toContain('apScale != 1.0 ? s * s');
    expect(glsl).toContain('float cK = inversesqrt(sqrt(1.0 + dot(wt, wt)));');
    expect(glsl).toContain('x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;');
    expect(glsl).toContain(`^ ${TUBE_SHAPE.salt >>> 0}u)`);
    expect(glsl).toContain(`float x = arc / ${TUBE_SHAPE.latticeMm.toFixed(4)};`);
    expect(glsl).toContain(`bool near = bDist - bR < ${TUBE_SHAPE.noiseReachMm.toFixed(4)} + h4.w * bR;`);
    // la semilla del ruido es el índice original del tubo (H2.w), el que la escena usa en TS; la cara es la del tubo que gana
    expect(glsl).toContain('tubeNoise(uint(sceneTexel(t * TUBE_HDR + 2).w + 0.5), segArc, dN)');
    expect(glsl).toContain('tubeNoise(uint(sceneTexel(t * TUBE_HDR + 2).w + 0.5), arc, dN)');
    expect(glsl).toContain('if (bestT >= 0) tubeFace(m, bestT, bSeg, bSegS, bSegArc, bTan, bN, bKc);');
    // el téxel de la GPU: wt = ŵ·√(κ/max(1, s)²) y la amplitud; ceros sin forma
    const hvTube = scene.vessels.find((v) => v.id === 'hvMiddle')!.tube;
    const s = hvTube.shape!;
    const [x, y, z, amp] = tubeShapeTexel(hvTube, 1.6);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.sqrt(s.kappa / 2.56), 12);
    expect(amp).toBe(s.amp);
    expect(tubeShapeTexel({}, 1)).toEqual([0, 0, 0, 0]);
    // la VCI infrahepática: la marca del radio smoothstep; con forma y smoothstep a la vez el téxel no cabe
    expect(tubeShapeTexel(scene.vesselById.get('ivcInfra')!.tube, 1.3)).toEqual([0, 0, 0, -1]);
    expect(() => tubeShapeTexel({ shape: s, smoothRadius: true }, 1)).toThrow();
  });

  it('la GLSL no encarece la compilación: la cara, una vez y fuera del bucle de tubos; el de segmentos, con las vueltas del tubo', () => {
    // el JIT de SwiftShader (la e2e y el CI) desenrollaba el bucle de segmentos con la cota constante y un cuerpo corto, en
    // cada copia de classify: el arranque pasaba de ~55 s a ~110 s con la máquina cargada (decisión 90)
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    const tubeLoop = glsl.slice(glsl.indexOf('for (int t = 0; t < MAX_TUBES; t++)'), glsl.indexOf('if (bestT >= 0) tubeFace('));
    expect(tubeLoop).toContain('tubeQuery(m, t,');
    expect(tubeLoop).not.toContain('tubeFace(');
    expect(glsl.match(/tubeFace\(m, /g)).toHaveLength(1);
    expect(glsl).toContain('int segments = min(count - 1, MAX_TUBE_SEGMENTS); for (int i = 0; i < segments; i++) {');
  });

  it('donde nace una rama, su luz con forma apenas asoma de la de su madre (≤ 0,3 mm, bajo la resolución)', () => {
    // la sección elíptica y el ruido del radio de la hija y de la madre no coinciden en la unión: un escalón de décimas de
    // milímetro (medido: ≤ 0,21 mm con la escala basal, ≤ 0,17 con la dilatación de la congestión) frente a una PSF de 1–3 mm.
    // El anillo de la luz de la hija en su nodo de origen (perpendicular a su eje) frente a la luz de la madre (u otra rama
    // del mismo id, la que continúa)
    let worst = -Infinity;
    for (const [sc, scale] of [
      [scene, 1],
      [new AnatomyScene(SEVERE_CONGESTION), 1.6],
    ] as const) {
      for (const b of sc.vessels.filter((x) => x.flowFactor !== undefined)) {
        const [n0, n1] = b.tube.nodes;
        const [o, e] = n0.r >= n1.r ? [n0, n1] : [n1, n0];
        const t = unit([e.p[0] - o.p[0], e.p[1] - o.p[1], e.p[2] - o.p[2]]);
        const e1 = unit(cross(t, [0.3, 0.5, 0.8]));
        const e2 = cross(t, e1);
        const others = sc.vessels.filter((v) => v !== b && v.id === b.id).map((v) => v.tube);
        for (let k = 0; k < 36; k++) {
          const a = (2 * Math.PI * k) / 36;
          const dir: Vec3 = [0, 1, 2].map((j) => e1[j] * Math.cos(a) + e2[j] * Math.sin(a)) as Vec3;
          let lo = 0;
          let hi = 10;
          for (let it = 0; it < 40; it++) {
            const m = (lo + hi) / 2;
            if (tubeQuery(along(o.p, dir, m), b.tube, scale).d < 0) lo = m;
            else hi = m;
          }
          const p = along(o.p, dir, lo);
          worst = Math.max(worst, Math.min(...others.map((ot) => tubeQuery(p, ot, scale).d)));
        }
      }
    }
    expect(worst).toBeLessThan(0.3);
  });

  it('más allá del alcance del ruido ninguna pared llega a la muestra: la GPU puede no evaluarlo sin cambiar la clasificación', () => {
    // la pared más gruesa es la periportal (0,24·r, hasta 1,4 mm) o la de la aorta (1,2)
    for (const c of CASES) {
      const sc = new AnatomyScene(c);
      for (const v of sc.vessels)
        expect(Math.max(v.wallMm, v.wallTissue === Tissue.VesselWallPortal ? 1.4 : 0)).toBeLessThan(TUBE_SHAPE.noiseReachMm);
      for (const d of sc.ducts) expect(d.wallMm).toBeLessThan(TUBE_SHAPE.noiseReachMm);
    }
  });
});

describe('VCI orgánica (decisión 90)', () => {
  const ivc = scene.vesselById.get('ivcInfra')!;
  const supra = scene.vesselById.get('ivcSupra')!;
  // radio del eje a una altura z (el de la consulta: smoothstep entre nodos en la VCI infrahepática, lineal por encima)
  const radiusAt = (z: number): number => {
    const t = z >= 35 ? supra.tube : ivc.tube;
    const n = t.nodes;
    const i = n.findIndex((a, j) => j < n.length - 1 && (a.p[2] - z) * (n[j + 1].p[2] - z) <= 0);
    const c: Vec3 = [0, 1, 2].map((j) => n[i].p[j] + ((n[i + 1].p[j] - n[i].p[j]) * (z - n[i].p[2])) / (n[i + 1].p[2] - n[i].p[2])) as Vec3;
    return tubeQuery(c, t, 1).r;
  };
  const bend = (a: Vec3, b: Vec3, c: Vec3) => {
    const u = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const w = unit([c[0] - b[0], c[1] - b[1], c[2] - b[2]]);
    return (Math.acos(Math.min(1, dot(u, w))) * 180) / Math.PI;
  };

  it('la VCI que puede medir el alumno conserva su calibre: radio de referencia (10 mm) de z −14 a 35 y 10–10,2 hasta z 47', () => {
    for (let z = -14; z <= 35; z += 1) expect(radiusAt(z), `z ${z}`).toBeCloseTo(ivc.refRadius, 9);
    for (let z = 35; z <= 47; z += 1) {
      expect(radiusAt(z), `z ${z}`).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(radiusAt(z), `z ${z}`).toBeLessThanOrEqual(10.2 + 1e-9);
    }
    // las áreas de la fisiología no cambian (el radio de referencia y la sección elíptica)
    expect(scene.vesselAreas().ivcInfra).toBeCloseTo(Math.PI * 100 * 0.8, 6);
  });

  it('en la imagen, el diámetro AP de la VCI es el de la fisiología (±2 %) de z −14 a 20, en los siete casos, llena y vacía', () => {
    // la vertical por el eje, como la medida del alumno en la subxifoidea (la línea M «más perpendicular» de la e2e cae a
    // z ≈ 0; el estándar, 1–2 cm bajo la confluencia de las suprahepáticas, que desembocan a z 39–43): la sangre contigua
    // al eje (la que ve el alumno, sea cual sea el vaso que la etiqueta) frente al dAp de la fisiología en su máximo y su
    // mínimo. Más arriba, la luz de las suprahepáticas dilatadas se suma a la de la VCI (también en main: 5,8 % a z 22).
    // Una ondulación del +5 % a z −6 la inflaba un 6 % en todos los casos (revisión adversarial); main: ≤ 1,7 %
    const zs = Array.from({ length: 18 }, (_, k) => -14 + 2 * k);
    const nodes = [...ivc.tube.nodes, ...supra.tube.nodes.slice(1)];
    const axisAt = (z: number): [number, number] => {
      const i = nodes.findIndex((a, j) => j < nodes.length - 1 && (a.p[2] - z) * (nodes[j + 1].p[2] - z) <= 0);
      const t = (z - nodes[i].p[2]) / (nodes[i + 1].p[2] - nodes[i].p[2]);
      return [nodes[i].p[0] + (nodes[i + 1].p[0] - nodes[i].p[0]) * t, nodes[i].p[1] + (nodes[i + 1].p[1] - nodes[i].p[1]) * t];
    };
    let worst = 0;
    for (const c of CASES) {
      const sc = new AnatomyScene(c);
      const engine = new PhysiologyEngine(c, sc.vesselAreas(), { historySeconds: 2 });
      let hi = engine.step();
      let lo = hi;
      for (let i = 0; i < 1500; i++) {
        const s = engine.step();
        if (s.ivc.dApMm > hi.ivc.dApMm) hi = structuredClone(s);
        if (s.ivc.dApMm < lo.ivc.dApMm) lo = structuredClone(s);
      }
      for (const smp of [hi, lo]) {
        const cal = new AnatomyQuery(sc).caliberFor(smp);
        for (const z of zs) {
          const [x, y0] = axisAt(z);
          const blood = (y: number) => sc.classify([x, y, z], cal).tissue === Tissue.Blood;
          const edge = (dir: 1 | -1) => {
            let a = 0;
            while (blood(y0 + dir * (a + 0.25))) a += 0.25;
            let b = a + 0.25;
            for (let it = 0; it < 12; it++) {
              const m = (a + b) / 2;
              if (blood(y0 + dir * m)) a = m;
              else b = m;
            }
            return a;
          };
          const err = (edge(1) + edge(-1)) / smp.ivc.dApMm - 1;
          expect(Math.abs(err), `${c.id} z ${z} dAp ${smp.ivc.dApMm.toFixed(2)}`).toBeLessThan(0.02);
          worst = Math.max(worst, Math.abs(err));
        }
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it('por debajo, el calibre se estrecha y se ensancha sin quiebros y el eje se curva también en el plano coronal', () => {
    // una cintura del 7 % donde la porta le pasa por delante (z −40), entre el nivel renal (9,75 mm) y el radio de
    // referencia (z −14): el calibre ya no crece monótono del nivel renal a la aurícula (antes, 9,8 → 10 lineal)
    const r: number[] = [];
    for (let z = -64; z <= -14; z += 1) r.push(radiusAt(z));
    expect(Math.min(...r) / 10).toBeLessThan(0.95);
    expect(Math.min(...r) / 10).toBeGreaterThan(0.9);
    expect(radiusAt(-40)).toBeLessThan(radiusAt(-64) - 0.3);
    expect(radiusAt(-40)).toBeLessThan(radiusAt(-14) - 0.5);
    // sin quiebros: la pendiente del radio es continua en los nodos (smoothstep)
    for (const n of ivc.tube.nodes.slice(1, -1)) {
      const z = n.p[2];
      if (z < -100) continue;
      expect(Math.abs(radiusAt(z + 0.05) - radiusAt(z - 0.05)), `z ${z}`).toBeLessThan(0.002);
    }
    // el eje en el plano coronal (x frente a z) se aparta > 1 mm de la cuerda entre el nivel renal y z −14
    const nodes = ivc.tube.nodes.filter((n) => n.p[2] >= -64 && n.p[2] <= -14);
    const [a, b] = [nodes[0].p, nodes[nodes.length - 1].p];
    const off = Math.max(...nodes.map((n) => Math.abs(n.p[0] - (a[0] + ((b[0] - a[0]) * (n.p[2] - a[2])) / (b[2] - a[2])))));
    expect(off).toBeGreaterThan(1);
    // con quiebros del eje pequeños en los nodos: ≤ 5,5° en el tramo que se ve (z ≥ −40) y ≤ 7,5° en la «S» de la
    // decisión 69 (la lordosis en L3 y el nivel renal; antes 7,8° y 8,3°); sin ellos la pared de la VCI dilatada se ve
    // como una poligonal. La unión con la supradiafragmática (z 35), la de la decisión 69: 5,8°
    const seg = ivc.tube.nodes;
    for (let i = 1; i < seg.length - 1; i++)
      expect(bend(seg[i - 1].p, seg[i].p, seg[i + 1].p), `nodo z ${seg[i].p[2]}`).toBeLessThan(seg[i].p[2] >= -40 ? 5.5 : 7.5);
    expect(seg.at(-1)!.p).toEqual(supra.tube.nodes[0].p);
    expect(bend(seg.at(-2)!.p, seg.at(-1)!.p, supra.tube.nodes[1].p)).toBeLessThan(5.9);
  });

  it('la suprahepática derecha (puerta PW) entra en la VCI como antes y la tributaria de la media desemboca en su eje curvado', () => {
    // un embudo en su ostium (esfera de 8 mm dentro de la VCI) salía por detrás de la pared posterior de la VCI y teñía de
    // su flujo ~1 cm³ de la luz de la cava (revisión adversarial): el ostium es el de antes, en la luz de la VCI
    const hv = scene.vesselById.get('hvRight')!.tube.nodes;
    // (el radio del primer nodo es el de la punta afilada de la decisión 87)
    expect(hv.map((n, i) => [...n.p, i ? n.r : 0])).toEqual([
      [-135, 12, -65, 0],
      [-105, -4, -28, 3.6],
      [-68, -18, 10, 4.8],
      [-38, -11, 32, 5.6],
      [-27, -9, 39, 6.0],
    ]);
    expect(tubeQuery(hv.at(-1)!.p, { ...supra.tube, apScale: 0.8 }, 1).d).toBeLessThan(0);
    const mid = scene.vesselById.get('hvMiddle')!.tube;
    const trib = scene.vesselById.get('hvMiddleTributary')!.tube.nodes.at(-1)!.p;
    expect(tubeQuery(trib, { ...mid, shape: undefined }, 1).rho).toBeLessThan(0.05);
  });

  it('en la congestión grave la VCI no gana solapes con la porta ni con la arteria renal derecha frente a su trazado de la decisión 69', () => {
    // holgura entre paredes (mm) en la congestión grave, con el calibre de la fisiología en apnea espiratoria: la VCI
    // dilatada ya tocaba la porta y la arteria renal derecha antes de esta decisión, y su trazado nuevo no las empeora
    const patient = { ...clonePatient(SEVERE_CONGESTION), respiratoryPattern: 'apnea-expiratory' as const };
    const sc = new AnatomyScene(patient);
    const engine = new PhysiologyEngine(patient, sc.vesselAreas(), { historySeconds: 2 });
    for (let i = 0; i < 600; i++) engine.step();
    const cal = new AnatomyQuery(sc).caliberFor(engine.sample);
    const tubes = sc.vessels.filter((v) => VESSEL_META[v.id].system === 'ivc').map((v) => ({ ...v.tube, apScale: cal.ivcApScale }));
    const gap = (id: string): number => {
      const o = sc.vesselById.get(id as never)!;
      const n = o.tube.nodes;
      let g = Infinity;
      for (let i = 0; i < n.length - 1; i++)
        for (let t = 0; t <= 1; t += 0.02) {
          const p: Vec3 = [0, 1, 2].map((j) => n[i].p[j] + (n[i + 1].p[j] - n[i].p[j]) * t) as Vec3;
          const r = (n[i].r + (n[i + 1].r - n[i].r) * t) * cal.radiusScale(o.id);
          for (const tube of tubes) g = Math.min(g, tubeQuery(p, tube, cal.radiusScale('ivcInfra')).d - r - 0.8 - o.wallMm);
        }
      return g;
    };
    // este mismo cálculo sobre main (d49aa52): −4,473 (tronco portal), −2,123 (rama derecha), −1,735 (izquierda), −4,962
    // (arteria renal); con esta decisión, −3,88, −1,23, −0,67 y −4,92. Ninguna empeora (margen de 0,01 mm)
    expect(gap('pvTrunk')).toBeGreaterThan(-4.483);
    expect(gap('pvRight')).toBeGreaterThan(-2.133);
    expect(gap('pvLeft')).toBeGreaterThan(-1.745);
    expect(gap('renalArteryRight')).toBeGreaterThan(-4.972);
  });
});
