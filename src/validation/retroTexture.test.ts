import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED } from '../ultrasound/shaders/passes.glsl';
import { PLEURA_GLSL } from '../ultrasound/pleura';
import {
  RETRO_TEXTURE,
  RETRO_TEXTURE_GLSL,
  SINUS_TEXTURE,
  fascicleSeptum,
  retroMuscleAxis,
  retroTexture,
  sinusLobules,
} from '../ultrasound/retroTexture';
import { kidneyWorld } from '../anatomy/organs/kidney';

/**
 * Textura del psoas y del cuadrado lumbar (decisión 81): septos del perimisio a lo largo del músculo, anclados al
 * material, con brillo de lámina.
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Puntos del tejido `tissue` (lado derecho) en una rejilla de 1,3 mm. */
function samples(tissue: Tissue, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let z = -60; z >= -220 && out.length < n; z -= 1.3)
    for (let x = -100; x <= -20 && out.length < n; x += 1.3)
      for (let y = -80; y <= -20 && out.length < n; y += 1.3)
        if (scene.classify([x, y, z], BASELINE_CALIBER).tissue === tissue) out.push([x, y, z]);
  return out;
}

describe('Textura de los músculos retroperitoneales (decisión 81)', () => {
  const psoas = samples(Tissue.Psoas, 4000);
  const quadratus = samples(Tissue.QuadratusLumborum, 3000);

  it('vale 1 en cualquier otro tejido (grasa retroperitoneal, riñón, hígado, músculo de la pared)', () => {
    for (const t of [Tissue.RetroperitonealFat, Tissue.RenalCortex, Tissue.Liver, Tissue.Muscle, Tissue.Bowel])
      for (const m of psoas.slice(0, 50)) expect(retroTexture(m, t, [1, 0, 0])).toBe(1);
  });

  it('septos a lo largo del eje de cada músculo, a ~4 mm, con la normal perpendicular a él', () => {
    expect(psoas.length).toBe(4000);
    expect(quadratus.length).toBe(3000);
    for (const [pts, t] of [
      [psoas, Tissue.Psoas],
      [quadratus, Tissue.QuadratusLumborum],
    ] as const) {
      let on = 0;
      for (const m of pts) {
        const s = fascicleSeptum(m, t);
        expect(Math.abs(dot([s[0], s[1], s[2]], retroMuscleAxis(m, t)))).toBeLessThan(1e-9);
        expect(Math.hypot(s[0], s[1], s[2])).toBeCloseTo(1, 9);
        expect(s[3]).toBeGreaterThanOrEqual(0);
        expect(s[3]).toBeLessThanOrEqual(1);
        if (s[3] > 0.5) on++;
      }
      // septos finos: σ 0,2 mm cada ~4 mm con ~la mitad de los tramos encendidos → un 5–15 % de las muestras
      expect(on / pts.length, Tissue[t]).toBeGreaterThan(0.03);
      expect(on / pts.length, Tissue[t]).toBeLessThan(0.2);
    }
    // el eje: el del psoas baja hacia fuera y adelante (la cuerda de T12 a la pelvis), el del cuadrado sube hacia dentro
    const a = retroMuscleAxis([-30, -46, -97], Tissue.Psoas);
    expect(Math.abs(a[2])).toBeGreaterThan(0.95);
    expect(a[0] * a[2]).toBeGreaterThan(0); // hacia abajo (−z), hacia la derecha (−x)
    const q = retroMuscleAxis([-65, -60, -150], Tissue.QuadratusLumborum);
    expect(q[0] * q[2]).toBeGreaterThan(0); // hacia arriba (+z), hacia dentro (+x en el lado derecho)
    // el izquierdo es el espejo
    const l = retroMuscleAxis([30, -46, -97], Tissue.Psoas);
    expect(l[0]).toBeCloseTo(-a[0], 12);
    expect(l[2]).toBeCloseTo(a[2], 12);
    // a lo largo del eje el septo sigue (tramos de 10–30 mm): el mismo peso 1 mm más allá en la mayoría de los septos
    let same = 0;
    let lit = 0;
    for (const m of psoas) {
      const s = fascicleSeptum(m, Tissue.Psoas);
      if (s[3] < 0.5) continue;
      lit++;
      const ax = retroMuscleAxis(m, Tissue.Psoas);
      if (fascicleSeptum([m[0] + ax[0], m[1] + ax[1], m[2] + ax[2]], Tissue.Psoas)[3] > 0.3) same++;
    }
    expect(same / lit).toBeGreaterThan(0.8);
  });

  it('brillo de lámina: el septo de frente al haz brilla, de canto casi no; el músculo queda hipoecoico', () => {
    let front = 0;
    let edge = 0;
    let power = 0;
    for (const m of psoas) {
      const s = fascicleSeptum(m, Tissue.Psoas);
      const n: Vec3 = [s[0], s[1], s[2]];
      const ax = retroMuscleAxis(m, Tissue.Psoas);
      front += retroTexture(m, Tissue.Psoas, n);
      edge += retroTexture(m, Tissue.Psoas, ax); // el haz a lo largo del eje: el septo, de canto
      const beam: Vec3 = [Math.cos(m[0]), Math.sin(m[0]), 0];
      power += retroTexture(m, Tissue.Psoas, beam) ** 2;
    }
    expect(front / psoas.length).toBeGreaterThan(1.5 * (edge / psoas.length));
    // la potencia media sube con los septos, pero el psoas sigue por debajo del hígado (≤ −2 dB) y muy por debajo de la
    // grasa retroperitoneal que lo rodea
    const mean = (TISSUES[Tissue.Psoas].backscatter ** 2 * power) / psoas.length;
    expect(10 * Math.log10(mean)).toBeLessThan(-2);
    expect(10 * Math.log10(mean)).toBeLessThan(20 * Math.log10(TISSUES[Tissue.RetroperitonealFat].backscatter) - 5);
  });

  it('anclada: el mismo punto material da el mismo valor', () => {
    for (const m of psoas.slice(0, 200))
      expect(retroTexture(m, Tissue.Psoas, [0, 1, 0])).toBe(retroTexture([...m], Tissue.Psoas, [0, 1, 0]));
  });

  it('la pasada B la aplica en la muestra del medio y en sus planos, nunca en la pared que copia la serie', () => {
    expect(RETRO_TEXTURE_GLSL).toContain(
      `const vec4 RT_A = vec4(${RETRO_TEXTURE.fascicleMm.toFixed(4)}, ${RETRO_TEXTURE.septumSigmaMm.toFixed(4)}`,
    );
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain(RETRO_TEXTURE_GLSL);
      // después de la textura de la pared (usa wallOrientation)
      expect(src.indexOf('float wallOrientation(')).toBeLessThan(src.indexOf('float retroTexture('));
    }
    expect(FRAG_RAWFIELD).toContain('return fieldForBase(m, se, tissue, dir, w) * retroTexture(m, tissue, dir, w);');
    // la dirección de la mirada con el k2 con que se formó su fase (a la frecuencia del eco, decisión 84)
    expect(FRAG_RAWFIELD_STEERED).toContain('retroTexture(m, tissue, normalize(b0 + g / lookK2), w)');
    // la pared de la serie de la pleura (en un bucle) usa la base, sin la textura del retroperitoneo
    expect(PLEURA_GLSL).toContain('vec2 field = fieldForBase(m, se, c.tissue, normalize(p - uCurvC), w);');
    expect(FRAG_RAWFIELD_STEERED).toContain('vec2 field = fieldForPhBase(m, se, c.tissue, ph0, g, normalize(p - uCurvC), w);');
  });
});

