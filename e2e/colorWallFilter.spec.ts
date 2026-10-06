import { expect, test } from '@playwright/test';
import { COLOR_WALL_FILTER_GLSL } from '../src/ultrasound/colorWallFilter';
import { bootWithoutErrors, budget } from './support';

test('GPU color filter: sampled aliases and disabled stationary signal remain finite', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1');
  const inputs = [
    [0, 0],
    [0, 60],
    [1000, 60],
    [-1000, 60],
    [400, 60],
    [1400, 60],
    [-600, 60],
    [400, 600],
    [1000, 0],
  ];
  const output = await page.evaluate(
    ({ source, inputs }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float target required');
      const compile = (kind: number, source: string) => {
        const shader = gl.createShader(kind)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0);gl_Position=vec4(p,0.0,1.0);}',
        ),
      );
      const values = inputs.map(([f, cutoff]) => `vec2(${f.toFixed(1)},${cutoff.toFixed(1)})`).join(',');
      gl.attachShader(
        program,
        compile(
          gl.FRAGMENT_SHADER,
          `#version 300 es
precision highp float;
${source}
out vec4 outValue;
void main(){vec2 inputs[${inputs.length}]=vec2[${inputs.length}](${values});vec2 v=inputs[int(gl_FragCoord.x)];float w=colorWallResponseHz(v.x,v.y,1000.0);outValue=vec4(w*cos(6.283185307*v.x/1000.0),w*sin(6.283185307*v.x/1000.0),w,1.0);}`,
        ),
      );
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, inputs.length, 1);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float target');
      gl.viewport(0, 0, inputs.length, 1);
      gl.useProgram(program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const data = new Float32Array(inputs.length * 4);
      gl.readPixels(0, 0, inputs.length, 1, gl.RGBA, gl.FLOAT, data);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      gl.deleteProgram(program);
      return Array.from(data);
    },
    { source: COLOR_WALL_FILTER_GLSL, inputs },
  );
  await info.attach('sampled-filter-oracle.json', { body: JSON.stringify({ inputs, output }), contentType: 'application/json' });
  expect(output.every(Number.isFinite)).toBe(true);
  for (const [i, [frequency, cutoff]] of inputs.entries()) {
    // Independent sample-to-sample IQ phase, not the production folding function.
    const phase = Math.atan2(Math.sin((2 * Math.PI * frequency) / 1000), Math.cos((2 * Math.PI * frequency) / 1000));
    const f = (phase * 1000) / (2 * Math.PI);
    const expected = cutoff === 0 ? 1 : Math.pow(1 / (1 + (cutoff / Math.abs(f)) ** 2), 4);
    expect(output[4 * i + 2]).toBeCloseTo(expected, 6);
    // GLSL float32 sin/cos at an aliased 2π multiple differ by up to ~0.6e-6 on Metal.
    // Bound the numerical phasor error explicitly; the filter-power guard stays at 5e-7.
    expect(Math.abs(output[4 * i] - expected * Math.cos(phase))).toBeLessThan(2e-6);
    expect(Math.abs(output[4 * i + 1] - expected * Math.sin(phase))).toBeLessThan(2e-6);
  }
  expect(errors).toEqual([]);
});
