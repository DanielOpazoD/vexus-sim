import { describe, expect, it } from 'vitest';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { CONVEX_C35 } from '../probe/probe';
import { CONVEX_BEAM, lateralSigmaMm } from '../ultrasound/beamModel';
import { COMPOUND } from '../ultrasound/compound';
import { FRAG_RAWFIELD, FRAG_TRANSMISSION, STEERED_FIELD_GLSL } from '../ultrasound/shaders/passes.glsl';
import { lookCoverage, steeredSample, type SteeredSampleCell, type SteeredSampleImage } from '../ultrasound/steering';
import { rng } from './syntheticSpeckle';

/**
 * Geometría de la rama dirigida de la pasada B (decisión 58): punto y dirección antes y después del espejo,
 * incidencia de la pleura, lectura de la transmisión de la reverberación, anclas de la cola y del
 * transitorio, código de A o3 y alcance fuera del arreglo. `steeredSample` es el gemelo línea a línea de
 * `STEERED_FIELD_GLSL` (la última prueba fija las líneas del GLSL); aquí se comprueba contra la geometría
 * del camino dirigido y, con θ = 0, contra las fórmulas de la mirada 0 de `FRAG_RAWFIELD`.
 */
const deg = Math.PI / 180;
const TH = COMPOUND.steerDeg * deg;
const DEPTH = 180;
const IMG: SteeredSampleImage = {
  curvatureRadius: CONVEX_C35.curvatureRadius,
  halfSector: CONVEX_C35.halfSector,
  lines: CONVEX_C35.lines,
  depthMm: DEPTH,
  lateralSigmaMm: (r) => lateralSigmaMm(r, 90, CONVEX_BEAM),
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

/** Celda de A o3 como la empaqueta `FRAG_TRANSMISSION`: tipo de gas + 4·(línea del espejo + 1). */
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

  it('con ±θ la muestra está en el camino dirigido del elemento φ_k y, tras el espejo, sigue el reflejado desde el cruce del camino', () => {
    const rnd = rng(581);
    let checkedMirror = 0;
    for (let t = 0; t < 4000; t++) {
      const th = rnd() < 0.5 ? TH : -TH;
      const u = (Math.floor(rnd() * L) + 0.5) / L;
      const v = rnd();
      const ml = Math.floor(rnd() * L);
      const dM = lineDir(lineTheta((ml + 0.5) / L));
      const dR = reflect(dM, pleuraNormal(rnd, dM));
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
        const cross0 = add(got.element, scale(got.dirK, sMirror));
        expect(near(got.point, add(cross0, scale(dR, got.s - sMirror)))).toBeLessThan(1e-9);
        expect(near(got.dir, dR)).toBeLessThan(1e-12);
        expect(got.mirrorLine).toBe(ml);
      } else {
        expect(near(got.point, sample)).toBeLessThan(1e-9);
        expect(near(got.dir, got.dirK)).toBeLessThan(1e-12);
      }
    }
    expect(checkedMirror).toBeGreaterThan(500);
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
      'field += vec2(interfaceEcho(c0, m0, dir, s, se), 0.0);',
      'vec3 dn = dRefl - dMirror;',
      'field += vec2(pleuraEcho(s - sMirror, dirK, ln > 1e-6 ? reflect(dirK, dn / ln) : dirK), 0.0);',
      'if (sGas > 0.0 && s > sGas) {',
      'float sg = max(sGas - dr, 0.0);',
      'float rhoG = sqrt(uCurvR * uCurvR + sg * sg + 2.0 * sg * uSteer.z);',
      'float alphaG = phiK + uSteer.x - steerBeta(rhoG, a);',
      'float Tg = texture(uTrans3, vec2((alphaG + uHalfSector) / (2.0 * uHalfSector), (rhoG - uCurvR) / uDepth)).x * coupling;',
      'float z = (s - float(k) * sGas) / 1.2;',
      'scattererField(vec3(uK * 190.0, s * 0.9, 0.0), 0.6, uSeed + 3.0 + uLookSalt) * 0.3 * Tg * exp(-(s - sGas) / 40.0)',
      'if (s < TRANSIENT_SKIP_MM)',
      'scattererField(vec3(uK * 190.0, s * 3.0, 1.0), 0.8, uSeed + 7.0 + uLookSalt) * TRANSIENT_AMPLITUDE * exp(-s / TRANSIENT_DECAY_MM) * coupling',
      'float coupling = texture(uCoupling, vec2(uK, 0.5)).r;',
    ])
      expect(STEERED_FIELD_GLSL, line).toContain(line);
    // A empaqueta lo que B separa, y la mirada 0 conserva sus fórmulas
    expect(FRAG_TRANSMISSION).toContain('o3 = vec4(Tk, ps.y, px.x + 4.0 * (px.y + 1.0), ps.w);');
    expect(FRAG_RAWFIELD).toContain('p = hp + dir * (r - mirrorHit);');
    expect(FRAG_RAWFIELD).toContain('float Tg = texture(uTrans0, vec2(vUv.x, max(gasHit - dr, 0.0) / uDepth)).x * coupling;');
    expect(FRAG_RAWFIELD).toContain('scattererField(vec3(vUv.x * 190.0, r * 0.9, 0.0), 0.6, uSeed + 3.0)');
    expect(FRAG_RAWFIELD).toContain('scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0)');
  });
});
