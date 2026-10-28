/** Referencia sintética 3-D de desarrollo; comparación de componentes, no aceptación clínica. */
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { TISSUES, Tissue } from '../../src/anatomy/tissues';
import { elevSigmaMm } from '../../src/ultrasound/pleura';
import { CONVEX_C35_PROFILE } from '../../src/ultrasound/transducerProfile';
import { buildSource } from '../build/provenance';
import { evidencePath } from './externalEvidenceContract';
import { envelopeFwhm } from './independentPsf';

const protocolId = 'convex-c35-pymust-elevation-v1';
const sources = {
  'pfield.py': 'a999ae8ffa4934968ea01e8ab57136aadad6beafc4ceaddf48edd031e2c33576',
  'simus.py': '17f30a1d1677f8289c814d10afe4f57cc75964a80db692cb603c6260c8fe5fe0',
  'dasmtx.py': '7da9ffcabcc0efd488870bb4bf70e6a5f25268ec77fefde7ef235bb7b7f2748a',
};
const parameters = {
  frequencyMHz: 3.5,
  samplingFrequencyMHz: 28,
  soundSpeedMS: 1540,
  attenuationDbCmMHz: 0.601,
  pulseEchoBandwidthPercent: 45,
  curvatureRadiusMm: 60,
  activeChordMm: 26,
  elements: 65,
  elementFillFraction: 0.9,
  elevationHeightMm: 13,
  elevationFocusMm: 80,
  lateralTxFocusMm: 90,
  rxFNumber: 2.5,
  txCycles: 1,
  txApodization: 'Hann',
  rxApodization: 'uniform',
  sentinelYMm: 0.001,
  sentinelReflectivity: 0,
  parallel: false,
};
const fieldModel = { dimensionality: 3, elevationFocusing: true, selection: 'zero-reflectivity-offplane-sentinel' };
const registeredCases = [
  { id: 'near', depthMm: 60, spacingMm: 0.5, frequencyStep: 1 },
  { id: 'focal', depthMm: 80, spacingMm: 0.5, frequencyStep: 1 },
  { id: 'deep', depthMm: 150, spacingMm: 0.5, frequencyStep: 1 },
  { id: 'focal-spacing', depthMm: 80, spacingMm: 0.25, frequencyStep: 1 },
  { id: 'focal-frequency', depthMm: 80, spacingMm: 0.5, frequencyStep: 0.5 },
];
const registeredControls = {
  'zero-2d': { y_mm: 0, sentinel: null },
  'zero-3d': { y_mm: 0 },
  'offplane-alone': { y_mm: 0.5, sentinel: null },
  'offplane-sentinel': { y_mm: 0.5 },
  'sentinel-far': { y_mm: 0, sentinel: 0.001 },
  'limit-plus1': { y_mm: 0.001, sentinel: null },
  'limit-minus1': { y_mm: -0.001, sentinel: null },
  'limit-plus2': { y_mm: 0.002, sentinel: null },
  'limit-minus2': { y_mm: -0.002, sentinel: null },
  'focus50-2d': { y_mm: 0, focus: 50, sentinel: null },
  'focus50-3d': { y_mm: 0, focus: 50 },
  'height6-2d': { y_mm: 0, height: 6.5, sentinel: null },
  'height6-3d': { y_mm: 0, height: 6.5 },
};
type ControlId = keyof typeof registeredControls;
const controlPairs: { id: string; a: ControlId; b: ControlId }[] = [
  { id: 'sentinelOffplane', a: 'offplane-alone', b: 'offplane-sentinel' },
  { id: 'sentinelLocation', a: 'zero-3d', b: 'sentinel-far' },
  { id: 'focus2d', a: 'zero-2d', b: 'focus50-2d' },
  { id: 'focus3d', a: 'zero-3d', b: 'focus50-3d' },
  { id: 'height2d', a: 'zero-2d', b: 'height6-2d' },
  { id: 'height3d', a: 'zero-3d', b: 'height6-3d' },
  { id: 'limit-plus1', a: 'zero-3d', b: 'limit-plus1' },
  { id: 'limit-minus1', a: 'zero-3d', b: 'limit-minus1' },
  { id: 'limit-plus2', a: 'zero-3d', b: 'limit-plus2' },
  { id: 'limit-minus2', a: 'zero-3d', b: 'limit-minus2' },
];

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function list(value: unknown, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error('Invalid inventory or sample count');
  return value as unknown[];
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite number');
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid SHA256');
  return value;
}
function keys(value: Record<string, unknown>, expected: string[], at: string) {
  deepStrictEqual(Object.keys(value).sort(), [...expected].sort(), `${at}: inventory differs`);
}
// Solo redondeo entre NumPy y JS; no es una tolerancia ajustada al modelo físico.
function measuredEqual(reported: unknown, computed: number, at: string) {
  finite(computed);
  if (Math.abs(finite(reported) - computed) > 1e-12 * Math.max(1, Math.abs(computed)))
    throw new Error(`${at}: reported measurement differs`);
}
function rawDescriptor(value: unknown) {
  const raw = record(value);
  const path = evidencePath(raw.path);
  if (basename(path) !== path || !path.endsWith('.npz')) throw new Error('Invalid original path');
  return { path, sha256: hash(raw.sha256) };
}
function trace(value: unknown, focusing: boolean, points: number) {
  const t = record(value);
  if (t.elevationFocusing !== focusing || t.isSIMUS !== true || t.points !== points)
    throw new Error('Invalid 3-D/2-D branch witness or point count');
  const frequencyCount = finite(t.frequencyCount);
  const frequencyFirstHz = finite(t.frequencyFirstHz);
  const frequencyLastHz = finite(t.frequencyLastHz);
  if (
    !Number.isInteger(frequencyCount) ||
    frequencyCount < 2 ||
    frequencyCount > 1000000 ||
    frequencyFirstHz < 0 ||
    frequencyLastHz <= frequencyFirstHz ||
    frequencyLastHz > 14e6
  )
    throw new Error('Invalid frequency sampling witness');
  return {
    elevationFocusing: focusing,
    isSIMUS: true,
    points,
    frequency: { hash: hash(t.frequencyHash), count: frequencyCount, firstHz: frequencyFirstHz, lastHz: frequencyLastHz },
  };
}
function measure(value: unknown, reported: unknown, spacingMm: number) {
  const p = record(value);
  const count = 24 / spacingMm + 1;
  const positionMm = list(p.positionMm, count).map(finite);
  const envelope = list(p.envelope, count).map(finite);
  if (positionMm.some((position, index) => position !== -12 + index * spacingMm))
    throw new Error('Profile must span exactly -12 to +12 mm at registered spacing');
  const measured = envelopeFwhm(positionMm, envelope);
  const peak = Math.max(...envelope);
  const normalized = envelope.map((v) => v / peak);
  const symmetryRelativeRms = Math.hypot(...normalized.map((v, i) => v - normalized[count - 1 - i])) / Math.hypot(...normalized);
  if (measured.peakPositionMm !== 0 || symmetryRelativeRms > 1e-5) throw new Error('Asymmetric or displaced elevation response');
  const edgeFraction = Math.max(envelope[0], envelope[count - 1]) / peak;
  const result = { ...measured, symmetryRelativeRms, edgeFraction };
  const declared = record(reported);
  for (const [key, computed] of Object.entries(result)) measuredEqual(declared[key], computed, key);
  return result;
}

