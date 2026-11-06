import { expect, test } from '@playwright/test';
import { ANATOMY_GLSL } from '../src/anatomy/gpu/anatomy.glsl';
import type { Torso } from '../src/anatomy/primitives';
import type { Vec3 } from '../src/core/vec3';
import { SPECKLE_TISSUE_GLSL } from '../src/ultrasound/speckleField';
import { fatSeptum, muscleStriation, WALL_TEXTURE_GLSL } from '../src/ultrasound/wallTexture';
import { budget } from './support';

test('septos y estrías de pared coinciden entre CPU y GLSL', async ({ page }, info) => {
  budget(120_000, 0);
  // Entradas exactamente representables como en el uniform/texture de WebGL.
  const t: Torso = { a: 160, b: 105, zMin: -300, zMax: 100, skinMm: 2, fatMm: 14, muscleMm: 12, preperitonealMm: Math.fround(2.1) };
  const points: Vec3[] = [];
  for (const z of [-117, -83, -31, 19])
    for (const angle of [-1.8, -1, -0.4, 0.16, 0.83, 1.6])
      for (let d = 1; d < 29; d += 0.43) {
        const x = t.a * Math.sin(angle),
          y = t.b * Math.cos(angle),
          scale = 1 - d / Math.hypot(x, y);
        points.push([Math.fround(x * scale), Math.fround(y * scale), z]);
      }
  const shader = `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
uniform float uSeed, uAnchorW;
uniform vec2 uAnchorSalt;
uniform vec3 uAnchorE0, uAnchorP0, uAnchorE1, uAnchorP1;
${SPECKLE_TISSUE_GLSL}
${WALL_TEXTURE_GLSL}
uniform highp sampler2D uPoints;
out vec4 value;
void main() {
  vec3 m=texelFetch(uPoints,ivec2(int(gl_FragCoord.x),0),0).xyz;
  value=int(gl_FragCoord.y)==0 ? fatSeptum(m) : muscleStriation(m);
}`;
  const observed = await page.evaluate(
    ({ shader, points, t }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float target required');
      const compile = (type: number, source: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
        return s;
      };
      const vertex = compile(
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main(){gl_Position=vec4(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0,0,1);}',
      );
      const fragment = compile(gl.FRAGMENT_SHADER, shader),
        program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);
      gl.uniform4f(gl.getUniformLocation(program, 'uTorso'), t.a, t.b, t.zMin, t.zMax);
      gl.uniform4f(gl.getUniformLocation(program, 'uWall'), t.skinMm, t.fatMm, t.muscleMm, t.preperitonealMm);
      const input = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        points.length,
        1,
        0,
        gl.RGBA,
        gl.FLOAT,
        Float32Array.from(points.flatMap((p) => [...p, 0])),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(gl.getUniformLocation(program, 'uPoints'), 0);
      const output = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, output);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, points.length, 2);
      // Los samplers de anatomía no utilizados deben tener un tipo/unidad compatible.
      for (const name of ['uBodyCoefficients', 'uBoneAtlas', 'uAtlas']) gl.uniform1i(gl.getUniformLocation(program, name), 2);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer unavailable');
      gl.viewport(0, 0, points.length, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const data = new Float32Array(points.length * 8);
      gl.readPixels(0, 0, points.length, 2, gl.RGBA, gl.FLOAT, data);
      const error = gl.getError(),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(input);
      gl.deleteTexture(output);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { data: Array.from(data), error, renderer };
    },
    { shader, points, t },
  );
  const reference = [fatSeptum, muscleStriation].flatMap((fn) => points.flatMap((p) => fn(p, t)));
  const delta = observed.data.map((v, i) => Math.abs(v - reference[i]));
  await info.attach('wall-texture-parity.json', {
    body: JSON.stringify({ points, t, reference, ...observed, maxDelta: Math.max(...delta) }),
    contentType: 'application/json',
  });
  expect(observed.error).toBe(0);
  expect(observed.data.every(Number.isFinite)).toBe(true);
  // Hash y trascendentes float32: 2 % del rango unitario; no tolerancia de realismo.
  // Un estrato/periodo distinto o la máscara anterior producen discrepancias O(1).
  for (let i = 0; i < delta.length; i++) expect(delta[i], `componente ${i}`).toBeLessThan(0.02);
});
