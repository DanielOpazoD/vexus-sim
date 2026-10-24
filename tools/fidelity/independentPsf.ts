/** Compare an independently acquired PyMUST point response with the reduced B PSF.
 * This is a component comparison, not a rendering or clinical acceptance gate.
 */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { TISSUES, Tissue } from '../../src/anatomy/tissues';
import { axialSigmaMm, lateralFwhmMm } from '../../src/ultrasound/beamModel';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../../src/ultrasound/transducerProfile';
import { evidencePath } from './externalEvidenceContract';
import { buildSource } from '../build/provenance';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const protocolId = 'convex-c35-pymust-point-v2';
const record = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Expected an object');
  return x as Record<string, unknown>;
};
const finite = (x: unknown): number => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('Expected finite number');
  return x;
};
const numbers = (x: unknown): number[] => {
  if (!Array.isArray(x)) throw new Error('Expected samples');
  return x.map(finite);
};

/** Main-lobe FWHM in linear envelope amplitude (half amplitude = −6.02 dB, not half power). */
export function envelopeFwhm(positionMm: readonly number[], envelope: readonly number[]) {
  if (positionMm.length !== envelope.length || positionMm.length < 5 || positionMm.length > 10001)
    throw new Error('Invalid profile length');
  let peak = 0;
  for (let i = 0; i < positionMm.length; i++) {
    if (!Number.isFinite(positionMm[i]) || !Number.isFinite(envelope[i]) || envelope[i] < 0) throw new Error('Invalid profile value');
    if (i && positionMm[i] <= positionMm[i - 1]) throw new Error('Profile positions must increase');
    if (envelope[i] > envelope[peak]) peak = i;
  }
  if (envelope[peak] <= 0) throw new Error('Empty point response');
  const half = envelope[peak] / 2;
  let left = peak;
  let right = peak;
  while (left > 0 && envelope[left] > half) left--;
  while (right + 1 < envelope.length && envelope[right] > half) right++;
  if (left === peak || right === peak || envelope[left] > half || envelope[right] > half)
    throw new Error('Point response is truncated at half height');
  const cross = (a: number, b: number) =>
    positionMm[a] + ((half - envelope[a]) / (envelope[b] - envelope[a])) * (positionMm[b] - positionMm[a]);
  return { widthMm: cross(right, right - 1) - cross(left, left + 1), peakPositionMm: positionMm[peak] };
}

function parseReference(input: unknown) {
  const r = record(input);
  const engine = record(r.engine);
  if (r.role !== undefined && r.role !== 'development') throw new Error('This protocol is a development reference');
  if (r.lateralMethod !== 'source-offset-fixed-transmit-and-receive-at-nominal-depth') throw new Error('Unsupported lateral acquisition');
  if (
    r.schemaVersion !== 1 ||
    r.protocolId !== protocolId ||
    r.origin !== 'synthetic' ||
    engine.name !== 'PyMUST' ||
    engine.version !== '0.1.9'
  )
    throw new Error('Unsupported independent reference');
  const p = record(r.parameters);
  const profile = CONVEX_C35_PROFILE;
  const expected = {
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
  for (const [key, value] of Object.entries(expected))
    if (Math.abs(finite(p[key]) - value) > 1e-9) throw new Error(`Reference/profile mismatch: ${key}`);
  if (
    p.txApodization !== 'Hann' ||
    p.rxApodization !== 'uniform' ||
    p.elements !== 65 ||
    p.elementFillFraction !== 0.9 ||
    p.txCycles !== 1 ||
    p.samplingFrequencyMHz !== 28 ||
    ![1, 0.5].includes(finite(p.spacingScale))
  )
    throw new Error('Reference acquisition differs from registered protocol');
  if (!Array.isArray(r.cases) || !r.cases.length || r.cases.length > 5) throw new Error('Invalid case inventory');
  const seen = new Set<string>();
  const registered: Record<string, [number, number]> = {
    near: [60, 90],
    focal: [90, 90],
    deep: [150, 90],
    focus75: [90, 75],
    focus120: [90, 120],
  };
  const cases = r.cases.map((row: unknown) => {
    const c = record(row);
    if (typeof c.id !== 'string' || !Object.hasOwn(registered, c.id) || seen.has(c.id)) throw new Error('Unknown/duplicate case');
    seen.add(c.id);
    const [depthMm, focusMm] = registered[c.id];
    if (c.depthMm !== depthMm || c.focusMm !== focusMm) throw new Error('Case geometry differs from registered protocol');
    const raw = record(c.raw);
    if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new Error('Invalid original hash');
    const rawPath = evidencePath(raw.path);
    let receiveAperture: { elementCountAtTarget: number; chordAtTargetMm: number } | null = null;
    if (c.receiveAperture !== undefined) {
      const aperture = record(c.receiveAperture);
      const count = finite(aperture.elementCountAtTarget);
      const chord = finite(aperture.chordAtTargetMm);
      if (!Number.isInteger(count) || count < 2 || count > 65 || chord <= 0 || chord > 26.000001)
        throw new Error('Invalid effective receive aperture');
      receiveAperture = { elementCountAtTarget: count, chordAtTargetMm: chord };
    }
    const profiles = record(c.profiles);
    const measure = (axis: 'axial' | 'lateral') => {
      const q = record(profiles[axis]);
      return envelopeFwhm(numbers(q.positionMm), numbers(q.envelope));
    };
    const control = record(c.fullReceiveControl);
    if (control.rxFNumber !== 0 || control.chordMm !== 26) throw new Error('Invalid receive-aperture control');
    const controlProfile = record(control.lateral);
    const fullReceiveControl = envelopeFwhm(numbers(controlProfile.positionMm), numbers(controlProfile.envelope));
    return {
      id: c.id,
      depthMm,
      focusMm,
      raw: { path: rawPath, sha256: raw.sha256 },
      receiveAperture,
      fullReceiveControl,
      axial: measure('axial'),
      lateral: measure('lateral'),
    };
  });
  return { cases, parameters: p, engine };
}

export function compareIndependentPsf(input: unknown) {
  const { cases, parameters, engine } = parseReference(input);
  const beam = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false });
  return {
    protocolId,
    scope: 'independent-synthetic-PSF-component-comparison',
    evidenceRole: 'development',
    calibration: 'pending',
    humanValidation: 'pending',
    profileSha256: sha(JSON.stringify(CONVEX_C35_PROFILE)),
    engine,
    parameters,
    interpretation:
      'Differences include pulse and aperture models; they are not isolated renderer errors. No acceptance threshold is fitted to these observations.',
    cases: cases.map((c) => {
      const compare = (referenceMm: number, modelMm: number) => ({
        referenceMm,
        modelMm,
        differenceMm: modelMm - referenceMm,
        relativeDifference: (modelMm - referenceMm) / referenceMm,
      });
      return {
        ...c,
        modelReceiveChordMm: Math.min(beam.apertureRxMaxMm, c.depthMm / beam.fNumberRxMin),
        axialComparison: compare(c.axial.widthMm, 2 * Math.sqrt(2 * Math.log(2)) * axialSigmaMm(c.depthMm, beam)),
        lateralComparison: compare(c.lateral.widthMm, lateralFwhmMm(c.depthMm, c.focusMm, beam)),
      };
    }),
  };
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};

