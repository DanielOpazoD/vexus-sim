import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Vec3 } from '../src/core/vec3';
import { interfaceEchoGlsl } from '../src/ultrasound/interfaceEcho';

interface QuadratureCase {
  id: string;
  model: string;
  sigmaLatMm: number;
  sigmaElevMm: number;
  kRadPerMm: number;
  kappaPerMm: number;
  circLat: number;
  circElev: number;
  quadratureComplex: [number, number];
}

interface KernelInput {
  normal: Vec3;
  direction: Vec3;
  elevation: Vec3;
  tangent: Vec3;
  kappa: number;
  sigmaLat: number;
  sigmaElevOneWay: number;
  k: number;
}

interface KernelFixture {
  id: string;
  original: KernelInput;
  uploaded: KernelInput;
  expected: number;
}

interface KernelProgram {
  name: 'direct' | 'cached' | 'historical';
  source: string;
  bodySha256: string;
}

interface KernelRow {
  program: KernelProgram['name'];
  id: string;
  actual: number;
  word: number;
  expected: number;
  absoluteError: number;
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// Same numeric contract as facetCompression: F32 upload/normalization included, not the CPU integral tolerance or anatomy.
const gpuTolerance = 3e-6;

function uploaded(input: KernelInput): KernelInput {
  const vector = (v: Vec3): Vec3 => [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])];
  return {
    normal: vector(input.normal),
    direction: vector(input.direction),
    elevation: vector(input.elevation),
    tangent: vector(input.tangent),
    kappa: Math.fround(input.kappa),
    sigmaLat: Math.fround(input.sigmaLat),
    sigmaElevOneWay: Math.fround(input.sigmaElevOneWay),
    k: Math.fround(input.k),
  };
}

/** Preserve the generated function, without matching its algebra or internal variable names. */
function tubeBody(source: string): string {
  const matches = [...source.matchAll(/float\s+tubeCurvature\s*\([^)]*\)\s*\{/g)];
  if (matches.length !== 1) throw new Error(`Expected one tubeCurvature function, found ${matches.length}`);
  const start = matches[0].index,
    open = source.indexOf('{', start);
  const lexical = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
  let depth = 1,
    end = open + 1;
  for (; end < lexical.length && depth; end++) {
    if (lexical[end] === '{') depth++;
    else if (lexical[end] === '}') depth--;
  }
  if (depth) throw new Error('Unbalanced generated GLSL');
  return source.slice(start, end);
}

function program(name: KernelProgram['name'], body: string): KernelProgram {
  return {
    name,
    bodySha256: sha256(body),
    source: `#version 300 es
precision highp float; precision highp int;
struct Cls {vec3 tangent; float kc;};
uniform vec3 uN,uDir,uElev,uTangent;
uniform float uKappa,uSigmaLat,uSigmaElevOneWay,uIfaceK0;
out vec4 color;
// Boundary adapters only: the production cylindrical operator remains unmodified.
float lateralSigmaMm(float r){return uSigmaLat;}
float echoFrequency(float r){return 1.0;}
${body}
void main(){Cls c;c.tangent=uTangent;c.kc=uKappa;
uint bits=floatBitsToUint(tubeCurvature(c,uN,uDir,90.0,uSigmaElevOneWay));
color=vec4(float(bits&255u),float((bits>>8)&255u),float((bits>>16)&255u),float((bits>>24)&255u))/255.0;}`,
  };
}

/** Owned 1px context and IEEE word readback, following facetCompression.spec.ts; no scene/bootstrap. */
function runKernel(payload: { fixtures: KernelFixture[]; programs: KernelProgram[] }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = {
    renderer: String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    rows: [] as KernelRow[],
    activeUniforms: {} as Record<string, Array<{ name: string; type: number; size: number }>>,
    failure: null as string | null,
    cleanupError: 0,
    resources: { programsCreated: 0, programsDeleted: 0, shadersCreated: 0, shadersDeleted: 0, vaosCreated: 0, vaosDeleted: 0 },
  };
  const shaders: WebGLShader[] = [],
    programs: WebGLProgram[] = [];
  let vao: WebGLVertexArrayObject | null = null;
  try {
    vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray');
    report.resources.vaosCreated++;
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, 1, 1);
    for (const flag of [gl.DITHER, gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST]) gl.disable(flag);
    const compile = (p: WebGLProgram, type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('createShader');
      shaders.push(shader);
      report.resources.shadersCreated++;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Compile failed');
      gl.attachShader(p, shader);
    };
    for (const variant of payload.programs) {
      const p = gl.createProgram();
      if (!p) throw new Error('createProgram');
      programs.push(p);
      report.resources.programsCreated++;
      compile(
        p,
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}',
      );
      compile(p, gl.FRAGMENT_SHADER, variant.source);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Link failed');
      gl.useProgram(p);
      report.activeUniforms[variant.name] = Array.from({ length: gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number }, (_, i) => {
        const u = gl.getActiveUniform(p, i)!;
        return { name: u.name, type: u.type, size: u.size };
      });
      for (const fixture of payload.fixtures) {
        const u = fixture.uploaded;
        const vectors: Record<string, Vec3> = { uN: u.normal, uDir: u.direction, uElev: u.elevation, uTangent: u.tangent };
        const scalars: Record<string, number> = {
          uKappa: u.kappa,
          uSigmaLat: u.sigmaLat,
          uSigmaElevOneWay: u.sigmaElevOneWay,
          uIfaceK0: u.k,
        };
        for (const [name, value] of Object.entries(vectors)) gl.uniform3fv(gl.getUniformLocation(p, name), value);
        for (const [name, value] of Object.entries(scalars)) gl.uniform1f(gl.getUniformLocation(p, name), value);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const bytes = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        const error = gl.getError();
        if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`Kernel draw/read error ${error}`);
        const bits = new DataView(bytes.buffer),
          actual = bits.getFloat32(0, true);
        report.rows.push({
          program: variant.name,
          id: fixture.id,
          actual,
          word: bits.getUint32(0, true),
          expected: fixture.expected,
          absoluteError: Math.abs(actual - fixture.expected),
        });
      }
    }
  } catch (error) {
    report.failure = String(error);
  } finally {
    gl.useProgram(null);
    gl.bindVertexArray(null);
    for (const shader of shaders) {
      gl.deleteShader(shader);
      report.resources.shadersDeleted++;
    }
    for (const p of programs) {
      gl.deleteProgram(p);
      report.resources.programsDeleted++;
    }
    if (vao) {
      gl.deleteVertexArray(vao);
      report.resources.vaosDeleted++;
    }
    report.cleanupError = gl.getError();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return report;
}

