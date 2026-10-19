import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  evidencePath,
  parseExternalEvidence,
  validateExternalEvidence,
  type ExternalEvidenceManifest,
  type VerifiedEvidenceFile,
} from '../../tools/fidelity/externalEvidenceContract';
import { admitExternalEvidence, GENERIC_ACOUSTIC_PROFILE } from '../../tools/fidelity/externalEvidence';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const parametersSha256 = GENERIC_ACOUSTIC_PROFILE.parametersSha256;
const measurement = (referenceId: string) => ({
  schemaVersion: 1,
  referenceId,
  observables: [
    {
      metric: 'axialFwhm',
      value: 0.8,
      unit: 'mm',
      level: 'linear-envelope',
      method: 'Half-amplitude width of an isolated target; numerical fixture only',
      region: 'Target at 70 mm',
    },
  ],
});
function fixture() {
  const references: ExternalEvidenceManifest['references'] = ['a', 'b'].map((id, i) => ({
    id,
    role: i ? 'held-out' : 'development',
    origin: 'clinical',
    subjectId: `fixture:subject-${id}`,
    sessionId: `fixture:session-${id}`,
    source: {
      citation: 'Invented test fixture; never external evidence',
      rights: 'Test fixture',
      file: { path: `${id}.bin`, sha256: hash(id) },
    },
    acquisition: {
      scanner: 'Fixture',
      transducer: 'Fixture',
      frequencyMHz: 3.5,
      depthMm: 150,
      focusMm: 90,
      gainDb: 0,
      dynamicRangeDb: 60,
      tgcDb: [0, 0, 0],
      harmonic: false,
      compound: false,
      mmPerPixel: [0.2, 0.2],
    },
    measurements: { path: `${id}.json`, sha256: hash(JSON.stringify(measurement(id))) },
  }));
  const manifest: ExternalEvidenceManifest = {
    schemaVersion: 1,
    protocolId: 'fixture-v1',
    profile: { id: 'convex-c35', basis: 'generic-estimate', parametersSha256 },
    references,
    tuningReferenceIds: ['a'],
  };
  const artifacts: VerifiedEvidenceFile[] = references.flatMap((r) => [
    { ...r.source.file },
    { ...r.measurements, json: measurement(r.id) },
  ]);
  return { manifest, artifacts };
}

