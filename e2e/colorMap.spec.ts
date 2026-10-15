import { expect, test } from '@playwright/test';
import { COLOR_MAP_GLSL, colorMapRgb } from '../src/ultrasound/colorMap';

test('barra CPU y paleta GPU coinciden desde cero hasta Nyquist', async ({ page }) => {
  const samples = [-1, 0, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2].flatMap((mag) => [false, true].map((toward) => ({ mag, toward })));
  const result = await page.evaluate(
    ({ shader, samples }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const gl = canvas.getContext('webgl2', { antialias: false });
      if (!gl) throw new Error('WebGL2 unavailable');
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
        return shader;
      };
      const vertex = compile(
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}',
      );
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        `#version 300 es\nprecision highp float;uniform vec2 sampleValue;out vec4 pixel;\n${shader}\nvoid main(){pixel=vec4(colorVelocityMap(sampleValue.x,sampleValue.y),1.);}`,
      );
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);
      gl.disable(gl.DITHER);
      const value = gl.getUniformLocation(program, 'sampleValue');
      const pixels = samples.map(({ mag, toward }) => {
        gl.uniform2f(value, toward ? 1 : -1, mag);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const rgba = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return [...rgba];
      });
      const error = gl.getError();
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { pixels, error };
    },
    { shader: COLOR_MAP_GLSL, samples },
  );
  expect(result.error).toBe(0);
  for (const [i, sample] of samples.entries()) {
    const cpu = colorMapRgb(sample.toward, sample.mag);
    // UNORM8 rounding may differ by one least-significant bit across GPU backends.
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(result.pixels[i][channel] - cpu[channel])).toBeLessThanOrEqual(1);
    expect(result.pixels[i][3]).toBe(255);
    if (sample.mag <= 0) expect(result.pixels[i].slice(0, 3)).toEqual([0, 0, 0]);
  }
});