test('cylindrical GLSL matches independent quadrature and rejects the historical projected product', async ({ page }, info) => {
  const fixtureBytes = readFileSync(new URL('../src/validation/fixtures/cylindricalCurvature.json', import.meta.url));
  const quadrature = JSON.parse(fixtureBytes.toString()) as { cases: QuadratureCase[]; provenance: Record<string, unknown> };
  const cylinders = quadrature.cases.filter((row) => row.model === 'rank-one-cylinder');
  expect(cylinders).toHaveLength(19);
  const fixtures: KernelFixture[] = cylinders.map((row) => {
    const input: KernelInput = {
      normal: [0, 0, 1],
      direction: [0, 0, 1],
      elevation: [0, 1, 0],
      tangent: [row.circElev, -row.circLat, 0],
      kappa: row.kappaPerMm,
      sigmaLat: row.sigmaLatMm,
      sigmaElevOneWay: row.sigmaElevMm * Math.SQRT2,
      k: row.kRadPerMm,
    };
    return { id: row.id, original: input, uploaded: uploaded(input), expected: Math.hypot(...row.quadratureComplex) };
  });
  const lateral = fixtures.find((row) => row.id === 'isotropic/kappa=1/angle=0');
  if (!lateral) throw new Error('Missing fixed degeneracy reference');
  const degenerate: Array<{ id: string; tangent: Vec3; expected: number }> = [
    { id: 'axis-parallel', tangent: [0, 0, 1], expected: 1 },
    { id: 'axis-below-branch', tangent: [0, -0.00005, 1], expected: 1 },
    { id: 'axis-above-branch', tangent: [0, -0.0002, 1], expected: lateral.expected },
  ];
  for (const row of degenerate) {
    const input = { ...lateral.original, tangent: row.tangent };
    fixtures.push({ id: row.id, original: input, uploaded: uploaded(input), expected: row.expected });
  }
  const historicalBytes = readFileSync(new URL('./fixtures/historicalTubeCurvature.glsl', import.meta.url));
  const programs = [
    program('direct', tubeBody(interfaceEchoGlsl(false))),
    program('cached', tubeBody(interfaceEchoGlsl(true))),
    program('historical', tubeBody(historicalBytes.toString())),
  ];
  await info.attach('cylindrical-kernel-inputs.json', {
    body: JSON.stringify(
      {
        scope: 'Normal incidence and identity deformation; scalar beam adapters, not scene or consumer validation.',
        tolerance: gpuTolerance,
        provenance: quadrature.provenance,
        fixtureSha256: sha256(fixtureBytes),
        historicalSha256: sha256(historicalBytes),
        fixtures,
        programs,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  const result = await page.evaluate(runKernel, { fixtures, programs });
  await info.attach('cylindrical-kernel-results.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.failure).toBeNull();
  expect(result.cleanupError).toBe(0);
  expect(result.resources).toEqual({
    programsCreated: 3,
    programsDeleted: 3,
    shadersCreated: 6,
    shadersDeleted: 6,
    vaosCreated: 1,
    vaosDeleted: 1,
  });
  expect(result.rows).toHaveLength(66);
  expect(result.rows.filter((row) => row.program !== 'historical')).toHaveLength(44);
  for (const row of result.rows) {
    const tag = `${row.program}/${row.id}`;
    expect(Number.isFinite(row.actual), tag).toBe(true);
    expect(row.actual, tag).toBeGreaterThan(0);
    if (row.program !== 'historical') expect(row.absoluteError, tag).toBeLessThanOrEqual(gpuTolerance);
  }
  const negative = result.rows.find((row) => row.program === 'historical' && row.id === 'isotropic/kappa=1/angle=45');
  if (!negative) throw new Error('Historical negative was not executed');
  expect(negative.absoluteError).toBeGreaterThan(gpuTolerance);
});