export function verifyRawReceipt(input: unknown, referenceSha256: string, cases: readonly { id: string; raw: { sha256: string } }[]) {
  const receipt = record(input);
  if (receipt.protocolId !== 'convex-c35-pymust-raw-verification-v2' || receipt.referenceSha256 !== referenceSha256)
    throw new Error('Raw verification receipt does not match reference bytes');
  if (!Array.isArray(receipt.verifiedCases) || receipt.verifiedCases.length !== cases.length)
    throw new Error('Raw verification inventory differs');
  const seen = new Set<string>();
  for (const row of receipt.verifiedCases as unknown[]) {
    const c = record(row);
    if (typeof c.id !== 'string' || seen.has(c.id) || cases.find((r) => r.id === c.id)?.raw.sha256 !== c.rawSha256)
      throw new Error('Raw verification case/hash differs');
    seen.add(c.id);
  }
}

export async function compareReferenceFile(inputFile: string, outputFile: string, verificationFile: string) {
  const checkout = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const source = buildSource(checkout, []);
  const input = await realpath(inputFile);
  const base = dirname(input);
  if ((await stat(input)).size > 4 * 1024 * 1024) throw new Error('Reference JSON exceeds 4 MiB');
  const bytes = await readFile(input);
  const result = compareIndependentPsf(JSON.parse(bytes.toString()) as unknown);
  const verification = await realpath(verificationFile);
  if ((await stat(verification)).size > 1024 * 1024) throw new Error('Verification exceeds 1 MiB');
  const verificationBytes = await readFile(verification);
  verifyRawReceipt(JSON.parse(verificationBytes.toString()) as unknown, sha(bytes), result.cases);
  for (const c of result.cases) {
    const raw = await realpath(resolve(base, c.raw.path));
    if (!inside(base, raw)) throw new Error('Original escapes reference directory');
    const info = await stat(raw);
    if (!info.isFile() || !info.size || info.size > 128 * 1024 * 1024) throw new Error('Invalid original size');
    if (sha(await readFile(raw)) !== c.raw.sha256) throw new Error('Independent original hash differs');
  }
  const output = resolve(await realpath(dirname(resolve(outputFile))), basename(outputFile));
  if (inside(checkout, output)) throw new Error('Comparison evidence must be outside checkout');
  deepStrictEqual(buildSource(checkout, []), source, 'Source changed during the independent comparison');
  await writeFile(
    output,
    JSON.stringify({ ...result, source, referenceSha256: sha(bytes), verificationSha256: sha(verificationBytes) }, null, 2) + '\n',
    { flag: 'wx' },
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, verification: { type: 'string' } } });
  if (!values.input || !values.out || !values.verification)
    throw new Error('Usage: independentPsf.ts --input reference.json --verification raw-verification.json --out comparison.json');
  const result = await compareReferenceFile(values.input, values.out, values.verification);
  console.log(
    JSON.stringify(
      {
        scope: result.scope,
        cases: result.cases.map((c) => ({ id: c.id, axial: c.axialComparison, lateral: c.lateralComparison })),
        calibration: result.calibration,
      },
      null,
      2,
    ),
  );
}
