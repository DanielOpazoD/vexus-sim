import { expect, test } from '@playwright/test';
import { quadratusSdf, RETROPERITONEUM_GLSL } from '../src/anatomy/organs/retroperitoneum';
import type { Vec3 } from '../src/core/vec3';
import { budget } from './support';

test('production quadratus field closes at the wall in GPU as in CPU', async ({ page }, info) => {
  budget(60000, 0);
  // Isolate the actual production function, not an independent rewrite of its formula.
  // Its only dependencies are the four QL constants; no anatomical samplers are used.
  const constants = [...RETROPERITONEUM_GLSL.matchAll(/const vec[234] QL_.*?;/g)].map((m) => m[0]).join('\n');
  const field = RETROPERITONEUM_GLSL.slice(
    RETROPERITONEUM_GLSL.indexOf('float quadratusSdf('),
    RETROPERITONEUM_GLSL.indexOf('float retroFrontY('),
  );
  expect(constants.split('\n')).toHaveLength(4);
  const inputs: { p: Vec3; wall: number; peri: number }[] = [];
  for (const x of [-95, -65, -35, 35, 65, 95])
    for (const z of [-220, -150, -85, -30])
      for (const wall of [-80, -0.1, 0, 0.1, 6, 14, 28]) for (const peri of [-2, 100]) inputs.push({ p: [x, -75, z], wall, peri });
  await page.setContent('<!doctype html><title>Posterior muscle field oracle</title>');
  const result = await page.evaluate(
    ({ source, inputs }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float target required');
      const shaders: WebGLShader[] = [];
      const compile = (type: number, text: string) => {
        const shader = gl.createShader(type)!;
        shaders.push(shader);
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0);gl_Position=vec4(p,0,1);}',
        ),
      );
      gl.attachShader(
        program,
        compile(
          gl.FRAGMENT_SHADER,
          `#version 300 es
precision highp float;
${source}
uniform vec3 point;
uniform vec2 distances;
out vec4 value;
void main(){value=vec4(quadratusSdf(point,distances.x,distances.y),0,0,1);}`,
        ),
      );
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float target');
      gl.viewport(0, 0, 1, 1);
      gl.useProgram(program);
      const point = gl.getUniformLocation(program, 'point');
      const distances = gl.getUniformLocation(program, 'distances');
      const pixels = new Float32Array(4);
      const values = inputs.map(({ p, wall, peri }) => {
        gl.uniform3fv(point, p);
        gl.uniform2f(distances, wall, peri);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels);
        return pixels[0];
      });
      const error = gl.getError();
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { values, error };
    },
    { source: constants + '\n' + field, inputs },
  );
  let maxError = 0;
  let interior = 0;
  for (const [i, input] of inputs.entries()) {
    const cpu = quadratusSdf(input.p, input.wall, input.peri);
    maxError = Math.max(maxError, Math.abs(cpu - result.values[i]));
    if (input.wall < 0) expect(result.values[i], JSON.stringify(input)).toBeGreaterThan(0);
    if (cpu < -0.01) {
      interior++;
      expect(result.values[i]).toBeLessThan(0);
    }
  }
  expect(interior).toBeGreaterThan(0);
  expect(maxError).toBeLessThan(0.001);
  expect(result.error).toBe(0);
  await info.attach('quadratus-domain.json', {
    body: JSON.stringify({ count: inputs.length, maxError, interior, inputs, ...result }),
    contentType: 'application/json',
  });
});
