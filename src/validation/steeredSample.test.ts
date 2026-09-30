import { describe, expect, it } from 'vitest';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { CONVEX_C35 } from '../probe/probe';
import { lateralSigmaMm } from '../ultrasound/beamModel';
import { COMPOUND } from '../ultrasound/compound';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED, FRAG_TRANSMISSION_STEERED, STEERED_FIELD_GLSL } from '../ultrasound/shaders/passes.glsl';
import { lookCoverage, steeredSample, type SteeredSampleCell, type SteeredSampleImage } from '../ultrasound/steering';
import { COARSE_DEPTH } from '../ultrasound/renderer';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { PLEURA_STEER_GUESS_MM, aLineOrder, pleuraCapMm, pleuraSeriesDepths } from '../ultrasound/pleura';
import { rng } from './syntheticSpeckle';

/**
 * Geometría de la rama dirigida de la pasada B (decisión 58): punto y dirección antes y después del espejo,
 * incidencia de la pleura, lectura de la transmisión de la reverberación, anclas de la cola y del
 * transitorio, código de A o3 y alcance fuera del arreglo. `steeredSample` es el gemelo línea a línea de
 * `STEERED_FIELD_GLSL`, el main del programa dirigido de B (`FRAG_RAWFIELD_STEERED`; la última prueba fija
 * las líneas del GLSL); aquí se comprueba contra la geometría del camino dirigido y, con θ = 0, contra las
 * fórmulas del programa de la mirada 0 (`FRAG_RAWFIELD`).
 */
const deg = Math.PI / 180;
const TH = COMPOUND.steerDeg * deg;
const DEPTH = 180;
const IMG: SteeredSampleImage = {
  curvatureRadius: CONVEX_C35.curvatureRadius,
  halfSector: CONVEX_C35.halfSector,
  lines: CONVEX_C35.lines,
  depthMm: DEPTH,
  // la PSF lateral de la imagen B en fundamental (decisión 84), la de la pasada D
  lateralSigmaMm: (r) => lateralSigmaMm(r, 90, bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false })),
  coarseRows: COARSE_DEPTH,
};
const R = IMG.curvatureRadius;
const H = IMG.halfSector;
const L = IMG.lines;
const DR = DEPTH / 1024;

// Marco oblicuo cualquiera (ortonormal): la geometría no depende de él
const AXIAL = normalize([0.3, -0.85, 0.42]);
const LATERAL = normalize(cross(AXIAL, [0.1, 0.2, 0.97]));
const ELEV = cross(AXIAL, LATERAL);
const FRAME = { center: [12, -40, 7] as Vec3, axial: AXIAL, lateral: LATERAL };
const lineDir = (t: number): Vec3 => normalize(add(scale(AXIAL, Math.cos(t)), scale(LATERAL, Math.sin(t))));
const lineTheta = (u: number) => -H + 2 * H * u;
const reflect = (d: Vec3, n: Vec3): Vec3 => sub(d, scale(n, 2 * dot(d, n)));
const near = (a: Vec3, b: Vec3) => length(sub(a, b));

/** Normal de pleura cualquiera, orientada contra la línea (con componente elevacional). */
function pleuraNormal(rnd: () => number, d0: Vec3): Vec3 {
  const n = normalize(add(scale(d0, -1), add(scale(LATERAL, 1.2 * (rnd() - 0.5)), scale(ELEV, 0.6 * (rnd() - 0.5)))));
  return dot(n, d0) > 0 ? scale(n, -1) : n;
}

/** Celda de A o3 como la empaqueta `FRAG_TRANSMISSION_STEERED`: tipo de gas + 4·(línea del espejo + 1). */
const cell = (
  sGas: number,
  gasKind: number,
  mirrorLine: number,
  sMirror: number,
  reflectedDir: (l: number) => Vec3,
): SteeredSampleCell => ({
  sGas,
  code: gasKind + 4 * (mirrorLine + 1),
  sMirror,
  reflectedDir,
});

