import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { FRAG_TRANS_HITS, VERT } from '../src/ultrasound/shaders/passes.glsl';
import { MIRROR_BISECTION_STEPS } from '../src/ultrasound/transmission';
// Frozen prior A0 body, with analytical planes replacing anatomy solely in this test.
// Production keeps the shared full classifier and its resolution unchanged.
const before = readFileSync(new URL('./fixtures/transmissionHits-4c2892c.glsl', import.meta.url), 'utf8');
const prefix = before.slice(0, before.indexOf('uniform float uCoarseN;'));
const shader = {
  before,
  after: prefix + FRAG_TRANS_HITS.slice(FRAG_TRANS_HITS.indexOf('uniform float uCoarseN;')),
  VERT,
  MIRROR_BISECTION_STEPS,
};
test('actual A0 preserves phantom hits and analytical reflection', async ({ page }, info) => {
  const result = await page.evaluate(
    ({ shader }) => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('Float GL unavailable');
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!);
        return s;
      };
      const programs = [shader.before, shader.after].map((f) => {
        const p = gl.createProgram()!;
        gl.attachShader(p, compile(gl.VERTEX_SHADER, shader.VERT));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)!);
        return p;
      });
      const W = 64,
        fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      for (let i = 0; i < 3; i++) {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, 1, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('incomplete target');
      gl.viewport(0, 0, W, 1);
      const fixtures = [
          [0, 0, 0, 0],
          [50, 0, 0, 0],
          [63.271, 23.4, 29.6, 0],
          [80.021, 0, 0, 1],
          [90, 12.61, 30.015, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 2],
        ],
        records: any[] = [];
      let comparedValues = 0,
        maxDifference = 0,
        maxMirrorError = 0;
      for (const fixture of fixtures)
        for (const coarse of [32, 64, 256, 512, 600])
          for (const depth of [120, 180]) {
            const samples = programs.map((p) => {
              gl.useProgram(p);
              gl.uniform1f(gl.getUniformLocation(p, 'uDepth'), depth);
              gl.uniform1f(gl.getUniformLocation(p, 'uCoarseN'), coarse);
              gl.uniform4fv(gl.getUniformLocation(p, 'uFixture'), fixture);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              return [0, 1, 2].map((a) => {
                const b = new Float32Array(W * 4);
                gl.readBuffer(gl.COLOR_ATTACHMENT0 + a);
                gl.readPixels(0, 0, W, 1, gl.RGBA, gl.FLOAT, b);
                return Array.from(b);
              });
            });
            const err = gl.getError();
            if (err !== gl.NO_ERROR) throw Error('GL error:' + err);
            let local = 0;
            for (let a = 0; a < 3; a++)
              for (let i = 0; i < W * 4; i++) {
                local = Math.max(local, Math.abs(samples[0][a][i] - samples[1][a][i]));
                comparedValues++;
              }
            maxDifference = Math.max(maxDifference, local);
            if (fixture[0] > 0)
              for (let i = 0; i < W; i++) {
                const th = ((i + 0.5) / W - 0.5) * 1.1,
                  expected = fixture[0] / Math.cos(th),
                  actual = samples[1][1][i * 4 + 3],
                  delta = Math.abs(expected - actual);
                maxMirrorError = Math.max(maxMirrorError, delta);
                if (delta > depth / coarse / 2 ** (shader.MIRROR_BISECTION_STEPS + 1) + 0.00005)
                  throw Error(
                    'Analytical reflection outside bisection interval:' + JSON.stringify({ fixture, coarse, depth, i, actual, expected }),
                  );
                if (Math.abs(samples[1][1][i * 4 + 2] + Math.cos(th)) > 1e-6) throw Error('Wrong reflected direction');
              }
            records.push({ fixture, coarse, depth, maxDifference: local });
          }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        records,
        comparedValues,
        maxDifference,
        maxMirrorError,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        clinicalAcceptance: false,
        limits:
          'Synthetic planes exercise actual A0. These are neither full anatomical acquisitions nor independent validation of the atlas.',
      };
    },
    { shader },
  );
  writeFileSync(info.outputPath('phantom-proof.json'), JSON.stringify(result, null, 2));
  await info.attach('phantom-physical-proof', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.maxDifference).toBe(0);
  expect(result.records).toHaveLength(70);
});
