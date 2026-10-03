/** Offline CPU/WebGL2 contract against independent CGAL answers. No renderer integration. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { buildMeshField, queryMeshField } from '../anatomy/meshField';
import { MESH_FIELD_QUERY_GLSL } from '../anatomy/meshField.glsl';

const out = process.env.MESH_FIELD_OUT ?? '/tmp/vexus-mesh-field-evidence';
mkdirSync(out, { recursive: true });
const compressed = readFileSync('tools/anatomy/fixtures/diaphragm-field.json.gz');
const fixtureSha256 = createHash('sha256').update(compressed).digest('hex');
if (fixtureSha256 !== '6b3d7fa6f679b72f32bef219f3bf8a506ce3bdef1846ad01b57f8308eba73298') throw new Error('Fixture hash mismatch');
const data = JSON.parse(gunzipSync(compressed).toString()) as {
  positions: number[];
  triangles: number[];
  points: number[];
  signedDistanceMm: number[];
  oracleNormals: number[][];
  pointCount: number;
  sourceSha256: string;
  repairedCandidateSha256: string;
};
const start = performance.now();
const mesh = buildMeshField(data.positions, data.triangles);
const buildMs = performance.now() - start;
let cpuMaxErrorMm = 0;
for (let i = 0; i < data.pointCount; i++) {
  const p = data.points.slice(3 * i, 3 * i + 3) as [number, number, number];
  cpuMaxErrorMm = Math.max(cpuMaxErrorMm, Math.abs(queryMeshField(mesh, p).distance - data.signedDistanceMm[i]));
}
if (cpuMaxErrorMm > 1e-6) throw new Error(`CPU oracle mismatch: ${cpuMaxErrorMm}`);
const points = new Float32Array(data.pointCount * 4);
for (let i = 0; i < data.pointCount; i++) points.set(data.points.slice(i * 3, i * 3 + 3), i * 4);
const encode = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    ({ buffers, fragment, count, nodeCount }) => {
      const width = 256,
        height = Math.ceil(count / width);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext('webgl2', { antialias: false });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 target unavailable');
      const compile = (kind: number, source: string) => {
        const s = gl.createShader(kind)!;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compile failed');
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          `#version 300 es
      void main() { vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0,1); }`,
        ),
      );
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
      gl.useProgram(program);
      gl.bindVertexArray(gl.createVertexArray());
      const texture = (h: number, values: Float32Array | null) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, h, 0, gl.RGBA, gl.FLOAT, values);
        return t;
      };
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      for (let i = 0; i < 2; i++) {
        const target = texture(height, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, target, 0);
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
      const names = ['uVertices', 'uFaces', 'uAdjacent', 'uNodes', 'uPoints'];
      buffers.forEach((encoded, i) => {
        const binary = atob(encoded),
          bytes = new Uint8Array(binary.length);
        for (let k = 0; k < binary.length; k++) bytes[k] = binary.charCodeAt(k);
        const values = new Float32Array(bytes.buffer),
          h = Math.ceil(values.length / (width * 4));
        const padded = new Float32Array(width * h * 4);
        padded.set(values);
        gl.activeTexture(gl.TEXTURE0 + i);
        texture(h, padded);
        gl.uniform1i(gl.getUniformLocation(program, names[i]), i);
      });
      gl.uniform1i(gl.getUniformLocation(program, 'uWidth'), width);
      gl.uniform1i(gl.getUniformLocation(program, 'uPointCount'), count);
      gl.uniform1i(gl.getUniformLocation(program, 'uNodeCount'), nodeCount);
      gl.viewport(0, 0, width, height);
      const fields = new Float32Array(width * height * 4),
        diagnostics = new Float32Array(fields.length);
      const batchMs: number[] = [];
      for (let i = 0; i < 4; i++) {
        const t = performance.now();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();
        if (i) batchMs.push(performance.now() - t);
      }
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, fields);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, diagnostics);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        fields: Array.from(fields.slice(0, count * 4)),
        diagnostics: Array.from(diagnostics.slice(0, count * 4)),
        batchMs,
        renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      };
    },
    {
      buffers: [mesh.vertices, mesh.faces, mesh.adjacent, mesh.nodes, points].map(encode),
      fragment: MESH_FIELD_QUERY_GLSL,
      count: data.pointCount,
      nodeCount: mesh.nodes.length / 8,
    },
  );
  let maxErrorMm = 0,
    minNormalDot = 1,
    failedCount = 0;
  const failures: object[] = [];
  for (let i = 0; i < data.pointCount; i++) {
    const actual = result.fields[i * 4],
      expected = data.signedDistanceMm[i];
    const error = Math.abs(actual - expected),
      status = result.diagnostics[i * 4 + 2];
    const normal = result.fields.slice(i * 4 + 1, i * 4 + 4);
    const dot = normal.reduce((s, x, a) => s + x * data.oracleNormals[i][a], 0);
    maxErrorMm = Math.max(maxErrorMm, error);
    if (Math.abs(expected) > 0.05) minNormalDot = Math.min(minNormalDot, dot);
    const bad =
      ![actual, ...normal, status].every(Number.isFinite) ||
      status !== 0 ||
      error >= 0.01 ||
      (Math.abs(expected) > 0.001 && Math.sign(actual) !== Math.sign(expected)) ||
      (Math.abs(expected) > 0.05 && dot <= 0.99);
    if (bad) {
      failedCount++;
      if (failures.length < 30) failures.push({ i, actual, expected, error, dot, status, point: data.points.slice(i * 3, i * 3 + 3) });
    }
  }
  const report = {
    candidateSha: process.env.CANDIDATE_SHA ?? null,
    fixtureSha256,
    sourceSha256: data.sourceSha256,
    repairedCandidateSha256: data.repairedCandidateSha256,
    runtimeIntegration: false,
    pointCount: data.pointCount,
    buildMs,
    cpuMaxErrorMm,
    maxErrorMm,
    minNormalDot,
    failedCount,
    failures,
    renderer: result.renderer,
    queryBatchMs: result.batchMs,
    bvhNodes: mesh.nodes.length / 8,
    bvhDepth: mesh.maxDepth,
    bufferBytes: [mesh.vertices, mesh.faces, mesh.adjacent, mesh.nodes].reduce((s, a) => s + a.byteLength, 0),
    gates: { distanceMm: 0.01, signOutsideBoundaryMm: 0.001, normalOutsideBoundaryMm: 0.05, normalDot: 0.99 },
  };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failedCount) throw new Error(`${failedCount} GPU queries disagree with CGAL`);
} catch (error) {
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify({ candidateSha: process.env.CANDIDATE_SHA ?? null, fixtureSha256, error: String(error) }, null, 2) + '\n',
  );
  throw error;
} finally {
  await browser.close();
}
