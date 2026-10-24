import { expect, test } from '@playwright/test';
import { torsoNormal, torsoSkinPoint, type Torso } from '../src/anatomy/primitives';
import { wallArc, wallDepths } from '../src/anatomy/organs/wall';
import type { Vec3 } from '../src/core/vec3';
import { FIRST_WALL_INTERFACE, LAST_WALL_INTERFACE } from '../src/anatomy/interfaces';
import { SCENE_UNIFORMS } from '../src/anatomy/gpu/sceneUniforms';
import { ANATOMY_GLSL } from '../src/anatomy/gpu/anatomy.glsl';
import { SPECKLE_TISSUE_GLSL } from '../src/ultrasound/speckleField';
import { WALL_TEXTURE_GLSL } from '../src/ultrasound/wallTexture';
import { bootWithoutErrors, budget, checkAfterEach, withinFrames } from './support';

checkAfterEach();
// Oráculo independiente de la fase escalar original; las derivadas nuevas no se usan.
const source = `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
uniform float uSeed, uAnchorW;
uniform vec2 uAnchorSalt;
uniform vec3 uAnchorE0, uAnchorP0, uAnchorE1, uAnchorP1;
${SPECKLE_TISSUE_GLSL}
${WALL_TEXTURE_GLSL}
uniform highp sampler2D uPoints;
uniform int uMuscleCount;
layout(location=0) out vec4 result;
float phaseAt(vec3 p) {
  float u=wallArc(p),v=p.z,P=wallPerimeter();
  float U=1.1*sin(wallWavenumber(7.0,P)*u+0.8*sin(v/11.0))+0.5*sin(v/9.0+wallWavenumber(17.0,P)*u);
  float J=WT_STRIA_JITTER*WT_STRIA_SPACING*(valueNoise(vec3(u/WT_STRIA_JITTER_MM,v/WT_STRIA_JITTER_MM,0.0),71.3)-0.5);
  return -torsoDepth(p)-wallDepths(u,v).y+U+J;
}
void main() {
  vec3 p = texelFetch(uPoints, ivec2(int(gl_FragCoord.x),0),0).xyz;
  if (int(gl_FragCoord.x) >= uMuscleCount) {
    float a=wallFaceGain(vec3(-0.002,p.yz),int(p.x)),b=wallFaceGain(vec3(0.002,p.yz),int(p.x));
    result=vec4(a,b,abs(log(a/b)),p.x);return;
  }
  vec4 s=muscleStriation(p);
  float h=0.002;
  vec3 g=vec3(phaseAt(p+vec3(h,0,0))-phaseAt(p-vec3(h,0,0)),
              phaseAt(p+vec3(0,h,0))-phaseAt(p-vec3(0,h,0)),
              phaseAt(p+vec3(0,0,h))-phaseAt(p-vec3(0,0,h)))/(2.0*h);
  float f=phaseAt(p),k=floor(f/WT_STRIA_SPACING+0.5);
  float distance=abs(f-k*WT_STRIA_SPACING)/length(g);
  float mask=smoothstep(WT_STRIA_MASK0,WT_STRIA_MASK1,valueNoise(vec3(wallArc(p)/WT_STRIA_SEGMENT_MM,p.z/WT_STRIA_SEGMENT_MM,k*1.37),83.7));
  float expected=mask*exp(-0.5*distance*distance/(WT_STRIA_SIGMA*WT_STRIA_SIGMA));
  result=vec4(abs(dot(normalize(g),s.xyz)),s.w,abs(s.w-expected),length(s.xyz));
}`;

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`muscle normals and width follow their material phase, ${caseId}`, async ({ page }, info) => {
    budget(120_000);
    await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    const previousFrame = await page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame!.n);
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await withinFrames(page, 30, 'cuadro adquirido del paciente actual', () =>
      page.evaluate((previous) => {
        const s = window.__vexusTest!.sim();
        return ((s.renderer.displayedFrame?.n ?? 0) > previous && s.renderer.displayedAnatomy?.seed === s.patient.seed) || 'pendiente';
      }, previousFrame),
    );
    await page.locator('#freeze').click();
    const torso = await page.evaluate(() => {
      const t = window.__vexusTest!.sim().scene.torso;
      return { ...t, profile: Array.from(t.profile!) };
    });
    const t: Torso = { ...torso, profile: Float32Array.from(torso.profile) };
    const points: number[] = [];
    for (const z of [-150, -100, -25, 25])
      for (let angle = 0; angle < 32; angle++) {
        const skin = torsoSkinPoint((2 * Math.PI * (angle + 0.17)) / 32, z, t);
        const n = torsoNormal(skin, t);
        const w = wallDepths(t, wallArc(skin, t), z);
        for (const fraction of [0.25, 0.5, 0.75]) {
          const depth = w.fascia + fraction * (w.transversalis - w.fascia);
          const p = skin.map((v, i) => v - depth * n[i]) as Vec3;
          points.push(...p);
        }
      }
    const muscleCount = points.length / 3;
    for (let face = FIRST_WALL_INTERFACE; face <= LAST_WALL_INTERFACE; face++)
      for (const z of [-150, -125, -100, -75, -25, 25]) points.push(face, -t.b + (t.y0 ?? 0), z);
    const result = await page.evaluate(
      ({ source, points, schema, muscleCount }) => {
        const sim = window.__vexusTest!.sim(),
          r = sim.renderer,
          gl = r.gl;
        const body: unknown = Reflect.get(r, 'bodyTex');
        if (!(body instanceof WebGLTexture)) throw new Error('Acquired body coefficient texture unavailable');
        const values = Reflect.get(r, 'sceneValues') as Array<{ spec: { name: string; type: string }; data: Float32Array }>;
        if (values?.length !== schema.length) throw new Error('Acquired anatomy uniform schema differs');
        const previous = {
          program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
          framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
          viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
          active: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
          blend: gl.isEnabled(gl.BLEND),
        };
        const shaders: WebGLShader[] = [],
          textures: WebGLTexture[] = [],
          bindings: Array<WebGLTexture | null> = [];
        const program = gl.createProgram(),
          fb = gl.createFramebuffer();
        const compile = (kind: number, text: string) => {
          const shader = gl.createShader(kind)!;
          shaders.push(shader);
          gl.shaderSource(shader, text);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
          gl.attachShader(program, shader);
        };
        for (const unit of [0, 5, 6]) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          bindings.push(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null);
        }
        try {
          compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){gl_Position=vec4(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0,0,1);}');
          compile(gl.FRAGMENT_SHADER, source);
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
          gl.useProgram(program);
          for (const [index, { spec: shipped, data }] of values.entries()) {
            // El build compacta nombres; el esquema único conserva orden y tipo.
            const spec = schema[index];
            if (shipped.type !== spec.type) throw new Error('Acquired uniform type differs');
            const loc = gl.getUniformLocation(program, spec.name);
            if (loc === null) continue;
            if (spec.type === 'int') gl.uniform1iv(loc, Int32Array.from(data));
            else if (spec.type === 'float') gl.uniform1fv(loc, data);
            else if (spec.type === 'vec2') gl.uniform2fv(loc, data);
            else if (spec.type === 'vec3') gl.uniform3fv(loc, data);
            else if (spec.type === 'vec4') gl.uniform4fv(loc, data);
            else throw new Error('Unhandled scene uniform ' + spec.name);
          }
          const count = points.length / 3,
            packed = new Float32Array(count * 4);
          for (let i = 0; i < count; i++) packed.set(points.slice(3 * i, 3 * i + 3), 4 * i);
          const texture = (unit: number, data: Float32Array | null) => {
            const tex = gl.createTexture();
            textures.push(tex);
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count, 1, 0, gl.RGBA, gl.FLOAT, data);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            return tex;
          };
          texture(0, packed);
          gl.uniform1i(gl.getUniformLocation(program, 'uPoints'), 0);
          gl.uniform1i(gl.getUniformLocation(program, 'uMuscleCount'), muscleCount);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, body);
          gl.uniform1i(gl.getUniformLocation(program, 'uBodyCoefficients'), 5);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture(6, null), 0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer unavailable');
          gl.disable(gl.BLEND);
          gl.viewport(0, 0, count, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const output = new Float32Array(count * 4);
          gl.readPixels(0, 0, count, 1, gl.RGBA, gl.FLOAT, output);
          const rows = [],
            faces = [];
          for (let i = 0; i < count; i++) {
            const row = [...Array.from(output.slice(4 * i, 4 * i + 4)), ...points.slice(3 * i, 3 * i + 3)];
            if (i >= muscleCount) faces.push(row);
            else if (output[4 * i + 1] > 0.1 && output[4 * i + 1] < 0.8) rows.push(row);
          }
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Muscle phase query generated a WebGL error');
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            caseId: sim.patient.id,
            rows,
            faces,
            renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
          };
        } finally {
          for (const [i, unit] of [0, 5, 6].entries()) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, bindings[i] ?? null);
          }
          if (previous.blend) gl.enable(gl.BLEND);
          gl.activeTexture(previous.active);
          gl.useProgram(previous.program);
          gl.bindFramebuffer(gl.FRAMEBUFFER, previous.framebuffer);
          gl.viewport(previous.viewport[0], previous.viewport[1], previous.viewport[2], previous.viewport[3]);
          textures.forEach((t) => gl.deleteTexture(t));
          shaders.forEach((s) => gl.deleteShader(s));
          gl.deleteFramebuffer(fb);
          gl.deleteProgram(program);
        }
      },
      { source, points, muscleCount, schema: SCENE_UNIFORMS.map(({ name, type }) => ({ name, type })) },
    );
    await info.attach('muscle-normal-width-gradient', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.caseId).toBe(caseId);
    expect(result.rows.length).toBeGreaterThan(40);
    // Diferencias centrales de 2 micras en float32: alineación <5,8° y normal unitaria.
    for (const [dot, weight, widthError, length] of result.rows) {
      expect(weight).toBeGreaterThan(0.1);
      expect(widthError).toBeLessThan(0.01);
      expect(length).toBeCloseTo(1, 5);
      expect(dot).toBeGreaterThan(0.995);
    }
    expect(result.faces).toHaveLength(6 * (LAST_WALL_INTERFACE - FIRST_WALL_INTERFACE + 1));
    for (const [left, right, logJump] of result.faces) {
      expect(left).toBeGreaterThan(0);
      expect(right).toBeGreaterThan(0);
      // 4 micras: límite numérico/espacial, ~0,043 dB; el defecto anterior supera20dB.
      expect(logJump).toBeLessThan(0.005);
    }
  });
