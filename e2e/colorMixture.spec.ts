import { expect, test } from '@playwright/test';
import { COLOR_MIXTURE_GLSL } from '../src/ultrasound/colorMixture';
import { colorPowerGain } from '../src/ultrasound/colorGain';
import { WallFilter } from '../src/doppler/wallFilter';
import { budget } from './support';

interface Sample {
  name: string;
  frequency: number[];
  blood: boolean[];
  bloodPower: number;
  tissuePower: number;
  width: number;
  cutoff: number;
  prf: number;
  gainDb: number;
}

const blood = [true, true, true, true, true];
const base: Sample = {
  name: 'uniforme',
  frequency: [180, 180, 180, 180, 180],
  blood,
  bloodPower: 1,
  tissuePower: 100,
  width: 0.3,
  cutoff: 60,
  prf: 1000,
  gainDb: 0,
};
const samples: Sample[] = [
  base,
  { ...base, name: 'uniforme invertido', frequency: [-180, -180, -180, -180, -180] },
  { ...base, name: 'mezcla cerca de Nyquist', frequency: [490, -490, 0, 0, 0], blood: [true, true, false, false, false], width: 0 },
  { ...base, name: 'cancelación de fases', frequency: [250, -250, 0, 0, 0], blood: [true, true, false, false, false], width: 0 },
  { ...base, name: 'una rama y tejido estacionario', frequency: [300, 300, 0, 0, 0], blood: [true, true, false, false, false] },
  { ...base, name: 'dos tejidos móviles', frequency: [100, -100, 0, 0, 0], blood: blood.map(() => false), bloodPower: 0, cutoff: 0 },
  { ...base, name: 'solo tejido móvil', frequency: [160, 160, 160, 160, 160], blood: blood.map(() => false) },
  { ...base, name: 'mezcla filtrada', frequency: [20, 60, 150, -280, 490] },
  { ...base, name: 'alias positivo', frequency: [1490, -490, 0, 0, 0], blood: [true, true, false, false, false], width: 0 },
  { ...base, name: 'filtro apagado', frequency: [0, 0, 0, 0, 0], cutoff: 0 },
  { ...base, name: 'sin señal', bloodPower: 0, tissuePower: 0 },
  ...[-6, 6, 12].map((gainDb) => ({ ...base, name: `ganancia ${gainDb} dB`, gainDb })),
];

// Independent pulsed-IQ oracle: average z[n+1]·conj(z[n]) for each incoherent
// spatial component, with the PW filter's response. The declared Gaussian
// bandwidth is integrated numerically, rather than copying exp(-2π²σ²/PRF²).
function expected(s: Sample): number[] {
  let real = 0,
    imaginary = 0,
    pb = 0,
    pt = 0;
  const filter = new WallFilter(s.cutoff, s.prf);
  for (let i = 0; i < 5; i++) {
    const f = s.frequency[i];
    const p = ((s.blood[i] ? s.bloodPower : s.tissuePower) * filter.magnitude(f) ** 2) / 5;
    if (s.blood[i]) pb += p;
    else pt += p;
    const sigma = s.blood[i] ? Math.abs(f) * s.width : 0;
    let re = 0,
      im = 0,
      total = 0;
    for (let q = -160; q <= 160; q++) {
      const x = q / 20;
      const w = Math.exp((-x * x) / 2);
      const frequency = f + sigma * x;
      const phase0 = 0.37;
      const phase1 = phase0 + (2 * Math.PI * frequency) / s.prf;
      re += w * (Math.cos(phase1) * Math.cos(phase0) + Math.sin(phase1) * Math.sin(phase0));
      im += w * (Math.sin(phase1) * Math.cos(phase0) - Math.cos(phase1) * Math.sin(phase0));
      total += w;
    }
    real += (p * re) / total;
    imaginary += (p * im) / total;
  }
  const gain = colorPowerGain(s.gainDb);
  return [real * gain, imaginary * gain, pb * gain, pt * gain];
}

test('Color suma autocorrelaciones de cada submuestra antes de estimar fase y potencia', async ({ page }, info) => {
  budget(120_000, 0);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const observed = await page.evaluate(
    ({ shader, samples }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float target required');
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
        return shader;
      };
      const vertex = compile(
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0);gl_Position=vec4(p,0.0,1.0);}',
      );
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        `#version 300 es
precision highp float;
${shader}
uniform float frequencies[5];
uniform bool blood[5];
uniform vec4 parameters;
uniform vec3 equipment;
out vec4 value;
void main(){vec2 tissue;vec4 mixed=colorMixture(frequencies,blood,parameters.x,parameters.y,parameters.z,parameters.w,equipment.x,tissue);value=equipment.y*vec4(mixed.xy+tissue,mixed.zw);}`,
      );
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float target');
      gl.viewport(0, 0, 1, 1);
      const result = samples.map((s) => {
        gl.uniform1fv(gl.getUniformLocation(program, 'frequencies'), s.frequency);
        gl.uniform1iv(gl.getUniformLocation(program, 'blood'), s.blood.map(Number));
        gl.uniform4f(gl.getUniformLocation(program, 'parameters'), s.bloodPower, s.tissuePower, s.width, s.cutoff);
        gl.uniform3f(gl.getUniformLocation(program, 'equipment'), s.prf, s.gain, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const data = new Float32Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, data);
        return Array.from(data);
      });
      const error = gl.getError();
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { result, error };
    },
    { shader: COLOR_MIXTURE_GLSL, samples: samples.map((s) => ({ ...s, gain: colorPowerGain(s.gainDb) })) },
  );
  const reference = samples.map(expected);
  await info.attach('color-mixture-oracle.json', {
    body: JSON.stringify({ samples, reference, ...observed }),
    contentType: 'application/json',
  });
  expect(observed.error).toBe(0);
  expect(errors).toEqual([]);
  for (const [i, actual] of observed.result.entries()) {
    expect(actual.every(Number.isFinite), samples[i].name).toBe(true);
    for (let k = 0; k < 4; k++) {
      // float32 shader arithmetic/transcendentals; 3 ppm of total received power.
      const tolerance = Math.max(2e-6, 3e-6 * (reference[i][2] + reference[i][3]));
      expect(Math.abs(actual[k] - reference[i][k]), `${samples[i].name}: ${k}`).toBeLessThan(tolerance);
    }
  }
  const nyquist = observed.result[2];
  expect(Math.abs(Math.atan2(nyquist[1], nyquist[0]))).toBeGreaterThan(3);
  expect(Math.hypot(nyquist[0], nyquist[1])).toBeGreaterThan(0.79);
  // Collapsing these frequencies before filtering instead yields zero signal.
  expect(new WallFilter(60, 1000).magnitude((490 - 490) / 2)).toBe(0);
  expect(observed.result[4][3], 'la sangre no aporta clutter tisular').toBe(0);
});