export function compareIndependentElevation(input: unknown) {
  const r = record(input);
  if (
    r.schemaVersion !== 1 ||
    r.protocolId !== protocolId ||
    r.origin !== 'synthetic' ||
    r.role !== 'development' ||
    r.method !== 'source-elevation-offset-fixed-transmit-and-receive-at-nominal-depth'
  )
    throw new Error('Unsupported independent elevation reference');
  deepStrictEqual(r.fieldModel, fieldModel, 'Elevation protocol requires the registered 3-D sentinel field model');
  deepStrictEqual(r.parameters, parameters, 'Reference acquisition/sentinel parameters differ');
  deepStrictEqual(r.engine, { name: 'PyMUST', version: '0.1.9', sources }, 'Unregistered engine sources');
  const profile = CONVEX_C35_PROFILE;
  const expectedProfile = {
    frequencyMHz: profile.geometry.f0B / 1e6,
    soundSpeedMS: (profile.beam.lambdaMm * profile.geometry.f0B) / 1000,
    attenuationDbCmMHz: TISSUES[Tissue.Liver].alpha1,
    pulseEchoBandwidthPercent: profile.bmode.echoBandwidth.fundamental * 100,
    curvatureRadiusMm: profile.geometry.curvatureRadius,
    activeChordMm: profile.beam.apertureRxMaxMm,
    elevationHeightMm: profile.geometry.elevationMm,
    elevationFocusMm: profile.geometry.elevationFocusMm,
    rxFNumber: profile.beam.fNumberRxMin,
  };
  const p = record(r.parameters);
  for (const [key, expected] of Object.entries(expectedProfile))
    if (Math.abs(finite(p[key]) - expected) > 1e-9) throw new Error(`Reference/profile mismatch: ${key}`);

  const controlRows = record(r.controls);
  keys(controlRows, Object.keys(registeredControls), 'Controls');
  const controls = Object.entries(registeredControls).map(([id, expected]) => {
    const c = record(controlRows[id]);
    deepStrictEqual(c.parameters, expected, `Control parameters differ: ${id}`);
    return {
      id,
      parameters: expected,
      trace: trace(c.trace, !id.endsWith('2d'), 'sentinel' in expected && expected.sentinel === null ? 1 : 2),
      raw: rawDescriptor(c.raw),
    };
  });
  const errors = record(r.controlErrors);
  keys(
    errors,
    controlPairs.map((pair) => pair.id),
    'Control errors',
  );
  const controlErrors = controlPairs.map(({ id, a, b }) => {
    const first = controls.find((c) => c.id === a);
    const second = controls.find((c) => c.id === b);
    if (!first || !second) throw new Error('Missing control pair');
    deepStrictEqual(first.trace.frequency, second.trace.frequency, `Paired frequency sampling differs: ${id}`);
    const error = record(errors[id]);
    const rf = finite(error.rf);
    const spectrum = finite(error.spectrum);
    const active = id === 'focus3d' || id === 'height3d';
    const limit = id.startsWith('limit-') ? 1e-4 : 1e-6;
    if ([rf, spectrum].some((value) => value < 0 || (active ? value <= 1e-3 : value > limit)))
      throw new Error(`Causal control failed in RF or spectrum: ${id}`);
    return { id, rf, spectrum };
  });

  const cases = list(r.cases, registeredCases.length).map((row, index) => {
    const c = record(row);
    const expected = registeredCases[index];
    if (c.id !== expected.id) throw new Error('Case inventory differs: unknown, duplicate or reordered case');
    for (const key of ['depthMm', 'spacingMm', 'frequencyStep'] as const)
      if (c[key] !== expected[key]) throw new Error(`Case geometry differs: ${expected.id}/${key}`);
    const measurement = measure(c.profile, c.measurement, expected.spacingMm);
    const traces = list(c.trace, 24 / expected.spacingMm + 1).map((t) => trace(t, true, 2));
    const referenceMm = measurement.widthMm;
    const sigmaMm = elevSigmaMm(expected.depthMm, profile.geometry.elevationFocusMm) / Math.SQRT2;
    const modelMm = 2 * Math.sqrt(2 * Math.log(2)) * sigmaMm;
    return {
      ...expected,
      raw: rawDescriptor(c.raw),
      measurement,
      trace: traces,
      elevationComparison: {
        referenceMm,
        modelMm,
        differenceMm: modelMm - referenceMm,
        relativeDifference: (modelMm - referenceMm) / referenceMm,
      },
    };
  });
  const paths = [...cases, ...controls].map((c) => c.raw.path);
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate original archive path');
  const convergence = {
    spacing: Math.abs(cases[3].measurement.widthMm - cases[1].measurement.widthMm) / cases[1].measurement.widthMm,
    frequency: Math.abs(cases[4].measurement.widthMm - cases[1].measurement.widthMm) / cases[1].measurement.widthMm,
  };
  const declaredConvergence = record(r.convergence);
  keys(declaredConvergence, ['spacing', 'frequency'], 'Convergence');
  for (const [key, fraction] of Object.entries(convergence)) {
    if (!Number.isFinite(fraction) || fraction > 0.01) throw new Error(`Convergence exceeds 1%: ${key}`);
    measuredEqual(declaredConvergence[key], fraction, `Convergence ${key}`);
  }
  return {
    protocolId,
    scope: 'independent-synthetic-elevation-component-comparison',
    evidenceRole: 'development',
    calibration: 'pending',
    humanValidation: 'pending',
    profileSha256: sha(JSON.stringify(profile)),
    engine: { name: 'PyMUST', version: '0.1.9', sources: { ...sources } },
    parameters: { ...parameters },
    fieldModel: { ...fieldModel },
    provenance: { generatorSha256: hash(r.generatorSha256), runtimeManifestSha256: hash(r.runtimeManifestSha256) },
    interpretation:
      'PyMUST MGBM elevation focusing versus the reduced fundamental two-way Gaussian envelope (one-way sigma / sqrt(2)). ' +
      'This compares synthetic components, not the complete renderer, slice-thickness calibration or clinical fidelity. ' +
      'No acceptance tolerance is fitted to the observed differences.',
    authenticityLimit:
      'Metadata and branch traces are declarations, not authenticated acquisition. The file CLI requires the Python receipt binding ' +
      'RF reconstruction and causal controls to the exact reference bytes, then checks every original archive hash. ' +
      'File consistency does not establish independent clinical validation.',
    cases,
    controls,
    controlErrors,
    convergence,
  };
}

