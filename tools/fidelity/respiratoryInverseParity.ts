/** Actual anatomy GLSL: respiratory inverse against known material points, with/without probe compression. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { AnatomyScene } from '../../src/anatomy/scene';
import { RespiratoryDeformation, RESPIRATORY_INVERSE_STEPS } from '../../src/anatomy/deformation';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { ANATOMY_GLSL, BODY_BASE, COMPRESSION_BASE, SCENE_TEX_H, SCENE_TEX_W } from '../../src/anatomy/gpu/anatomy.glsl';
import { evaluateSceneUniforms } from '../../src/anatomy/gpu/sceneUniforms';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { START_POINTS } from '../../src/app/startPoints';
import { probeContact } from '../../src/probe/contact';
import { clampPose, CONVEX_C35 } from '../../src/probe/probe';
import type { Vec3 } from '../../src/core/vec3';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const out = process.env.RESP_INVERSE_OUT ?? '/tmp/vexus-respiratory-inverse';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const reports: object[] = [];
try {
  const page = await browser.newPage();
  for (const reference of [false, true]) {
    setReferenceBody(reference ? profile : undefined);
    const scene = new AnatomyScene(NORMAL_ADULT),
      deformation = new RespiratoryDeformation(scene);
    const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
    const physiological = engine.step();
    const materials: Vec3[] = [
      [80, 35, -85],
      [-60, 55, -60],
      [0, 0, 0],
    ];
    for (let x = -130; x <= 130; x += 10)
      for (let y = -80; y <= 90; y += 10)
        for (let z = -140; z <= 80; z += 10) {
          const m: Vec3 = [x, y, z];
          if (scene.insideWallMm(m) >= 0) materials.push(m);
        }
    const sp = START_POINTS.find((x) => x.id === 'subcostal')!;
    const contact = probeContact(
      clampPose({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: -4 }),
      CONVEX_C35,
      scene.torso,
    );
    for (const compressed of [false, true])
      for (const mm of [0, 10, 30]) {
        deformation.compression = compressed ? contact : null;
        const sample = { ...physiological, resp: { ...physiological.resp, diaphragmCaudalMm: mm } };
        const values = evaluateSceneUniforms(scene, { sample, tubeCount: 0, compression: deformation.compression }).map(
          ({ spec, data }) => ({ name: spec.name, type: spec.type, data: Array.from(data) }),
        );
        const sceneData = new Float32Array(SCENE_TEX_W * SCENE_TEX_H * 4);
        if (reference) sceneData.set(profile, BODY_BASE * 4);
        if (compressed) contact.nodes.forEach((n, i) => sceneData.set([n[0], n[1], n[2], contact.radiusMm], (COMPRESSION_BASE + i) * 4));
        const world = materials.map((m) => deformation.toWorld(m, sample.resp).map(Math.fround) as Vec3);
        const cpu = world.map((p) => deformation.toMaterial(p, sample.resp));
        const result = await page.evaluate(
          ({ anatomy, values, sceneData, world, sceneWidth, sceneHeight }) => {
            const width = 256,
              height = Math.ceil(world.length / width),
              canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const gl = canvas.getContext('webgl2', { antialias: false });
            if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float targets unavailable');
            const [compile] = [
              (kind: number, source: string) => {
                const s = gl.createShader(kind)!;
                gl.shaderSource(s, source);
                gl.compileShader(s);
                if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Compile failure');
                return s;
              },
            ];
            const program = gl.createProgram();
            gl.attachShader(
              program,
              compile(
                gl.VERTEX_SHADER,
                '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}',
              ),
            );
            gl.attachShader(
              program,
              compile(
                gl.FRAGMENT_SHADER,
                `#version 300 es
precision highp float;precision highp int;
${anatomy}
uniform highp sampler2D uInputPoints;
uniform int uPointCount;
layout(location=0) out vec4 result;
void main(){int i=int(gl_FragCoord.y)*256+int(gl_FragCoord.x);result=vec4(0);if(i>=uPointCount)return;vec3 p=texelFetch(uInputPoints,ivec2(i%256,i/256),0).xyz;vec3 m=toMaterial(p);vec3 q=uncompress(p);result=vec4(m,length(m+uResp.x*respWeight(m)*uResp.yzw-q));}`,
              ),
            );
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link failure');
            gl.useProgram(program);
            gl.bindVertexArray(gl.createVertexArray());
            const [texture] = [
              (w: number, h: number, data: Float32Array | null) => {
                const t = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
                return t;
              },
            ];
            const target = texture(width, height, null),
              framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
            gl.activeTexture(gl.TEXTURE0);
            texture(sceneWidth, sceneHeight, Float32Array.from(sceneData));
            gl.uniform1i(gl.getUniformLocation(program, 'uSceneTex'), 0);
            const points = new Float32Array(width * height * 4);
            world.forEach((p, i) => points.set(p, i * 4));
            gl.activeTexture(gl.TEXTURE1);
            texture(width, height, points);
            gl.uniform1i(gl.getUniformLocation(program, 'uInputPoints'), 1);
            gl.uniform1i(gl.getUniformLocation(program, 'uPointCount'), world.length);
            for (const u of values) {
              const loc = gl.getUniformLocation(program, u.name);
              if (loc === null) continue;
              const data = Float32Array.from(u.data);
              switch (u.type) {
                case 'int':
                  gl.uniform1iv(loc, Int32Array.from(u.data));
                  break;
                case 'float':
                  gl.uniform1fv(loc, data);
                  break;
                case 'vec2':
                  gl.uniform2fv(loc, data);
                  break;
                case 'vec3':
                  gl.uniform3fv(loc, data);
                  break;
                case 'vec4':
                  gl.uniform4fv(loc, data);
                  break;
              }
            }
            gl.viewport(0, 0, width, height);
            const pixels = new Float32Array(width * height * 4),
              times: number[] = [];
            for (let i = 0; i < 4; i++) {
              const start = performance.now();
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
              if (i) times.push(performance.now() - start);
            }
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
            const debug = gl.getExtension('WEBGL_debug_renderer_info'),
              renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
            const result = { values: Array.from(pixels.slice(0, world.length * 4)), times, renderer };
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return result;
          },
          { anatomy: ANATOMY_GLSL, values, sceneData: Array.from(sceneData), world, sceneWidth: SCENE_TEX_W, sceneHeight: SCENE_TEX_H },
        );
        let cpuError = 0,
          gpuError = 0,
          parityError = 0,
          residual = 0,
          failed = 0;
        const witnesses: object[] = [];
        for (let i = 0; i < materials.length; i++) {
          const gpu = result.values.slice(i * 4, i * 4 + 3),
            m = materials[i];
          const a = Math.hypot(...cpu[i].map((x, j) => x - m[j])),
            b = Math.hypot(...gpu.map((x, j) => x - m[j])),
            c = Math.hypot(...gpu.map((x, j) => x - cpu[i][j]));
          cpuError = Math.max(cpuError, a);
          gpuError = Math.max(gpuError, b);
          parityError = Math.max(parityError, c);
          residual = Math.max(residual, result.values[i * 4 + 3]);
          if (![...gpu, a, b, c, result.values[i * 4 + 3]].every(Number.isFinite) || a >= 0.002 || b >= 0.002 || c >= 0.002) {
            failed++;
            if (witnesses.length < 20) witnesses.push({ i, material: m, world: world[i], cpu: cpu[i], gpu, a, b, c });
          }
        }
        reports.push({
          reference,
          compressed,
          mm,
          points: materials.length,
          cpuError,
          gpuError,
          parityError,
          maxRespiratoryForwardResidual: residual,
          failed,
          witnesses,
          queryIncludingReadbackMs: result.times,
          renderer: result.renderer,
        });
        writeFileSync(
          `${out}/report.json`,
          JSON.stringify(
            { candidateSha: process.env.CANDIDATE_SHA ?? null, steps: RESPIRATORY_INVERSE_STEPS, thresholdMm: 0.002, reports },
            null,
            2,
          ) + '\n',
        );
        console.log(JSON.stringify(reports.at(-1)));
        if (failed) throw new Error(`${failed} inverse queries failed`);
      }
  }
} catch (error) {
  writeFileSync(`${out}/failure.json`, JSON.stringify({ error: String(error) }, null, 2) + '\n');
  throw error;
} finally {
  setReferenceBody();
  await browser.close();
}