describe('admisión externa: identidad no equivale a calibración', () => {
  it('admite declaraciones completas y mantiene calibración, reservado y humanos pendientes', () => {
    const { manifest, artifacts } = fixture();
    const report = validateExternalEvidence(manifest, artifacts, parametersSha256);
    expect(report.externalEvidence).toBe('admitted');
    expect(report.measuredReferenceCount).toBe(2);
    expect(report.declaredHeldOutCount).toBe(1);
    expect([report.calibration, report.heldOutEvaluation, report.humanValidation]).toEqual(['pending', 'pending', 'pending']);
    expect(report.profile.basis).toBe('generic-estimate');
  });

  it.each(['subjectId', 'sessionId'] as const)('rechaza mismo %s entre desarrollo y reservado aunque los hashes sean distintos', (key) => {
    const { manifest, artifacts } = fixture();
    manifest.references[1][key] = manifest.references[0][key];
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('leakage');
  });

  it('rechaza el mismo original bajo nombres distintos entre particiones', () => {
    const { manifest, artifacts } = fixture();
    manifest.references[1].source.file.sha256 = manifest.references[0].source.file.sha256;
    artifacts[2].sha256 = artifacts[0].sha256;
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('leakage');
  });

  it.each(['b', 'missing'])('rechaza utilizar para ajuste la referencia %s', (id) => {
    const { manifest, artifacts } = fixture();
    manifest.tuningReferenceIds = [id];
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('tuningReferenceIds');
  });

  it('no convierte metadatos desconocidos en evidencia completa', () => {
    const { manifest, artifacts } = fixture();
    manifest.references[0].acquisition.harmonic = null;
    manifest.references[1].subjectId = null;
    manifest.references[1].sessionId = null;
    const report = validateExternalEvidence(manifest, artifacts, parametersSha256);
    expect(report.externalEvidence).toBe('incomplete');
    expect(report.measuredReferenceCount).toBe(0);
    expect(report.references[1].missing).toContain('clinical subject pseudonym');
    expect(report.heldOutEvaluation).toBe('pending');
  });

  it.each(['synthetic', 'literature'] as const)('%s no cuenta como medición física independiente', (origin) => {
    const { manifest, artifacts } = fixture();
    for (const r of manifest.references) r.origin = origin;
    const report = validateExternalEvidence(manifest, artifacts, parametersSha256);
    expect(report.measuredReferenceCount).toBe(0);
    expect(report.externalEvidence).toBe('incomplete');
  });

  it('no exige identidad de paciente a un fantoma con sesiones declaradas distintas', () => {
    const { manifest, artifacts } = fixture();
    for (const r of manifest.references) {
      r.origin = 'physical-phantom';
      r.subjectId = null;
    }
    expect(validateExternalEvidence(manifest, artifacts, parametersSha256).externalEvidence).toBe('admitted');
  });

  it('rechaza evidencia no verificada y parámetros de otro perfil', () => {
    const { manifest, artifacts } = fixture();
    expect(() => validateExternalEvidence(manifest, artifacts.slice(1), parametersSha256)).toThrow('not verified');
    expect(() => validateExternalEvidence(manifest, artifacts, hash('different profile'))).toThrow('parameters differ');
  });

  it.each([
    { value: NaN },
    { value: Infinity },
    { value: -1 },
    { value: 0 },
    { unit: 'px' },
    { level: 'display-gray' },
    { method: '' },
    { region: '' },
    { metric: 'diagnostic-accuracy' },
  ])('rechaza observable incompatible o sin método: %j', (patch) => {
    const { manifest, artifacts } = fixture();
    const m = measurement('a');
    Object.assign(m.observables[0], patch);
    artifacts[1].json = m;
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow();
  });

  it('rechaza identidades de medición equivocadas y arrays vacíos', () => {
    const { manifest, artifacts } = fixture();
    artifacts[1].json = measurement('b');
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('identity');
    artifacts[1].json = { ...measurement('a'), observables: [] };
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('empty');
  });

  it.each([
    { metric: 'lateralFwhm', value: 1.2, unit: 'mm', level: 'linear-envelope' },
    { metric: 'envelopeSnr', value: 1.9, unit: 'ratio', level: 'linear-envelope' },
    { metric: 'meanGray', value: 127, unit: 'gray-0-255', level: 'display-gray' },
    { metric: 'stdGray', value: 30, unit: 'gray-0-255', level: 'display-gray' },
  ])('conserva unidad y nivel de las otras métricas admitidas: $metric', (patch) => {
    const { manifest, artifacts } = fixture();
    const m = measurement('a');
    Object.assign(m.observables[0], patch);
    artifacts[1].json = m;
    expect(validateExternalEvidence(manifest, artifacts, parametersSha256).references[0].observables[0]).toMatchObject(patch);
  });

  it.each([
    { frequencyMHz: 0 },
    { gainDb: NaN },
    { tgcDb: [] },
    { mmPerPixel: [0.2] },
    { mmPerPixel: [0.2, -1] },
    { harmonic: 'false' },
    { scanner: '' },
    { extraSetting: 1 },
  ])('rechaza metadatos con tipos o unidades de representación inválidos: %j', (patch) => {
    const { manifest } = fixture();
    Object.assign(manifest.references[0].acquisition, patch);
    expect(() => parseExternalEvidence(manifest)).toThrow();
  });

  it('rechaza identidades duplicadas y estadísticos de gris fuera de rango', () => {
    const { manifest, artifacts } = fixture();
    manifest.references[1].id = 'a';
    expect(() => parseExternalEvidence(manifest)).toThrow('duplicate ids');
    manifest.references[1].id = 'b';
    const m = measurement('a');
    Object.assign(m.observables[0], { metric: 'meanGray', value: 256, unit: 'gray-0-255', level: 'display-gray' });
    artifacts[1].json = m;
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('outside its representation');
    Object.assign(m.observables[0], { metric: 'stdGray', value: 127.5 });
    expect(validateExternalEvidence(manifest, artifacts, parametersSha256).references[0].observables[0].value).toBe(127.5);
    m.observables[0].value = 128;
    expect(() => validateExternalEvidence(manifest, artifacts, parametersSha256)).toThrow('outside its representation');
  });

  it.each([null, [], { schemaVersion: 1 }, { ...fixture().manifest, humanValidation: 'approved' }])(
    'valida JSON desconocido y no acepta humanos declarados ficticiamente',
    (value) => {
      expect(() => parseExternalEvidence(value)).toThrow();
    },
  );

  it.each(['/tmp/source', '../source', 'folder/../source', 'C:/source', 'folder\\source', './source', 'a//b', 'a\0b'])(
    'rechaza ruta no contenida %s',
    (path) => {
      expect(() => evidencePath(path)).toThrow();
    },
  );
});

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function onDisk() {
  const base = await mkdtemp(join(tmpdir(), 'vexus-evidence-'));
  temporary.push(base);
  const data = join(base, 'data');
  await mkdir(data);
  const { manifest } = fixture();
  for (const r of manifest.references) {
    await writeFile(join(data, r.source.file.path), r.id);
    await writeFile(join(data, r.measurements.path), JSON.stringify(measurement(r.id)));
  }
  const input = join(data, 'manifest.json');
  await writeFile(input, JSON.stringify(manifest));
  return { base, data, input, manifest, output: join(base, 'admission.json') };
}