/** El recibo Python liga los controles a través del hash del JSON completo, no solo del contador. */
export function verifyElevationReceipt(
  input: unknown,
  referenceSha256: string,
  reference: Pick<ReturnType<typeof compareIndependentElevation>, 'cases' | 'controls' | 'convergence'>,
) {
  const receipt = record(input);
  if (receipt.protocolId !== `${protocolId}-verification` || receipt.referenceSha256 !== hash(referenceSha256))
    throw new Error('Elevation verification receipt does not match reference bytes');
  if (reference.cases.length !== 5 || reference.controls.length !== 13 || receipt.verifiedControls !== 13)
    throw new Error('Verification control/case inventory differs');
  const verified = list(receipt.verifiedCases, 5);
  const seen = new Set<string>();
  for (const row of verified) {
    const c = record(row);
    if (
      typeof c.id !== 'string' ||
      seen.has(c.id) ||
      reference.cases.find((expected) => expected.id === c.id)?.raw.sha256 !== hash(c.rawSha256)
    )
      throw new Error('Verification case inventory/hash differs');
    seen.add(c.id);
  }
  const convergence = record(receipt.convergence);
  keys(convergence, ['spacing', 'frequency'], 'Verification convergence');
  measuredEqual(convergence.spacing, reference.convergence.spacing, 'Verification convergence spacing');
  measuredEqual(convergence.frequency, reference.convergence.frequency, 'Verification convergence frequency');
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};
async function boundedRead(path: string, maxBytes: number) {
  const info = await stat(path);
  if (!info.isFile() || !info.size || info.size > maxBytes) throw new Error('Invalid evidence file size or type');
  return readFile(path);
}