describe('Lóbulos del seno renal (decisión 87)', () => {
  // puntos del seno de los dos riñones en una rejilla de 0,9 mm de su marco local
  const sinus: Vec3[] = [];
  for (const k of [scene.kidneyRight, scene.kidneyLeft])
    for (let u = -28; u <= 28; u += 0.9)
      for (let v = -7; v <= 15; v += 0.9)
        for (let w = -7; w <= 7; w += 0.9) {
          const m = kidneyWorld([u, v, w], k);
          if (scene.classify(m, BASELINE_CALIBER).tissue === Tissue.RenalSinus) sinus.push(m);
        }
  const db = (f: number) => 20 * Math.log10(f);

  it('factor log-normal anclado, igual con cualquier haz, de potencia media 1 y ~6,4 dB de desviación a la escala de 3 mm', () => {
    expect(sinus.length).toBeGreaterThan(3000);
    for (const m of sinus.slice(0, 200)) {
      const f = retroTexture(m, Tissue.RenalSinus, [0, 1, 0]);
      expect(f).toBe(sinusLobules(m));
      expect(retroTexture([...m], Tissue.RenalSinus, [1, 0, 0])).toBe(f);
    }
    // la estadística del campo, en 200 000 puntos al azar de un cubo de 30 cm (no en los del seno, que son unas pocas
    // células y dependen de la forma y de la pose del riñón): la potencia media es 1, así que la retrodispersión de TISSUES
    // es la media del seno también en la imagen (la puerta PW no lleva la textura)
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    let p1 = 0;
    let d1 = 0;
    let d2 = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const f = sinusLobules([rnd() * 300 - 150, rnd() * 300 - 150, rnd() * 300 - 150]);
      p1 += f * f;
      d1 += db(f);
      d2 += db(f) ** 2;
    }
    expect(p1 / N).toBeGreaterThan(0.95);
    expect(p1 / N).toBeLessThan(1.05);
    const sd = Math.sqrt(d2 / N - (d1 / N) ** 2);
    expect(sd).toBeGreaterThan(5.8);
    expect(sd).toBeLessThan(7);
    // en los dos senos, la potencia media sigue en 1 ± 10 %
    const pw = sinus.reduce((a, m) => a + sinusLobules(m) ** 2, 0) / sinus.length;
    expect(Math.abs(pw - 1)).toBeLessThan(0.1);
    // lóbulos de milímetros: a 0,5 mm casi el mismo nivel (< 1,5 dB en la mediana), a 3 células independientes
    const d = sinus.map((m) => db(sinusLobules(m)));
    const md = d.reduce((a, b) => a + b, 0) / d.length;
    const sdS = Math.sqrt(d.reduce((a, b) => a + (b - md) ** 2, 0) / d.length);
    const near = sinus.map((m) => Math.abs(db(sinusLobules([m[0] + 0.5, m[1], m[2]])) - db(sinusLobules(m)))).sort((a, b) => a - b);
    expect(near[near.length >> 1]).toBeLessThan(1.5);
    const far = sinus.map((m) => db(sinusLobules([m[0] + 3 * SINUS_TEXTURE.cellMm, m[1], m[2]])));
    const mf = far.reduce((a, b) => a + b, 0) / far.length;
    let cov = 0;
    for (let i = 0; i < d.length; i++) cov += (d[i] - md) * (far[i] - mf);
    expect(Math.abs(cov / d.length / (sdS * sdS))).toBeLessThan(0.15);
  });

  it('el seno es lo más ecogénico del riñón: ≥ 12 dB sobre el hígado y ≥ 4 dB sobre la grasa perirrenal', () => {
    const power = TISSUES[Tissue.RenalSinus].backscatter ** 2 * (sinus.reduce((a, m) => a + sinusLobules(m) ** 2, 0) / sinus.length);
    expect(10 * Math.log10(power)).toBeGreaterThan(12);
    expect(10 * Math.log10(power)).toBeGreaterThan(20 * Math.log10(TISSUES[Tissue.PerirenalFat].backscatter) + 4);
  });

  it('la pasada B lo aplica con las constantes del módulo, en el mismo punto que la textura de los músculos', () => {
    expect(RETRO_TEXTURE_GLSL).toContain(
      `const vec4 RT_S = vec4(${SINUS_TEXTURE.cellMm.toFixed(4)}, ${SINUS_TEXTURE.gain.toFixed(4)}, ${SINUS_TEXTURE.salt.toFixed(4)}, ${SINUS_TEXTURE.norm.toFixed(4)});`,
    );
    expect(RETRO_TEXTURE_GLSL).toContain(
      'if (tissue == T_RENAL_SINUS) return RT_S.w * exp(RT_S.y * (valueNoise(m / RT_S.x, RT_S.z) - 0.5));',
    );
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) expect(src).toContain(RETRO_TEXTURE_GLSL);
  });
});
