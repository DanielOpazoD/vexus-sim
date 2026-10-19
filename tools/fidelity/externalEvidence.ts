/** Offline admission; no network, parameter fitting, image synthesis or clinical verdict. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CONVEX_C35_PROFILE } from '../../src/ultrasound/transducerProfile';
import { parseExternalEvidence, validateExternalEvidence, type VerifiedEvidenceFile } from './externalEvidenceContract';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const GENERIC_ACOUSTIC_PROFILE = {
  id: 'convex-c35',
  basis: 'generic-estimate',
  parametersSha256: sha(JSON.stringify(CONVEX_C35_PROFILE)),
};
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};

export async function admitExternalEvidence(manifestFile: string, outputFile: string) {
  const manifestPath = await realpath(manifestFile);
  const root = dirname(manifestPath);
  const output = resolve(await realpath(dirname(resolve(outputFile))), basename(outputFile));
  const checkout = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  if (inside(checkout, output)) throw new Error('Evidence output must be outside the checkout');
  const raw = await readFile(manifestPath);
  const manifest = parseExternalEvidence(JSON.parse(raw.toString()) as unknown);
  const artifacts: VerifiedEvidenceFile[] = [];
  const measurementPaths = new Set(manifest.references.map((r) => r.measurements.path));
  const files = new Map<string, string>();
  for (const r of manifest.references)
    for (const f of [r.source.file, r.measurements]) {
      if (files.has(f.path) && files.get(f.path) !== f.sha256) throw new Error(`Conflicting hashes for ${f.path}`);
      files.set(f.path, f.sha256);
    }
  for (const [path, expected] of files) {
    const actualPath = await realpath(resolve(root, path));
    const fileStat = await stat(actualPath);
    if (!inside(root, actualPath) || !fileStat.isFile() || fileStat.size === 0)
      throw new Error(`Artifact escapes manifest directory, is empty or is not a file: ${path}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(actualPath)) hash.update(chunk as Buffer);
    const digest = hash.digest('hex');
    if (digest !== expected) throw new Error(`Artifact SHA256 differs: ${path}`);
    const artifact: VerifiedEvidenceFile = { path, sha256: digest };
    if (measurementPaths.has(path)) {
      if ((await stat(actualPath)).size > 1024 * 1024)
        throw new Error('Measurement JSON exceeds 1 MiB; raw images/clips have no such limit');
      const data = await readFile(actualPath);
      if (sha(data) !== digest) throw new Error(`Measurement changed while reading: ${path}`);
      artifact.json = JSON.parse(data.toString()) as unknown;
    }
    artifacts.push(artifact);
  }
  const report = validateExternalEvidence(manifest, artifacts, GENERIC_ACOUSTIC_PROFILE.parametersSha256);
  await writeFile(
    output,
    JSON.stringify(
      {
        ...report,
        manifestSha256: sha(raw),
        profileParameters: CONVEX_C35_PROFILE,
        artifacts: artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
        admittedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return { output, externalEvidence: report.externalEvidence, calibration: report.calibration, humanValidation: report.humanValidation };
}

async function main() {
  const { values } = parseArgs({
    options: { manifest: { type: 'string' }, out: { type: 'string' }, profile: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(
      'fidelity:external --profile | --manifest /data/manifest.json --out /evidence/admission.json\nOutput parent must exist outside the checkout; existing files are never replaced.',
    );
    return;
  }
  if (values.profile) {
    if (values.manifest || values.out) throw new Error('--profile cannot be combined with --manifest/--out');
    console.log(JSON.stringify(GENERIC_ACOUSTIC_PROFILE, null, 2));
    return;
  }
  if (!values.manifest || !values.out) throw new Error('Declare --manifest and --out; use --profile for the current generic profile hash');
  console.log(JSON.stringify(await admitExternalEvidence(values.manifest, values.out)));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
