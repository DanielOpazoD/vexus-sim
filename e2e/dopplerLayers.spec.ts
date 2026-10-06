import { expect, test } from '@playwright/test';
import { FRAG_TRANS_PREFIX, TISSUE_VEC4 } from '../src/ultrasound/shaders/passes.glsl';
import { TISSUES } from '../src/anatomy/tissues';
import { bootWithoutErrors, budget } from './support';

test('production GPU prefix integrates every tissue exponent, fixed barriers and mirror at distinct frequencies', async ({
  page,
}, info) => {
  budget(120000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy');
  const results = await page.evaluate(
    ({ source, tissues, vec4s }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float render target required');
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0);vUv=p*.5+.5;gl_Position=vec4(p,0,1);}',
        ),
      );
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);
      const texture = (unit: number, w: number, h: number, data: Float32Array | null) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
      };
      const count = tissues.length + 2,
        step = 1.25;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      for (let i = 0; i < 2; i++)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture(3 + i, 1, count, null), 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
      gl.viewport(0, 0, 1, count);
      for (const [name, val] of Object.entries({ uSeg: 0, uHits0: 1, uHits1: 2 })) gl.uniform1i(gl.getUniformLocation(program, name), val);
      gl.uniform1f(gl.getUniformLocation(program, 'uDepth'), count * step);
      gl.uniform1f(gl.getUniformLocation(program, 'uCoarseN'), count);
      gl.uniform1f(gl.getUniformLocation(program, 'uCurvR'), 45);
      let maxB = 0,
        maxD = 0,
        checks = 0,
        nonlinear = 0,
        mirrorChecks = 0;
      for (const fB of [2.5, 3.5, 5])
        for (const fD of [1.5, 2.5, 4])
          for (const mirror of [-1, 12]) {
            const ratios = new Float32Array(vec4s * 4),
              segments = new Float32Array(count * 4);
            // Two initial air cells must remain ignored; every tissue then appears once after skin entry.
            const order = [0, 0, ...tissues.map((_, i) => i).slice(1), 0];
            for (let i = 0; i < tissues.length; i++) {
              const p = tissues[i];
              ratios[i] = p.alpha1 > 0 ? (fD / fB) ** p.b : 1;
            }
            for (let row = 0; row < count; row++) {
              const id = order[row],
                p = tissues[id],
                gas = p.gas ? (id === 10 ? 1 : 2) : 0;
              const loss = row === mirror ? 0.5 : p.gas ? (60 * step) / 10 : (2 * p.alpha1 * fB ** p.b * step) / 10;
              segments[row * 4] = id === 0 ? -loss : loss;
              segments[row * 4 + 2] = p.bone ? 1 : 0;
              segments[row * 4 + 3] = id * 4 + gas;
            }
            texture(0, 1, count, segments);
            texture(1, 1, 1, new Float32Array([mirror, -1, -1, 0]));
            texture(2, 1, 1, new Float32Array([0, 0, 0, mirror >= 0 ? (mirror + 0.5) * step : 0]));
            gl.uniform4fv(gl.getUniformLocation(program, 'uTissueDopplerRatio4[0]'), ratios);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const bOut = new Float32Array(count * 4),
              dOut = new Float32Array(count * 4);
            gl.readBuffer(gl.COLOR_ATTACHMENT0);
            gl.readPixels(0, 0, 1, count, gl.RGBA, gl.FLOAT, bOut);
            gl.readBuffer(gl.COLOR_ATTACHMENT1);
            gl.readPixels(0, 0, 1, count, gl.RGBA, gl.FLOAT, dOut);
            let b = 0,
              d = 0,
              entered = false,
              bone = false;
            for (let row = 0; row < count; row++) {
              const id = order[row],
                p = tissues[id];
              if (id !== 0 || entered) {
                entered = true;
                if (p.bone && !bone) {
                  bone = true;
                  b += 100;
                  d += 100;
                }
                if (row === mirror) {
                  b += 0.5;
                  d += 0.5;
                  mirrorChecks++;
                } else if (p.gas) {
                  b += (60 * step) / 10;
                  d += (60 * step) / 10;
                } else {
                  b += (2 * p.alpha1 * fB ** p.b * step) / 10;
                  d += (2 * p.alpha1 * fD ** p.b * step) / 10;
                  nonlinear += Number(p.b !== 1 && fB !== fD);
                }
              }
              maxB = Math.max(maxB, Math.abs(bOut[row * 4] - b));
              maxD = Math.max(maxD, Math.abs(dOut[row * 4 + 3] - d));
              checks++;
            }
          }
      const error = gl.getError();
      gl.deleteFramebuffer(fb);
      gl.deleteProgram(program);
      return { checks, nonlinear, mirrorChecks, maxB, maxD, error };
    },
    {
      source: FRAG_TRANS_PREFIX,
      tissues: TISSUES.map(({ alpha1, b, gas, bone }) => ({ alpha1, b, gas: !!gas, bone: !!bone })),
      vec4s: TISSUE_VEC4,
    },
  );
  await info.attach('all-tissue-prefix-oracle.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.checks).toBeGreaterThan(600);
  expect(results.nonlinear).toBeGreaterThan(100);
  expect(results.mirrorChecks).toBe(9);
  expect(results.maxB).toBeLessThan(0.01);
  expect(results.maxD).toBeLessThan(0.01);
  expect(results.error).toBe(0);
  expect(errors).toEqual([]);
});
