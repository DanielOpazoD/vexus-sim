import { expect, test } from '@playwright/test';
import {
  COMPRESSION_GLSL,
  nodeSin,
  PROBE_COMPRESSION,
  uncompress,
  warpAt,
  warpBound,
  warpNormal,
  type CompressionNode,
  type ProbeCompression,
} from '../src/anatomy/compression';
import { AnatomyScene } from '../src/anatomy/scene';
import { NORMAL_ADULT } from '../src/cases';
import type { Vec3 } from '../src/core/vec3';
import { probeContact } from '../src/probe/contact';
import { CONVEX_C35, pointOnLine } from '../src/probe/probe';
import { budget } from './support';

const q = (v: Vec3): Vec3 => [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])];
const normal = q([0.3, -0.8, 0.4]);

// Campo de producción sobre contactos sintéticos. La escena completa conserva
// sus propias E2E: este oráculo numérico no necesita arrancar la aplicación.
test('compresión cúbica: desplazamiento, jacobiana y normales TS/GLSL en nodos y extremos', async ({ page }, info) => {
  budget(60_000, 0);
  const scene = new AnatomyScene(NORMAL_ADULT);
  const fixtures = [0, 30].map((lift) => {
    const contact = probeContact(
      { phi: 3.55, z: -180, lift, yaw: -0.1321882345454526, rock: 0.3780207766067785, tilt: 0.04720718521646405 },
      CONVEX_C35,
      scene.torso,
    );
    const k: ProbeCompression = {
      ...contact,
      center: q(contact.center),
      axial: q(contact.axial),
      lateral: q(contact.lateral),
      halfAngle: Math.asin(Math.fround(Math.sin(contact.halfAngle))),
      radiusMm: Math.fround(contact.radiusMm),
      halfElevationMm: Math.fround(contact.halfElevationMm),
      reachMm: Math.fround(contact.radiusMm + contact.reachMm) - Math.fround(contact.radiusMm),
      nodes: contact.nodes.map((n): CompressionNode => [Math.fround(n[0]), Math.fround(n[1]), Math.fround(n[2])]),
    };
    const points: Vec3[] = [];
    for (let i = 0; i < PROBE_COMPRESSION.nodes; i++)
      for (const side of [-1e-6, 1e-6])
        for (const depth of [5, 20, 45, k.reachMm + 1])
          points.push(q(pointOnLine(contact.frame, CONVEX_C35, Math.asin(nodeSin(i, CONVEX_C35.halfSector)) + side, depth)));
    return { lift, k, points };
  });
  const observed = await page.evaluate(
    ({ source, fixtures, normal }) => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float target required');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
      const shaders: WebGLShader[] = [],
        textures: WebGLTexture[] = [];
      let program: WebGLProgram | null = null,
        fb: WebGLFramebuffer | null = null,
        vao: WebGLVertexArrayObject | null = null;
      try {
        program = gl.createProgram();
        fb = gl.createFramebuffer();
        vao = gl.createVertexArray();
        if (!program || !fb || !vao) throw new Error('Oracle resources unavailable');
        const compile = (type: number, text: string) => {
          const shader = gl.createShader(type);
          if (!shader) throw new Error('createShader');
          shaders.push(shader);
          gl.shaderSource(shader, text);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile');
          return shader;
        };
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
precision highp float; precision highp int;
uniform highp sampler2D uNodes,uPoints;
uniform vec4 uCompC,uCompAx,uCompLat;
#define COMP_BASE 0
vec4 sceneTexel(int i){return texelFetch(uNodes,ivec2(i,0),0);}
${source}
out vec4 value;
void main(){vec3 p=texelFetch(uPoints,ivec2(int(gl_FragCoord.x),0),0).xyz;Warp w=warpAt(p);
  int row=int(gl_FragCoord.y);
  if(row==0)value=vec4(w.s,w.g);
  else if(row==1)value=vec4(uncompress(p),warpBound(w));
  else value=vec4(warpNormal(w,vec3(${normal.join(',')})),0.0);
}`,
          ),
        );
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
        gl.useProgram(program);
        const linked = program;
        gl.bindVertexArray(vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        for (const flag of [gl.DITHER, gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST]) gl.disable(flag);
        const uniform = (name: string) => {
          const location = gl.getUniformLocation(linked, name);
          if (!location) throw new Error(`Unbound ${name}`);
          return location;
        };
        const texture = (width: number, height: number, data: Float32Array | null) => {
          const t = gl.createTexture();
          if (!t) throw new Error('createTexture');
          textures.push(t);
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
          return t;
        };
        const results = fixtures.map(({ k, points }) => {
          const nodes = texture(k.nodes.length, 1, Float32Array.from(k.nodes.flatMap((n) => [...n, k.radiusMm])));
          const input = texture(points.length, 1, Float32Array.from(points.flatMap((p) => [...p, 0])));
          const output = texture(points.length, 3, null);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete oracle target');
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, nodes);
          gl.uniform1i(uniform('uNodes'), 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, input);
          gl.uniform1i(uniform('uPoints'), 1);
          gl.uniform4f(uniform('uCompC'), ...k.center, k.radiusMm + k.reachMm);
          gl.uniform4f(uniform('uCompAx'), ...k.axial, Math.sin(k.halfAngle));
          gl.uniform4f(uniform('uCompLat'), ...k.lateral, k.halfElevationMm);
          gl.viewport(0, 0, points.length, 3);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const data = new Float32Array(points.length * 12);
          gl.readPixels(0, 0, points.length, 3, gl.RGBA, gl.FLOAT, data);
          if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('Oracle draw/read failed');
          return Array.from(data);
        });
        return { renderer, results };
      } finally {
        gl.useProgram(null);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const t of textures) gl.deleteTexture(t);
        for (const s of shaders) gl.deleteShader(s);
        if (program) gl.deleteProgram(program);
        if (fb) gl.deleteFramebuffer(fb);
        if (vao) gl.deleteVertexArray(vao);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    },
    { source: COMPRESSION_GLSL, fixtures, normal },
  );
  const report = fixtures.map(({ lift, k, points }, index) => {
    const expected: number[][] = [[], [], []];
    for (const p of points) {
      const w = warpAt(p, k);
      expected[0].push(w.shift, ...w.grad);
      expected[1].push(...uncompress(p, k), warpBound(w));
      expected[2].push(...warpNormal(w, normal), 0);
    }
    const flat = expected.flat(),
      actual = observed.results[index];
    expect(actual).toHaveLength(flat.length);
    const maxAbs = Math.max(...actual.map((v, i) => Math.abs(v - flat[i])));
    return { lift, points: points.length, maxAbs };
  });
  await info.attach('compression-numeric-oracle', {
    body: JSON.stringify({
      renderer: observed.renderer,
      report,
      scope: 'production compression GLSL; synthetic contacts; not full-scene approval',
    }),
    contentType: 'application/json',
  });
  for (const row of report) expect(row.maxAbs, `lift ${row.lift}`).toBeLessThan(0.002);
});