export async function compareReferenceFile(inputFile: string, outputFile: string, verificationFile: string) {
  const checkout = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const output = resolve(await realpath(dirname(resolve(outputFile))), basename(outputFile));
  if (inside(checkout, output)) throw new Error('Comparison evidence must be outside checkout');
  const source = buildSource(checkout, []);
  const input = await realpath(inputFile);
  const base = dirname(input);
  const bytes = await boundedRead(input, 4 * 1024 * 1024);
  const result = compareIndependentElevation(JSON.parse(bytes.toString()) as unknown);
  const verificationBytes = await boundedRead(await realpath(verificationFile), 1024 * 1024);
  verifyElevationReceipt(JSON.parse(verificationBytes.toString()) as unknown, sha(bytes), result);
  for (const c of [...result.cases, ...result.controls]) {
    const raw = await realpath(resolve(base, c.raw.path));
    if (!inside(base, raw)) throw new Error('Original escapes reference directory');
    if (sha(await boundedRead(raw, 128 * 1024 * 1024)) !== c.raw.sha256) throw new Error('Independent original hash differs');
  }
  deepStrictEqual(buildSource(checkout, []), source, 'Source changed during the independent comparison');
  const report = { ...result, source, referenceSha256: sha(bytes), verificationSha256: sha(verificationBytes), verifiedOriginals: 18 };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, verification: { type: 'string' }, out: { type: 'string' } } });
  if (!values.input || !values.verification || !values.out)
    throw new Error('Usage: independentElevation.ts --input reference.json --verification verification.json --out comparison.json');
  const report = await compareReferenceFile(values.input, values.out, values.verification);
  console.log(
    JSON.stringify(
      {
        scope: report.scope,
        cases: report.cases.map((c) => ({ id: c.id, ...c.elevationComparison })),
        convergence: report.convergence,
        calibration: report.calibration,
        source: report.source,
      },
      null,
      2,
    ),
  );
}
