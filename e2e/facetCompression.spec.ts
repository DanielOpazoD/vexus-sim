import { expect, test } from '@playwright/test';
import { COMPRESSION_GLSL, type Warp } from '../src/anatomy/compression';
import { FACET_COSINE_GLSL, facetCosine } from '../src/ultrasound/interfaceEcho';
import { MIRROR_DIRECTION_GLSL, mirrorDirection } from '../src/ultrasound/transmission';
import type { Vec3 } from '../src/core/vec3';

// Compila los núcleos de producción, no una traducción del cálculo en el test.
const warpStruct = COMPRESSION_GLSL.match(/struct Warp \{[^}]+\};/)?.[0];
const noWarp = COMPRESSION_GLSL.match(/Warp noWarp\(\) \{[^}]+\}/)?.[0];
const warpNormal = COMPRESSION_GLSL.match(/vec3 warpNormal\(Warp w, vec3 n\) \{[^}]+\}/)?.[0];
if (!warpStruct || !warpNormal || !noWarp) throw new Error('No se encontraron los núcleos GLSL de compresión');
const normalize = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
const warps: Warp[] = [
  { shift: 0, rhat: [0, 1, 0], rho: 100, elevation: [0, 0, 1], grad: [0, 0, 0] },
  { shift: 0, rhat: [0, 1, 0], rho: 100, elevation: [0, 0, 1], grad: [0.4, 0.6, 0] },
  { shift: -5, rhat: normalize([1, 2, 0]), rho: 80, elevation: [0, 0, 1], grad: [0.2, -0.3, 0] },
];
const respiratoryWarps = warps.flatMap((w) => [w, { ...w, respiratory: [0.2, -0.5, 0.1] as Vec3 }]);
const samples = respiratoryWarps.flatMap((w) =>
  [normalize([1, 2, 3]), normalize([-2, 1, 0.5]), [0, 1, 0] as Vec3].flatMap((n) =>
    [
      [0.2, 0, 0.1],
      [-0.1, 0.15, 0.2],
      [0, 0, 0],
    ].map((tilt) => ({ w, n, tilt: tilt as Vec3, dir: normalize([0.2, 1, -0.3]) })),
  ),
);

test('facetas y espejo pleural conservan la paridad bajo compresión y respiración en WebGL2', async ({ page }) => {
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
        return samples.flatMap(({ w, n, tilt, dir }) => {
          v('uN', n);
          v('uTilt', tilt);
          v('uDir', dir);
          v('uElevation', w.elevation);
          v('uRhat', w.rhat);
          v('uGrad', w.grad);
          v('uRespiratory', w.respiratory ?? [0, 0, 0]);
          f('uShift', w.shift);
          f('uRho', w.rho);
          return [0, 1, 2, 3].map((component) => {
            gl.uniform1i(gl.getUniformLocation(program, 'uComponent'), component);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const bytes = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Error WebGL al leer incidencia/reflexión');
            return new DataView(bytes.buffer).getFloat32(0, true);
          });
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
uniform vec3 uN,uTilt,uDir,uElevation,uRhat,uGrad,uRespiratory;
uniform float uShift,uRho;
uniform int uComponent;
out vec4 color;
vec3 compressionElevation(){return uElevation;}
${warpStruct}
${noWarp}
${warpNormal}
${FACET_COSINE_GLSL}
${MIRROR_DIRECTION_GLSL}
void main(){
  Warp w=noWarp();
  w.s=uShift; w.rhat=uRhat; w.rho=uRho; w.g=uGrad; w.respiratory=uRespiratory;
  float value;
  if(uComponent==0) value=facetCosine(uN,uDir,uTilt,w);
  else value=mirrorDirection(uDir,uN,w)[uComponent-1];
  uint bits=floatBitsToUint(value);
  color=vec4(float(bits&255u),float((bits>>8)&255u),float((bits>>16)&255u),float((bits>>24)&255u))/255.0;
}`,
    },
  );
  expect(values).toHaveLength(54 * 4);
  for (let i = 0; i < samples.length; i++) {
    const { w, n, tilt, dir } = samples[i];
    expect(Number.isFinite(values[i * 4]), `muestra ${i}`).toBe(true);
    expect(Math.abs(values[i * 4] - facetCosine(n, dir, tilt, w)), `muestra ${i}`).toBeLessThan(3e-6);
    const reflected = mirrorDirection(dir, n, w);
    for (let j = 0; j < 3; j++) expect(Math.abs(values[i * 4 + j + 1] - reflected[j]), `espejo ${i}/${j}`).toBeLessThan(3e-6);
  }
});
