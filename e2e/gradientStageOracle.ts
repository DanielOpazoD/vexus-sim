import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { anatomyGlsl } from '../src/anatomy/gpu/anatomy.glsl';
import { SCENE_UNIFORMS } from '../src/anatomy/gpu/sceneUniforms';
import { Interface, INTERFACE_COUNT, FACE_GRADIENT_EPS_MM } from '../src/anatomy/interfaces';
import { Tissue, TISSUE_COUNT } from '../src/anatomy/tissues';
import { interfaceEchoGlsl } from '../src/ultrasound/interfaceEcho';
import { specializeAbdominalShader } from '../src/ultrasound/sceneShader';
import { FRAG_RAWFIELD_GRADIENT, FRAG_RAWFIELD_GRADIENT_STEERED, VERT } from '../src/ultrasound/shaders/passes.glsl';
import { readSources } from '../tools/build/glslMinify';
import { bindingNames, compactBindings } from '../tools/build/glslUniformNames';
import type { GLProgram } from '../src/ultrasound/gl';
import type { FrameInputs } from '../src/ultrasound/renderer';

/** Brace extraction preserves production text, including both bodies in the steered generator. */
function block(source: string, declaration: RegExp): { text: string; body: string } {
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${declaration}, got ${matches.length}`);
  const start = matches[0].index,
    open = source.indexOf('{', start);
  const lexical = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
  let depth = 1,
    end = open + 1;
  for (; end < lexical.length && depth; end++) {
    if (lexical[end] === '{') depth++;
    else if (lexical[end] === '}') depth--;
  }
  if (depth) throw new Error('Unbalanced production GLSL');
  return { text: source.slice(start, end), body: source.slice(open + 1, end - 1) };
}

const REFERENCE_SHA = 'd3bdfceca20f61bfc7a57068170a9e429430bf19';
// Literal stage body verified against passes.glsl.ts at REFERENCE_SHA; no geometry formula is copied.
const referenceBody = `
    oGradient = faceGradient(rawClass(), toMaterial(p));
    spec = 0.0;
    return vec2(0.0);`;

export function gradientOraclePayload(root = process.cwd()) {
  const names = bindingNames(
    readSources(join(root, 'src'))
      .map((source) => source.code)
      .join('\n'),
  );
  const anatomy = anatomyGlsl(true);
  const raw = block(FRAG_RAWFIELD_GRADIENT, /Cls\s+rawClass\s*\([^)]*\)\s*\{/g).text;
  const base = block(FRAG_RAWFIELD_GRADIENT, /vec2\s+mediumField\s*\([^)]*\)\s*\{/g);
  const steered = block(FRAG_RAWFIELD_GRADIENT_STEERED, /vec2\s+mediumField\s*\([^)]*\)\s*\{/g);
  const phased = block(FRAG_RAWFIELD_GRADIENT_STEERED, /vec2\s+mediumFieldPh\s*\([^)]*\)\s*\{/g);
  const cached = block(interfaceEchoGlsl(true), /vec4\s+cachedFaceGradient\s*\([^)]*\)\s*\{/g).text;
  const cls = block(anatomy, /struct\s+Cls\s*\{/g).text + ';';
  const header = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  const classes = 'uniform highp sampler2D uRawClass0, uRawClass1, uRawClass2;\n' + raw;
  const functions: Record<string, { text: string; call: string }> = {
    reference: {
      text: `vec2 mediumField(vec3 p, vec3 dir, float r, float se, bool withCurtain, out float spec) {${referenceBody}\n}`,
      call: 'mediumField(p,vec3(0,1,0),1.0,1.0,false,spec)',
    },
    look0: { text: base.text, call: 'mediumField(p,vec3(0,1,0),1.0,1.0,false,spec)' },
    steered: { text: steered.text, call: 'mediumField(p,vec3(0,1,0),1.0,1.0,false,spec)' },
    phased: { text: phased.text, call: 'mediumFieldPh(p,vec3(0,1,0),1.0,1.0,false,0.0,vec3(0),spec)' },
  };
  const fragments: Record<string, string> = {};
  for (const [name, fn] of Object.entries(functions)) {
    const source = `${header}${anatomy}\n${classes}
uniform highp sampler2D uOraclePoints;
uniform int uOracleMutation;
layout(location=0) out vec4 oGradient;
${fn.text}
void main() {
  int x=int(gl_FragCoord.x)%textureSize(uOraclePoints,0).x;
  vec3 p=texelFetch(uOraclePoints,ivec2(x,0),0).xyz;
  float spec; ${fn.call};
  // Fault injection only after the actual generated producer has run.
  Cls c=rawClass();
  if (uOracleMutation == 1 && uGradientAxis == 0) oGradient=vec4(0);
  if (uOracleMutation >= 2) {
    int branch=(uOracleMutation-2)/2;
    int axis=1+(uOracleMutation-2)%2;
    bool hit=(branch==0 && c.iface==IF_VERTEBRAL_CORTEX) ||
      (branch==1 && c.iface!=IF_VERTEBRAL_CORTEX && c.tissue==T_CAPSULE) ||
      (branch==2 && c.iface!=IF_VERTEBRAL_CORTEX && c.tissue!=T_CAPSULE &&
       c.tissue==T_DIAPHRAGM && c.iface!=IF_PERIRENAL && c.iface!=IF_RENAL_FASCIA && c.iface!=IF_RENAL_CAPSULE);
    if(hit && uGradientAxis==axis) oGradient=vec4(0);
  }
}`;
    fragments[name] = compactBindings(specializeAbdominalShader(source, true), names);
  }
  fragments.consumer = compactBindings(
    `${header}${cls}\n#define FACE_GRAD_EPS ${FACE_GRADIENT_EPS_MM.toFixed(3)}\n${classes}
uniform highp sampler2D uRawGradient;
${cached}
layout(location=0) out vec4 consumed;
void main(){consumed=cachedFaceGradient(rawClass());}`,
    names,
  );
  return {
    fragments,
    vert: VERT,
    schema: SCENE_UNIFORMS.map(({ name, type }) => ({ name: compactBindings(name, names), type })),
    bindings: Object.fromEntries(
      ['uGradientAxis', 'uRawClass0', 'uRawClass1', 'uRawClass2', 'uRawGradient'].map((name) => [name, compactBindings(name, names)]),
    ),
    ids: {
      tissues: TISSUE_COUNT,
      interfaces: INTERFACE_COUNT,
      cortex: Number(Interface.VertebralCortex),
      capsule: Number(Tissue.LiverCapsule),
      diaphragm: Number(Tissue.Diaphragm),
      renal: [Interface.PerirenalFat, Interface.RenalFascia, Interface.RenalCapsule].map(Number),
    },
    provenance: {
      referenceSha: REFERENCE_SHA,
      referenceBody,
      bodies: { look0: base.body, steered: steered.body, phased: phased.body },
      hashes: Object.fromEntries(
        Object.entries(fragments).map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')]),
      ),
    },
  };
}

export type GradientOraclePayload = ReturnType<typeof gradientOraclePayload>;

/** Runs in the acquired app context, with production GLProgram/scene bindings and no new WebGL context. */
export function runGradientOracle(payload: GradientOraclePayload) {
  const s = window.__vexusTest!.sim(),
    r = s.renderer,
    gl = r.gl;
  if (!s.frozen || !r.displayedAnatomy) throw new Error('Oracle requires a frozen acquired frame');
  if (gl.getError() !== gl.NO_ERROR) throw new Error('Pre-existing WebGL error before oracle');
  const anatomy = r.displayedAnatomy;
  const values = Reflect.get(r, 'sceneValues') as Array<{ spec: { name: string; type: string }; data: Float32Array }>;
  if (
    values.length !== payload.schema.length ||
    values.some(({ spec }, i) => spec.name !== payload.schema[i].name || spec.type !== payload.schema[i].type)
  )
    throw new Error('Host/build scene bindings differ; refusing zero/unbound anatomy');
  const setScene = Reflect.get(r, 'setSceneUniforms') as (p: GLProgram, inputs: FrameInputs) => void;
  const setBeam = Reflect.get(r, 'setBeamUniforms') as (p: GLProgram, inputs: FrameInputs) => void;
  // pRaw exists on both native/direct and SwiftShader/staged acquisition paths.
  const rawPrograms = Reflect.get(r, 'pRaw') as { look0: GLProgram };
  const Programs = rawPrograms.look0.constructor as typeof GLProgram;
  const inputs: FrameInputs = {
    ...anatomy,
    caliber: s.anatomy.caliberFor(anatomy.sample),
    probeVelocity: [0, 0, 0],
    bmode: { ...s.displayed.bmode },
    color: { ...s.displayed.color },
    updateColor: false,
  };
  const prior = {
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    active: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    blend: gl.isEnabled(gl.BLEND),
    scissor: gl.isEnabled(gl.SCISSOR_TEST),
    dither: gl.isEnabled(gl.DITHER),
    mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
  };
  const bindings: Array<[WebGLTexture | null, WebGLTexture | null]> = [];
  const textures: WebGLTexture[] = [],
    programs: GLProgram[] = [];
  let fb: WebGLFramebuffer | null = null;
  try {
    for (let unit = 0; unit < 16; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      bindings.push([
        gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
        gl.getParameter(gl.TEXTURE_BINDING_3D) as WebGLTexture | null,
      ]);
    }
    fb = gl.createFramebuffer();
    if (!fb) throw new Error('Oracle framebuffer allocation failed');
    type Fixture = { tissue: number; iface: number; point: number[]; normal: number[]; group: string };
    const fixtures: Fixture[] = [];
    const add = (tissue: number, iface: number, point: number[], group: string, normal = [0.3, 0.5, 0.7]) =>
      fixtures.push({ tissue, iface, point, normal, group });
    const ids = payload.ids;
    // Contract cross-product includes contradictory identifiers to exercise branch priority.
    for (let tissue = 0; tissue < ids.tissues; tissue++)
      for (let iface = 0; iface < ids.interfaces; iface++) add(tissue, iface, [-71.3, -19.7, -81.1], `class-${tissue}-${iface}`);
    // Predeclared geometry-relative candidates; no tuning from oracle outputs.
    for (const x of [-0.8, -0.4, 0.4, 0.8])
      for (const y of [-0.7, 0.3, 0.7])
        for (const z of [-0.6, -0.2, 0.3, 0.7]) {
          add(
            ids.capsule,
            0,
            s.scene.liver.center.map((v, i) => v + s.scene.liver.radii[i] * [x, y, z][i]),
            'capsule',
          );
          add(
            0,
            ids.cortex,
            [s.scene.spine.x0 + x * s.scene.spine.r, s.scene.spine.y0 + y * s.scene.spine.r, -150 + 150 * (z + 0.6)],
            'cortex',
          );
          const d = s.scene.diaphragm.right;
          add(ids.diaphragm, 0, [d.x0 + x * d.rx, d.y0 + y * d.ry, d.apex + 30 * z], 'diaphragm');
        }
    const count = fixtures.length;
    if (3 * count > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Oracle exceeds native texture width');
    const a = new Float32Array(count * 4),
      b = new Float32Array(count * 4),
      d = new Float32Array(count * 4),
      points = new Float32Array(count * 4);
    fixtures.forEach((f, i) => {
      a.set([f.tissue, 1, f.iface, 0], 4 * i);
      b.set([...f.normal, 0], 4 * i);
      d.set([0, 0, 1, 0], 4 * i);
      points.set([...f.point, 1], 4 * i);
    });
    const texture = (width: number, data: Float32Array | null) => {
      const t = gl.createTexture();
      if (!t) throw new Error('Oracle texture allocation failed');
      textures.push(t);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const target = (t: WebGLTexture) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Oracle RGBA32F target incomplete');
    };
    const read = (width: number) => {
      const data = new Float32Array(width * 4);
      gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, data);
      return data;
    };
    const same = (a: Float32Array, b: Float32Array) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
        y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
    const assert = (ok: boolean, message: string) => {
      if (!ok) throw new Error(message);
    };
    const p = Programs.linkAll(gl, payload.vert, payload.fragments);
    programs.push(...Object.values(p));
    const classTextures = [texture(count, a), texture(count, b), texture(count, d)],
      pointTexture = texture(count, points);
    const gradient = texture(3 * count, null),
      output = texture(count, null);
    const bind = (program: GLProgram) => {
      program.use();
      setScene.call(r, program, inputs);
      setBeam.call(r, program, inputs);
      classTextures.forEach((t, i) => program.tex(payload.bindings[`uRawClass${i}`], 10 + i, t));
      program.tex('uOraclePoints', 14, pointTexture);
    };
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DITHER);
    gl.colorMask(true, true, true, true);
    const consume = () => {
      bind(p.consumer);
      p.consumer.tex(payload.bindings.uRawGradient, 13, gradient);
      target(output);
      gl.viewport(0, 0, count, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return read(count);
    };
    const uploadGradient = (data: Float32Array) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gradient);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 3 * count, 1, gl.RGBA, gl.FLOAT, data);
    };
    const produce = (name: string, mutation = 0) => {
      bind(p[name]);
      p[name].i('uOracleMutation', mutation);
      target(gradient);
      for (let axis = 0; axis < 3; axis++) {
        p[name].i(payload.bindings.uGradientAxis, axis);
        gl.viewport(axis * count, 0, count, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      return read(3 * count);
    };
    const referenceRaw = produce('reference'),
      reference = consume();
    assert(reference.every(Number.isFinite), 'Physical reference consumer contains NaN/Inf');
    const branch = (f: Fixture) =>
      f.iface === ids.cortex
        ? 'cortex'
        : f.tissue === ids.capsule
          ? 'capsule'
          : f.tissue === ids.diaphragm && !ids.renal.includes(f.iface)
            ? 'diaphragm'
            : 'complete';
    for (let i = 0; i < count; i++)
      for (let axis = 0; axis < 3; axis++) {
        const v = referenceRaw.subarray(4 * (axis * count + i), 4 * (axis * count + i + 1));
        assert(v.every(Number.isFinite), `Nonfinite physical producer ${i}/${axis}`);
        assert(branch(fixtures[i]) === 'complete' ? v[3] >= 0 : v[3] === -1, `Wrong reference branch marker ${i}/${axis}`);
      }
    const witnesses = Object.fromEntries(
      ['cortex', 'capsule', 'diaphragm'].map((group) => {
        const index = fixtures.findIndex(
          (f, i) => f.group === group && [0, 1, 2].every((axis) => Math.abs(referenceRaw[4 * (axis * count + i)]) > 1e-5),
        );
        assert(index >= 0, `No ${group} reference fixture has three nonzero axis differences`);
        return [group, { index, fixture: fixtures[index], delta: [0, 1, 2].map((axis) => referenceRaw[4 * (axis * count + index)]) }];
      }),
    );
    const variants: string[] = [],
      mutants: string[] = [];
    for (const name of ['look0', 'steered', 'phased']) {
      produce(name);
      assert(same(reference, consume()), `Consumed bytes differ for ${name}`);
      variants.push(name);
      for (let mutation = 1; mutation <= 7; mutation++) {
        produce(name, mutation);
        const broken = consume();
        const index = mutation === 1 ? 0 : witnesses[['cortex', 'capsule', 'diaphragm'][Math.floor((mutation - 2) / 2)]].index;
        assert(
          !same(reference.subarray(index * 4, index * 4 + 4), broken.subarray(index * 4, index * 4 + 4)),
          `${name} mutation ${mutation} survived at witness ${index}`,
        );
        mutants.push(`${name}/${mutation}`);
      }
    }
    // Complete vectors ignore auxiliary tiles; split vectors must consume them.
    const contaminated = new Float32Array(referenceRaw);
    contaminated.fill(123, 4 * count);
    uploadGradient(contaminated);
    const polluted = consume();
    for (let i = 0; i < count; i++)
      if (branch(fixtures[i]) === 'complete')
        assert(same(reference.subarray(i * 4, i * 4 + 4), polluted.subarray(i * 4, i * 4 + 4)), `Complete branch read auxiliary tile ${i}`);
    for (const witness of Object.values(witnesses))
      assert(
        !same(reference.subarray(witness.index * 4, witness.index * 4 + 4), polluted.subarray(witness.index * 4, witness.index * 4 + 4)),
        'Split consumer ignored auxiliary tiles',
      );
    // Nonfinite values are transferred as IEEE words below, never serialized as JSON floats.
    const special = new Float32Array(referenceRaw);
    const put = (row: number, axis: number, v: number[]) => special.set(v, 4 * (axis * count + row));
    put(0, 0, [0, 0, 0, -1]);
    put(0, 1, [0, 0, 0, -1]);
    put(0, 2, [0, 0, 0, -1]);
    put(1, 0, [0, 0, 0, NaN]);
    put(1, 1, [0.2, 0, 0, -1]);
    put(1, 2, [0.4, 0, 0, -1]);
    put(2, 0, [1, 2, 3, Infinity]);
    put(3, 0, [NaN, 0, 0, -1]);
    put(3, 1, [0.2, 0, 0, -1]);
    put(3, 2, [0.4, 0, 0, -1]);
    uploadGradient(special);
    const nonfinite = consume();
    const wordRows = Array.from({ length: 4 }, (_, i) => Array.from(new Uint32Array(nonfinite.buffer, i * 16, 4)));
    assert(same(nonfinite.subarray(0, 4), nonfinite.subarray(12, 16)), 'Zero/NaN gradient did not use the same finite normal fallback');
    assert(nonfinite.subarray(0, 4).every(Number.isFinite) && nonfinite[3] === 1, 'Zero gradient fallback is not finite/unit magnitude');
    assert(
      nonfinite.subarray(4, 8).every(Number.isFinite) && nonfinite[5] > 0 && nonfinite[6] > 0,
      'NaN marker must take the split path (not >=0)',
    );
    assert(
      nonfinite[8] === 1 && nonfinite[9] === 2 && nonfinite[10] === 3 && nonfinite[11] === Infinity,
      'Positive infinity marker must preserve complete vector',
    );
    assert(gl.getError() === gl.NO_ERROR, 'Oracle generated a WebGL error');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      fixtures: count,
      exhaustiveClasses: ids.tissues * ids.interfaces,
      variants,
      mutants,
      witnesses,
      consumerSpecialWords: wordRows,
      specialContract: ['zero fallback', 'NaN marker assembles', '+Inf marker passes through', 'NaN component fallback'],
      renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      frame: r.displayedFrame!.n,
      provenance: payload.provenance,
    };
  } finally {
    bindings.forEach(([two, three], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, two);
      gl.bindTexture(gl.TEXTURE_3D, three);
    });
    gl.activeTexture(prior.active);
    gl.useProgram(prior.program);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prior.draw);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prior.read);
    gl.viewport(prior.viewport[0], prior.viewport[1], prior.viewport[2], prior.viewport[3]);
    gl.colorMask(prior.mask[0], prior.mask[1], prior.mask[2], prior.mask[3]);
    for (const [cap, on] of [
      [gl.BLEND, prior.blend],
      [gl.SCISSOR_TEST, prior.scissor],
      [gl.DITHER, prior.dither],
    ] as const) {
      if (on) gl.enable(cap);
      else gl.disable(cap);
    }
    programs.forEach((p) => p.dispose());
    textures.forEach((t) => gl.deleteTexture(t));
    gl.deleteFramebuffer(fb);
  }
}
