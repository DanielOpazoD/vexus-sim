import { expect, test } from '@playwright/test';
import { FRAG_SCANCONVERT } from '../src/ultrasound/shaders/passes.glsl';
import { budget } from './support';

test('la prioridad B protege tejido brillante aun con clutter potente y conserva flujo oscuro', async ({ page }, info) => {
  budget(120_000, 0);
  const samples = [0.2, 0.8].flatMap((grey) => [0.01, 0.2, 1, 1000].flatMap((power) => [-1, 1].map((sign) => ({ grey, power, sign }))));
  const result = await page.evaluate(
    ({ shader, samples }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const gl = canvas.getContext('webgl2', { antialias: false })!;
      const compile = (kind: number, source: string) => {
        const s = gl.createShader(kind)!;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!);
        return s;
      };
      const vertex = compile(
        gl.VERTEX_SHADER,
        '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}',
      );
      const fragment = compile(gl.FRAGMENT_SHADER, shader);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);
      gl.disable(gl.DITHER);
      gl.viewport(0, 0, 1, 1);
      const u = (name: string) => gl.getUniformLocation(program, name);
      for (const [name, value] of Object.entries({
        uScale: 1,
        uCurvR: 0,
        uHalfSector: 1,
        uDepth: 10,
        uPrf: 1000,
        uColorThreshold: 0.1,
        uColorPriority: 0.5,
        uGainDb: 0,
        uRefDb: 0,
        uNominalTgcDbPerCm: 0,
        uTgcCapDb: 0,
        uDynRange: 60,
        uGreyCurve: 1,
      }))
        gl.uniform1f(u(name), value);
      gl.uniform1fv(u('uTgc[0]'), new Float32Array(8));
      gl.uniform2f(u('uCanvas'), 1, 1);
      gl.uniform2f(u('uApex'), 0.5, -1);
      gl.uniform4f(u('uBox'), -1, 1, 0, 10);
      gl.uniform1i(u('uColorOn'), 1);
      gl.uniform1i(u('uColorInvert'), 0);
      const textures = [0, 1].map((unit) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
      });
      gl.uniform1i(u('uEnv'), 0);
      gl.uniform1i(u('uColor'), 1);
      const pixels = samples.map((s) => {
        // Inversa analítica del mapa gris configurado: 2^((20log10(env)+60)/60)-1.
        const env = 10 ** ((Math.log2(1 + s.grey) * 60 - 60) / 20);
        for (const [unit, data] of [
          [0, [env, 0, 0, 1]],
          [1, [0, s.sign * s.power, 0, 0]],
        ] as const) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(data));
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [...px];
      });
      const error = gl.getError();
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { pixels, error };
    },
    { shader: FRAG_SCANCONVERT, samples },
  );
  await info.attach('prioridad-scanconvert.json', { body: JSON.stringify({ samples, ...result }), contentType: 'application/json' });
  expect(result.error).toBe(0);
  for (const [i, s] of samples.entries()) {
    const px = result.pixels[i];
    if (s.grey >= 0.5 || s.power <= 0.1)
      for (const c of px.slice(0, 3)) expect(Math.abs(c - Math.round(s.grey * 255)), JSON.stringify(s)).toBeLessThanOrEqual(1);
    else {
      expect(Math.max(...px.slice(0, 3)) - Math.min(...px.slice(0, 3))).toBeGreaterThan(50);
      expect(s.sign > 0 ? px[0] > px[2] : px[2] > px[0]).toBe(true);
    }
  }
});
