import { expect, test } from '@playwright/test';
import { COMPRESSION_GLSL, type Warp } from '../src/anatomy/compression';
import { FACET_COSINE_GLSL, facetCosine } from '../src/ultrasound/interfaceEcho';
import type { Vec3 } from '../src/core/vec3';

// Compila los núcleos de producción, no una traducción del cálculo en el test.
const warpStruct = COMPRESSION_GLSL.match(/struct Warp \{[^}]+\};/)?.[0];
const warpNormal = COMPRESSION_GLSL.match(/vec3 warpNormal\(Warp w, vec3 n\) \{[^}]+\}/)?.[0];
if (!warpStruct || !warpNormal) throw new Error('No se encontraron los núcleos GLSL de compresión');
const normalize = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
const warps: Warp[] = [
  { shift: 0, rhat: [0, 1, 0], rho: 100, elevation: [0, 0, 1], grad: [0, 0, 0] },
  { shift: 0, rhat: [0, 1, 0], rho: 100, elevation: [0, 0, 1], grad: [0.4, 0.6, 0] },
  { shift: -5, rhat: normalize([1, 2, 0]), rho: 80, elevation: [0, 0, 1], grad: [0.2, -0.3, 0] },
];
const samples = warps.flatMap((w) =>
  [normalize([1, 2, 3]), normalize([-2, 1, 0.5]), [0, 1, 0] as Vec3].flatMap((n) =>
    [
      [0.2, 0, 0.1],
      [-0.1, 0.15, 0.2],
      [0, 0, 0],
    ].map((tilt) => ({ w, n, tilt: tilt as Vec3, dir: normalize([0.2, 1, -0.3]) })),
  ),
);

test('las facetas materiales conservan la paridad de incidencia bajo compresión en WebGL2', async ({ page }) => {
  // Banco de kernel, sin cargar la escena: las E2E existentes ejercitan su integración en las pasadas B.
  const values = await page.evaluate(
    ({ source, samples }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 no disponible');
      const shaders: WebGLShader[] = [];
      const program = gl.createProgram();
      if (!program) throw new Error('No se pudo crear el programa');
      const vao = gl.createVertexArray();
      try {
        const compile = (type: number, code: string) => {
          const shader = gl.createShader(type);
          if (!shader) throw new Error('No se pudo crear el shader');
          shaders.push(shader);
          gl.shaderSource(shader, code);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Fallo de compilación');
          gl.attachShader(program, shader);
        };
        compile(
          gl.VERTEX_SHADER,
          `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`,
        );
        compile(gl.FRAGMENT_SHADER, source);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Fallo de enlace');
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.viewport(0, 0, 1, 1);
        gl.disable(gl.DITHER);
        const v = (name: string, x: number[]) => gl.uniform3fv(gl.getUniformLocation(program, name), x);
        const f = (name: string, x: number) => gl.uniform1f(gl.getUniformLocation(program, name), x);
        return samples.map(({ w, n, tilt, dir }) => {
          v('uN', n);
          v('uTilt', tilt);
          v('uDir', dir);
          v('uElevation', w.elevation);
          v('uRhat', w.rhat);
          v('uGrad', w.grad);
          f('uShift', w.shift);
          f('uRho', w.rho);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const bytes = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Error WebGL al leer incidencia');
          return new DataView(bytes.buffer).getFloat32(0, true);
        });
      } finally {
        for (const s of shaders) gl.deleteShader(s);
        gl.deleteProgram(program);
        gl.deleteVertexArray(vao);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    },
    {
      samples,
      source: `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uN,uTilt,uDir,uElevation,uRhat,uGrad;
uniform float uShift,uRho;
out vec4 color;
vec3 compressionElevation(){return uElevation;}
${warpStruct}
${warpNormal}
${FACET_COSINE_GLSL}
void main(){
  Warp w=Warp(uShift,uRhat,uRho,uGrad);
  uint bits=floatBitsToUint(facetCosine(uN,uDir,uTilt,w));
  color=vec4(float(bits&255u),float((bits>>8)&255u),float((bits>>16)&255u),float((bits>>24)&255u))/255.0;
}`,
    },
  );
  expect(values).toHaveLength(27);
  for (let i = 0; i < samples.length; i++) {
    const { w, n, tilt, dir } = samples[i];
    expect(Number.isFinite(values[i]), `muestra ${i}`).toBe(true);
    expect(Math.abs(values[i] - facetCosine(n, dir, tilt, w)), `muestra ${i}`).toBeLessThan(3e-6);
  }
});