describe('CLI offline: archivos originales y salida exclusiva', () => {
  it('verifica bytes, registra parámetros y no sobrescribe resultados previos', async () => {
    const f = await onDisk();
    await admitExternalEvidence(f.input, f.output);
    const original = await readFile(f.output, 'utf8');
    const report = JSON.parse(original) as { manifestSha256: string; artifacts: unknown[]; humanValidation: string };
    expect(report.manifestSha256).toBe(hash(JSON.stringify(f.manifest)));
    expect(report.artifacts).toHaveLength(4);
    expect(report.humanValidation).toBe('pending');
    await expect(admitExternalEvidence(f.input, f.output)).rejects.toThrow('EEXIST');
    expect(await readFile(f.output, 'utf8')).toBe(original);
  });

  it('rechaza un original vacío aunque su hash sea correcto', async () => {
    const f = await onDisk();
    await writeFile(join(f.data, 'a.bin'), '');
    f.manifest.references[0].source.file.sha256 = hash('');
    await writeFile(f.input, JSON.stringify(f.manifest));
    await expect(admitExternalEvidence(f.input, f.output)).rejects.toThrow('empty');
  });

  it('rechaza un original alterado', async () => {
    const f = await onDisk();
    await writeFile(join(f.data, 'a.bin'), 'altered');
    await expect(admitExternalEvidence(f.input, f.output)).rejects.toThrow('SHA256 differs');
  });

  it('rechaza un symlink de entrada que escapa del directorio del manifiesto', async () => {
    const f = await onDisk();
    const outside = join(f.base, 'outside.bin');
    await writeFile(outside, 'a');
    await rm(join(f.data, 'a.bin'));
    await symlink(outside, join(f.data, 'a.bin'));
    await expect(admitExternalEvidence(f.input, f.output)).rejects.toThrow('escapes');
  });

  it('rechaza la salida dentro del checkout, también a través de un symlink', async () => {
    const f = await onDisk();
    const link = join(f.base, 'checkout');
    await symlink(resolve('.'), link);
    await expect(admitExternalEvidence(f.input, join(link, 'external-evidence-must-not-exist.json'))).rejects.toThrow(
      'outside the checkout',
    );
  });
});