describe('rama dirigida de la pasada B: geometría (decisión 58)', () => {
  it('con θ = 0 es la geometría de la mirada 0 de FRAG_RAWFIELD (punto, dirección, pleura, reverberación, anclas)', () => {
    const rnd = rng(580);
    for (let t = 0; t < 4000; t++) {
      const j = Math.floor(rnd() * L);
      const u = (j + 0.5) / L;
      const v = rnd();
      const r = v * DEPTH;
      const d0 = lineDir(lineTheta(u));
      const mirrorHit = rnd() < 0.7 ? DEPTH * rnd() : -1;
      const n = pleuraNormal(rnd, d0);
      const t1 = reflect(d0, n);
      const gasHit = mirrorHit >= 0 ? mirrorHit : rnd() < 0.5 ? DEPTH * rnd() : -1;
      // con θ = 0 el espejo que cruza el camino es el de su propia línea
      const got = steeredSample(
        FRAME,
        IMG,
        0,
        u,
        v,
        cell(gasHit, 1, mirrorHit >= 0 ? j : -1, mirrorHit, (l) => (l === j ? t1 : [0, 0, 1])),
      );
      // FRAG_RAWFIELD, mirada 0
      const past = mirrorHit >= 0 && r > mirrorHit;
      const p0 = past ? add(add(FRAME.center, scale(d0, R + mirrorHit)), scale(t1, r - mirrorHit)) : add(FRAME.center, scale(d0, R + r));
      expect(got.formed).toBe(true);
      expect(got.s).toBeCloseTo(r, 9);
      expect(got.uK).toBeCloseTo(u, 12); // anclas (u·190, r) de la cola y del transitorio
      expect(near(got.point, p0)).toBeLessThan(1e-9);
      expect(near(got.dir, past ? t1 : d0)).toBeLessThan(1e-12);
      if (mirrorHit >= 0) {
        expect(got.pleura!.delta).toBeCloseTo(r - mirrorHit, 9);
        expect(got.pleura!.cos).toBeCloseTo(Math.sqrt(Math.max(0, 0.5 * (1 - dot(d0, t1)))), 9);
      } else expect(got.pleura).toBeNull();
      if (gasHit > 0 && r > gasHit) {
        expect(got.reverb!.uv[0]).toBeCloseTo(u, 12);
        expect(got.reverb!.uv[1]).toBeCloseTo(Math.max(gasHit - DR, 0) / DEPTH, 12);
      } else expect(got.reverb).toBeNull();
    }
  });

  it('con ±θ la muestra está en el camino dirigido del elemento φ_k y, tras el espejo, sigue su propio reflejado desde su cruce', () => {
    const rnd = rng(581);
    let checkedMirror = 0;
    for (let t = 0; t < 4000; t++) {
      const th = rnd() < 0.5 ? TH : -TH;
      const u = (Math.floor(rnd() * L) + 0.5) / L;
      const v = rnd();
      const ml = Math.floor(rnd() * L);
      const dM = lineDir(lineTheta((ml + 0.5) / L));
      const n = pleuraNormal(rnd, dM);
      const dR = reflect(dM, n);
      const sMirror = rnd() < 0.6 ? 150 * rnd() : -1;
      const got = steeredSample(
        FRAME,
        IMG,
        th,
        u,
        v,
        cell(-1, 0, sMirror >= 0 ? ml : -1, sMirror, (l) => (l === ml ? dR : [0, 0, 1])),
      );
      expect(near(got.dirK, lineDir(got.phiK + th))).toBeLessThan(1e-12);
      expect(near(got.element, add(FRAME.center, scale(lineDir(got.phiK), R)))).toBeLessThan(1e-9);
      const onPath = add(got.element, scale(got.dirK, got.s));
      const sample = add(FRAME.center, scale(lineDir(lineTheta(u)), R + v * DEPTH));
      // el camino dirigido de φ_k pasa por la muestra a la distancia s
      expect(near(onPath, sample)).toBeLessThan(1e-9);
      if (sMirror >= 0 && got.s > sMirror) {
        checkedMirror++;
        // la dirección del propio camino reflejada en la pleura, cuya normal sale de la línea del espejo (decisión 91)
        const dRK = reflect(got.dirK, n);
        const cross0 = add(got.element, scale(got.dirK, sMirror));
        expect(near(got.point, add(cross0, scale(dRK, got.s - sMirror)))).toBeLessThan(1e-9);
        expect(near(got.dir, dRK)).toBeLessThan(1e-12);
        expect(got.mirrorLine).toBe(ml);
      } else {
        expect(near(got.point, sample)).toBeLessThan(1e-9);
        expect(near(got.dir, got.dirK)).toBeLessThan(1e-12);
      }
    }
    expect(checkedMirror).toBeGreaterThan(500);
  });

  it('tras el espejo el mapa de la imagen al tejido no se degenera: ningún desplazamiento de la imagen cae casi entero en la elevación (el peine, decisión 91)', () => {
    // La geometría medida con GPU en el borde de la subcostal de la congestión grave (+7°): los caminos de las líneas
    // 174–181 cruzan el pulmón en el espejo de la línea 174 a s = 32,2 mm, cuya reflejada sale del plano (axial 0,316,
    // lateral −0,817, elevación 0,482). La retícula del moteado va comprimida en elevación hasta el grosor de corte
    // (decisión 55): si una dirección de la imagen lleva el punto casi solo en elevación, el moteado se estira a lo largo
    // de ella en estrías. Con la reflejada de la línea del espejo para todos los caminos, el giro del haz de una línea a
    // otra no llegaba a lo reflejado: 0,031 mm de tejido fuera de la elevación por mm de imagen (las estrías horizontales
    // del peine de la ronda 5 del juez ciego); con el propio camino reflejado, 0,35.
    const ml = 174;
    const dR = normalize(add(add(scale(LATERAL, -0.817), scale(ELEV, 0.482)), scale(AXIAL, 0.316)));
    const c = cell(32.2, 1, ml, 32.2, (l) => (l === ml ? dR : [0, 0, 1]));
    let worst = Infinity;
    for (const line of [174, 176, 178, 180])
      for (const r of [100, 120, 140]) {
        const at = (l: number, rr: number) => steeredSample(FRAME, IMG, TH, (l + 0.5) / L, rr / DEPTH, c).point;
        const p = at(line, r);
        const spacing = (R + r) * ((2 * H) / (L - 1));
        const dl = scale(sub(at(line + 1, r), p), 1 / spacing);
        const dd = sub(at(line, r + 1), p);
        for (let a = 0; a < Math.PI; a += Math.PI / 360) {
          const v = add(scale(dl, Math.cos(a)), scale(dd, Math.sin(a)));
          worst = Math.min(worst, length(sub(v, scale(ELEV, dot(v, ELEV)))));
        }
      }
    expect(worst).toBeGreaterThan(0.25);
  });

  it('la pleura se dibuja con la incidencia de la mirada: su coseno es |dirK·n| con la normal de la línea del espejo', () => {
    const rnd = rng(582);
    for (let t = 0; t < 4000; t++) {
      const th = rnd() < 0.5 ? TH : -TH;
      const u = (Math.floor(rnd() * L) + 0.5) / L;
      const ml = Math.min(L - 1, Math.max(0, Math.floor(u * L + 6 * (rnd() - 0.5))));
      const dM = lineDir(lineTheta((ml + 0.5) / L));
      const n = pleuraNormal(rnd, dM);
      const got = steeredSample(
        FRAME,
        IMG,
        th,
        u,
        rnd(),
        cell(-1, 1, ml, 40 + 80 * rnd(), (l) => (l === ml ? reflect(dM, n) : [0, 0, 1])),
      );
      expect(got.pleura!.cos).toBeCloseTo(Math.abs(dot(got.dirK, n)), 9);
      // la mirada 0 vería otra incidencia: la de la línea del espejo
      if (Math.abs(Math.abs(dot(dM, n)) - Math.abs(dot(got.dirK, n))) > 1e-3)
        expect(got.pleura!.cos).not.toBeCloseTo(Math.abs(dot(dM, n)), 6);
    }
  });

  it('la reverberación lee la transmisión de la mirada en el punto de su camino a s = sGas − dr', () => {
    const rnd = rng(583);
    let n = 0;
    for (let t = 0; t < 4000; t++) {
      const th = rnd() < 0.5 ? TH : -TH;
      const u = (Math.floor(rnd() * L) + 0.5) / L;
      const v = rnd();
      const sGas = 120 * rnd();
      const got = steeredSample(
        FRAME,
        IMG,
        th,
        u,
        v,
        cell(sGas, 2, -1, -1, () => [0, 0, 1]),
      );
      if (!(got.s > sGas)) {
        expect(got.reverb).toBeNull();
        continue;
      }
      n++;
      const g = got.reverb!;
      expect(g.s).toBeCloseTo(Math.max(sGas - DR, 0), 12);
      // (αG, ρG) es el punto del camino dirigido de φ_k a esa distancia, y su coordenada de textura en A o3
      const onPath = add(got.element, scale(got.dirK, g.s));
      expect(near(add(FRAME.center, scale(lineDir(g.alpha), g.rho)), onPath)).toBeLessThan(1e-9);
      expect(g.uv[0]).toBeCloseTo((g.alpha + H) / (2 * H), 12);
      expect(g.uv[1]).toBeCloseTo((g.rho - R) / DEPTH, 12);
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('A o3 empaqueta tipo de gas y línea del espejo sin pérdida en float32 y la rama los separa', () => {
    for (const gasKind of [0, 1, 2])
      for (const ml of [-1, 0, 1, 95, L - 1]) {
        const code = gasKind + 4 * (ml + 1);
        expect(Math.fround(code)).toBe(code);
        const got = steeredSample(FRAME, IMG, TH, 0.5, 0.5, { sGas: -1, code, sMirror: ml >= 0 ? 10 : -1, reflectedDir: () => [0, 0, 1] });
        expect(got.gasKind).toBe(gasKind);
        expect(got.mirrorLine).toBe(ml);
      }
  });

  it('fuera del arreglo la muestra se forma justo hasta donde el núcleo lateral de D la mezcla con una celda que K pesa', () => {
    let cut = 0;
    let keptOutside = 0;
    for (const th of [TH, -TH])
      for (let i = 0; i < 1024; i += 7) {
        const v = (i + 0.5) / 1024;
        const r = v * DEPTH;
        const spacing = (R + r) * ((2 * H) / (L - 1));
        const reachD = Math.ceil(2.5 * Math.max(0.35, IMG.lateralSigmaMm(r) / spacing)); // FRAG_LATERAL
        const at = Array.from({ length: L }, (_, j) =>
          steeredSample(
            FRAME,
            IMG,
            th,
            (j + 0.5) / L,
            v,
            cell(-1, 0, -1, -1, () => [0, 0, 1]),
          ),
        );
        const weight = at.map((s) => lookCoverage(s.phiK, H, L, COMPOUND.taperLines));
        for (let j = 0; j < L; j++) {
          // D mezcla la línea j en las salidas j + q (|q| ≤ alcance); K pesa las que tienen cobertura
          let needed = false;
          for (let q = -reachD; q <= reachD; q++) if (j + q >= 0 && j + q < L && weight[j + q] > 0) needed = true;
          expect(at[j].formed, `línea ${j}, ${r.toFixed(1)} mm, θ ${th}`).toBe(needed);
          if (!at[j].formed) cut++;
          else if (weight[j] === 0) keptOutside++;
        }
      }
    expect(cut).toBeGreaterThan(1000);
    expect(keptOutside).toBeGreaterThan(100);
  });

  it('el GLSL lleva las mismas expresiones que el gemelo', () => {
    for (const line of [
      'float phiK = steeredElement(alpha, rho, uSteer.x, a);',
      'float lineSpacing = rho * (2.0 * uHalfSector / (uLinesF - 1.0));',
      'float reach = ceil(2.5 * max(0.35, lateralSigmaMm(r) / lineSpacing));',
      'if ((abs(phiK) - uHalfSector) / (2.0 * uHalfSector / uLinesF) > 0.5 + reach) return vec2(0.0);',
      'float s = alongLineMm(rho, a, uSteer.z);',
      'float uK = (phiK + uHalfSector) / (2.0 * uHalfSector);',
      'vec3 dirK = lineDir(alpha + steerBeta(rho, a));',
      'float code = floor(t3.z / 4.0);',
      'float gasKind = t3.z - 4.0 * code;',
      'int ml = clamp(int(code) - 1, 0, ts.x - 1);',
      'dRefl = normalize(texelFetch(uTrans1, ivec2(ml, ts.y - 1), 0).xyz);',
      'dMirror = lineDir(lineTheta((float(ml) + 0.5) / uLinesF));',
      'if (sMirror >= 0.0 && s > sMirror) {',
      'p = uCurvC + uCurvR * lineDir(phiK) + dirK * sMirror + dir * (s - sMirror);',
      'p = pointOnLine(lineDir(alpha), r);',
      // la fase de la mirada a la frecuencia del eco, que baja con la profundidad (decisión 84)
      'float k2 = uSteer.w * echoFrequency(r);',
      'tissue = mediumFieldPh(p, dir, s, elevSigma(r), !under, lookPhase(rho, alpha, a, k2), gr.x * uLateral + gr.y * uAxial, spec);',
      'float rhoJ = sqrt(uCurvR * uCurvR + d * d + 2.0 * d * uSteer.z);',
      'vec2 f = wallFieldPh(elem + dirK * d, dirK, elevSigma(rhoJ - uCurvR), lookPhase(rhoJ, alJ, a, k2), gr.x * uLateral + gr.y * uAxial, wD);',
      'vec2 e = interfaceEcho(c, m, dir, r, se, w);',
      // la especular aparte (decisión 88): los ecos especulares con la transmisión de sus pares en la apertura (decisión 91)
      'spec = e.x;',
      'return field * (1.0 + e.y / max(length(field), 1e-6));',
      'vec3 dn = dRefl - dMirror;',
      'vec3 dReflK = ln > 1e-6 ? reflect(dirK, dn / ln) : dirK;',
      'dir = dReflK;',
      'if (sMirror >= 0.0) spec += pleuraEcho(s - sMirror, dirK, dReflK);',
      'float tAp = transLerp(uTrans3, 0, tc.x, r);',
      'float tRay = transLerp(uTrans2, 1, tc.x, r);',
      'float tSpec = transLerp(uTrans2, 3, tc.x, r);',
      'Ts = min(tAp, curtain ? tRay : tSpec);',
      'tissue = (tissue * T + vec2(spec * Ts, 0.0)) * coupling;',
      'if (sGas > 0.0 && s > sGas) {',
      'float sg = max(sGas - dr, 0.0);',
      'float rhoG = sqrt(uCurvR * uCurvR + sg * sg + 2.0 * sg * uSteer.z);',
      'float alphaG = phiK + uSteer.x - steerBeta(rhoG, a);',
      'float Tg = texture(uTrans3, vec2((alphaG + uHalfSector) / (2.0 * uHalfSector), (rhoG - uCurvR) / uDepth)).x * coupling;',
      'float z = (s - float(k) * sGas) / 1.2;',
      'scattererField(vec3(uK * 190.0, s * 0.9, 0.0), 0.6, uSeed + 3.0 + uLookSalt) * 0.3 * Tg * exp(-(s - sGas) / 40.0)',
      'if (s < TRANSIENT_SKIP_MM)',
      'scattererField(vec3(uK * 190.0, s * 3.0, 1.0), 0.8, uSeed + 7.0 + uLookSalt) * TRANSIENT_AMPLITUDE * uTransientGain * exp(-s / TRANSIENT_DECAY_MM) * coupling',
      'float coupling = texture(uCoupling, vec2(uK, 0.5)).r;',
    ])
      expect(STEERED_FIELD_GLSL, line).toContain(line);
    // la rama es el main del programa dirigido de B, y el de la mirada 0 no la lleva
    expect(FRAG_RAWFIELD_STEERED).toContain(STEERED_FIELD_GLSL);
    expect(FRAG_RAWFIELD_STEERED).toContain('void main() {\n  oField = steeredField();\n}');
    expect(FRAG_RAWFIELD).not.toContain('steeredField');
    // A empaqueta (en su programa dirigido) lo que B separa, y la mirada 0 conserva sus fórmulas
    expect(FRAG_TRANSMISSION_STEERED).toContain('o3 = vec4(Tk, ps.y, px.x + 4.0 * (px.y + 1.0), ps.w);');
    expect(FRAG_RAWFIELD).toContain('p = hp + dir * (r - mirrorHit);');
    expect(FRAG_RAWFIELD).toContain('vec2 uvG = vec2(vUv.x, max(gasHit - dr, 0.0) / uDepth);');
    expect(FRAG_RAWFIELD).toContain('float tg = texture(uTrans0, uvG).x;');
    expect(FRAG_RAWFIELD).toContain(
      'float Tg = (curtain && gasHit > D ? min(min(tg, texture(uTrans2, uvG).x) * gain, tD) : tg) * coupling;',
    );
    expect(FRAG_RAWFIELD).toContain('scattererField(vec3(vUv.x * 190.0, r * 0.9, 0.0), 0.6, uSeed + 3.0)');
    expect(FRAG_RAWFIELD).toContain('scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0)');
  });
});

/**
 * La pleura parietal y la cortina a lo largo del camino de la muestra (decisión 61): con θ = 0 el cruce de la
 * propia línea y la serie sobre ella (la mirada 0); con ±θ el cruce del camino dirigido, hallado sobre el h2 de
 * A0 con el punto fijo, la serie en el propio camino y la transmisión leída en la celda de la rejilla de cada
 * punto (A o3).
 */
describe('rama dirigida de la pasada B: pleura parietal y cortina (decisión 61)', () => {
  const STEP = DEPTH / COARSE_DEPTH;
  /** Pleura plana a Zp mm bajo la cara, paralela a su tangente: el cruce de la línea l, como lo da A0. */
  const flatPleura = (Zp: number) => (l: number) => {
    const al = lineTheta((l + 0.5) / L);
    return { D: (R + Zp) / Math.cos(al) - R, dz: l - 100, dL: 7.5 };
  };
  /** Ángulo polar y radio de un punto respecto al centro de curvatura, en el plano de imagen. */
  const polar = (p: Vec3): { alpha: number; rho: number } => {
    const q = sub(p, FRAME.center);
    return { alpha: Math.atan2(dot(q, LATERAL), dot(q, AXIAL)), rho: length(q) };
  };
  const uvOf = (p: Vec3): [number, number] => {
    const { alpha, rho } = polar(p);
    return [(alpha + H) / (2 * H), (rho - R) / DEPTH];
  };

  it('con θ = 0 es la de la mirada 0: el cruce de su línea y la pared sobre la línea, con la transmisión en su columna', () => {
    const rnd = rng(611);
    for (let t = 0; t < 3000; t++) {
      const j = Math.floor(rnd() * L);
      const u = (j + 0.5) / L;
      const v = rnd();
      const r = v * DEPTH;
      const Dj = 15 + 30 * rnd();
      const pleuraAt = (l: number) => (l === j ? { D: Dj, dz: 2, dL: 9 } : { D: 80, dz: -3, dL: 0 });
      const got = steeredSample(FRAME, IMG, 0, u, v, { ...cell(-1, 0, -1, -1, () => [0, 0, 1]), pleuraAt }).curtain!;
      const d0 = lineDir(lineTheta(u));
      expect(got.line).toBe(j);
      expect(got.sD).toBeCloseTo(Dj, 9);
      expect(near(got.point, add(FRAME.center, scale(d0, R + Dj)))).toBeLessThan(1e-9);
      const rCap = pleuraCapMm(Dj, STEP);
      expect(got.sCap).toBeCloseTo(rCap, 9);
      expect(got.uvD[0]).toBeCloseTo(u, 12);
      expect(got.uvD[1]).toBeCloseTo(rCap / DEPTH, 12);
      expect(got.aLine).toBe(aLineOrder(r, Dj));
      if (r > Dj) {
        const d = pleuraSeriesDepths(r, Dj);
        expect(got.series!.n).toBe(d.n);
        expect(got.series!.mirror).toBeCloseTo(d.mirror, 9);
        expect(got.series!.forward).toBeCloseTo(d.forward, 9);
        // la pared remuestreada sobre la propia línea y la transmisión en su columna, con la fila de la pleura por tope
        expect(near(got.series!.mirrorPoint, add(FRAME.center, scale(d0, R + d.mirror)))).toBeLessThan(1e-9);
        expect(near(got.series!.forwardPoint, add(FRAME.center, scale(d0, R + d.forward)))).toBeLessThan(1e-9);
        expect(got.series!.uvMirror[0]).toBeCloseTo(u, 12);
        expect(got.series!.uvMirror[1]).toBeCloseTo(Math.min(d.mirror, rCap) / DEPTH, 12);
        expect(got.series!.uvForward[1]).toBeCloseTo(Math.min(d.forward, rCap) / DEPTH, 12);
      } else expect(got.series).toBeNull();
    }
    // sin pleura en la línea (ni en ninguna), sin cortina
    expect(steeredSample(FRAME, IMG, 0, 0.5, 0.5, { ...cell(-1, 0, -1, -1, () => [0, 0, 1]), pleuraAt: () => null }).curtain).toBeNull();
  });

  it('con ±θ la pleura es la del camino dirigido: el cruce del camino con la pleura, a ≤ 0,3 mm', () => {
    const rnd = rng(612);
    let n = 0;
    for (let t = 0; t < 3000; t++) {
      const th = rnd() < 0.5 ? TH : -TH;
      const u = (Math.floor(rnd() * L) + 0.5) / L;
      const v = rnd();
      const Zp = 20 + 25 * rnd();
      const pleuraAt = flatPleura(Zp);
      const got = steeredSample(FRAME, IMG, th, u, v, { ...cell(-1, 0, -1, -1, () => [0, 0, 1]), pleuraAt });
      const c = got.curtain!;
      // el cruce exacto del camino del elemento φ_k con el plano de la pleura
      const sStar = (R + Zp - R * Math.cos(got.phiK)) / Math.cos(got.phiK + th);
      const cross = polar(add(got.element, scale(got.dirK, sStar)));
      // el camino cruza la pleura fuera del sector (junto al borde, antes de entrar): A0 no tiene esa línea
      if (Math.abs(cross.alpha) > H - (2 * H) / L) continue;
      n++;
      expect(Math.abs(c.sD - sStar), `θ ${th} u ${u}`).toBeLessThan(0.3);
      expect(near(c.point, add(got.element, scale(got.dirK, c.sD)))).toBeLessThan(1e-9);
      // la línea hallada es la que el camino corta a la profundidad de la pleura (o su vecina)
      expect(Math.abs(c.line - ((cross.alpha + H) / (2 * H)) * L + 0.5)).toBeLessThanOrEqual(1.5);
      expect(c.dz).toBe(c.line - 100);
      // la transmisión de la pleura, en la celda del camino a la fila tope
      expect(near(add(got.element, scale(got.dirK, c.sCap)), FRAME.center)).toBeCloseTo(R + pleuraCapMm(c.D, STEP), 9);
      const uvD = uvOf(add(got.element, scale(got.dirK, c.sCap)));
      expect(c.uvD[0]).toBeCloseTo(uvD[0], 9);
      expect(c.uvD[1]).toBeCloseTo(uvD[1], 9);
      if (got.s > c.sD) {
        const sr = c.series!;
        // la serie remuestrea la pared en el propio camino dirigido
        expect(near(sr.mirrorPoint, add(got.element, scale(got.dirK, sr.mirror)))).toBeLessThan(1e-9);
        expect(near(sr.forwardPoint, add(got.element, scale(got.dirK, sr.forward)))).toBeLessThan(1e-9);
        expect(sr.mirror).toBeGreaterThanOrEqual(-1e-9);
        expect(sr.mirror).toBeLessThanOrEqual(c.sD + 1e-9);
        const uvM = uvOf(add(got.element, scale(got.dirK, Math.min(sr.mirror, c.sCap))));
        expect(sr.uvMirror[0]).toBeCloseTo(uvM[0], 9);
        expect(sr.uvMirror[1]).toBeCloseTo(uvM[1], 9);
      }
    }
    expect(n).toBeGreaterThan(2000);
  });

  it('sin pleura en la línea de la muestra, el punto fijo empieza en PLEURA_STEER_GUESS_MM', () => {
    // solo las líneas 90–100 tienen pleura, a 30 mm: la muestra de la línea 60, con el camino que llega allí
    const pleuraAt = (l: number) => (l >= 90 && l <= 100 ? { D: PLEURA_STEER_GUESS_MM, dz: 1, dL: 0 } : null);
    let found = 0;
    for (let i = 0; i < 1024; i += 3) {
      const got = steeredSample(FRAME, IMG, TH, (60.5 + (i % 40)) / L, (i + 0.5) / 1024, {
        ...cell(-1, 0, -1, -1, () => [0, 0, 1]),
        pleuraAt,
      });
      if (got.curtain) {
        found++;
        expect(got.curtain.line).toBeGreaterThanOrEqual(90);
        expect(got.curtain.line).toBeLessThanOrEqual(100);
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it('el GLSL lleva la misma pleura del camino que el gemelo', () => {
    for (const line of [
      'vec4 h = texelFetch(uHits2, ivec2(line0, 0), 0);',
      'float dg = h.x >= 0.0 ? h.x : PLEURA_STEER_GUESS_MM;',
      'float al = phiK + uSteer.x - steerBeta(uCurvR + dg, a);',
      'int l = clamp(int(floor((al + uHalfSector) / (2.0 * uHalfSector) * uLinesF)), 0, int(uLinesF) - 1);',
      'sD = h.x >= 0.0 ? alongLineMm(uCurvR + h.x, a, uSteer.z) : -1.0;',
      'vec4 h2 = steeredPleura(phiK, a, tc.x, sD);',
      'float fAir = sD > 0.0 ? curtainAirFraction(h2.y, h2.x, dirK) : 0.0;',
      'float sCap = alongLineMm(uCurvR + pleuraCapMm(max(h2.x, 0.0), uDepth / float(ts.y)), a, uSteer.z);',
      'float rho = sqrt(uCurvR * uCurvR + x * x + 2.0 * x * uSteer.z);',
      'vec2 uv = vec2((al + uHalfSector) / (2.0 * uHalfSector), (rho - uCurvR) / uDepth);',
      'float t = texture(uTrans3, uv).x;',
      'return ray ? min(t, texture(uTrans2, uv).y) : t;',
      // la pleura es especular: a lo sumo el rayo central del camino (decisión 88)
      'float tD = curtain ? steeredT(phiK, a, sCap, true) : 0.0;',
      'vec3 pD = elem + dirK * max(sD, 0.0);',
      'float k = aLineOrder(s, sD);',
      'vec3 ser = under ? pleuraSeriesDepths(s, sD) : vec3(0.0);',
      'float rhoJ = sqrt(uCurvR * uCurvR + d * d + 2.0 * d * uSteer.z);',
      'float alJ = phiK + uSteer.x - steerBeta(rhoJ, a);',
      'float td = steeredT(phiK, a, min(d, sCap), false);',
      'air += f * (j == 1 ? (ser.x + 1.0) * PLEURA_RP * PLEURA_RP * chi * chi * tD * tD / max(td, 1e-6) * gn : (ser.x + 2.0) * td * G * gn);',
      'T = min(min(tAp, tRay) * gain, tD);',
      // sobre la pleura, la de la muestra con la regla de la entrada en el hueso (transLerp, como la mirada 0); pasado el
      // tope, la del tope del camino (revisión de la decisión 88: antes la del camino, bilineal, oscurecía la cortical)
      '} else if (curtain && s > sCap) {',
      'T = steeredT(phiK, a, sCap, false);',
      'Ts = steeredT(phiK, a, sCap, true);',
      'air += slidingField(pD, s - sD, uLookSalt) * tD;',
    ])
      expect(STEERED_FIELD_GLSL, line).toContain(line);
  });
});
