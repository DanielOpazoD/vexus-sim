/** Admission is a provenance check, not calibration or an assessment of clinical fidelity. */
export interface EvidenceFile {
  path: string;
  sha256: string;
}

export interface EvidenceReference {
  id: string;
  role: 'development' | 'held-out';
  origin: 'physical-phantom' | 'clinical' | 'literature' | 'synthetic';
  /** Namespaced pseudonym; required for clinical independence, never a patient name. */
  subjectId: string | null;
  /** Independent acquisition session, not a frame, crop or export identifier. */
  sessionId: string | null;
  source: { citation: string; rights: string; file: EvidenceFile };
  acquisition: Record<string, string | number | boolean | number[] | null>;
  measurements: EvidenceFile;
}

export interface ExternalEvidenceManifest {
  schemaVersion: 1;
  protocolId: string;
  profile: { id: 'convex-c35'; basis: 'generic-estimate'; parametersSha256: string };
  references: EvidenceReference[];
  tuningReferenceIds: string[];
}

export interface VerifiedEvidenceFile extends EvidenceFile {
  /** Parsed only for a measurement artifact; image/clip contents are not interpreted. */
  json?: unknown;
}

const METRICS = {
  axialFwhm: { unit: 'mm', level: 'linear-envelope' },
  lateralFwhm: { unit: 'mm', level: 'linear-envelope' },
  envelopeSnr: { unit: 'ratio', level: 'linear-envelope' },
  meanGray: { unit: 'gray-0-255', level: 'display-gray' },
  stdGray: { unit: 'gray-0-255', level: 'display-gray' },
} as const;

function object(value: unknown, keys: string[], at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: expected object`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((k) => !keys.includes(k)) || keys.some((k) => !Object.hasOwn(row, k)))
    throw new Error(`${at}: missing or unknown fields`);
  return row;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${at}: expected non-empty text`);
  return value.trim();
}

function choice<T extends string>(value: unknown, options: readonly T[], at: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(`${at}: unsupported value`);
  return value as T;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected array`);
  return value;
}

function finite(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at}: expected finite number`);
  return value;
}

function sha(value: unknown, at: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${at}: expected lowercase SHA256`);
  return value;
}

/** Only portable relative paths below the manifest directory; CLI also checks realpath. */
export function evidencePath(value: unknown): string {
  const path = text(value, 'artifact path');
  if (
    path !== value ||
    path.includes('\\') ||
    path.includes('\0') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('artifact path: expected relative path without traversal');
  return path;
}

function file(value: unknown): EvidenceFile {
  const v = object(value, ['path', 'sha256'], 'artifact');
  return { path: evidencePath(v.path), sha256: sha(v.sha256, 'artifact') };
}

function acquisition(value: unknown): EvidenceReference['acquisition'] {
  const positive = ['frequencyMHz', 'depthMm', 'focusMm', 'dynamicRangeDb'];
  const names = ['scanner', 'transducer', ...positive, 'gainDb', 'tgcDb', 'harmonic', 'compound', 'mmPerPixel'];
  const v = object(value, names, 'acquisition');
  const out: EvidenceReference['acquisition'] = {};
  for (const key of names) {
    const x = v[key];
    if (x === null) out[key] = null;
    else if (key === 'scanner' || key === 'transducer') out[key] = text(x, key);
    else if (key === 'harmonic' || key === 'compound') {
      if (typeof x !== 'boolean') throw new Error(`${key}: expected boolean or null`);
      out[key] = x;
    } else if (key === 'tgcDb' || key === 'mmPerPixel') {
      const values = list(x, key).map((n) => finite(n, key));
      if (!values.length || (key === 'mmPerPixel' && (values.length !== 2 || values.some((n) => n <= 0))))
        throw new Error(`${key}: invalid sampling or scale`);
      out[key] = values;
    } else {
      const n = finite(x, key);
      if (positive.includes(key) && n <= 0) throw new Error(`${key}: expected positive number`);
      out[key] = n;
    }
  }
  return out;
}

export function parseExternalEvidence(value: unknown): ExternalEvidenceManifest {
  const m = object(value, ['schemaVersion', 'protocolId', 'profile', 'references', 'tuningReferenceIds'], 'manifest');
  if (m.schemaVersion !== 1) throw new Error('manifest: unsupported schemaVersion');
  const p = object(m.profile, ['id', 'basis', 'parametersSha256'], 'profile');
  const references = list(m.references, 'references').map((item): EvidenceReference => {
    const r = object(item, ['id', 'role', 'origin', 'subjectId', 'sessionId', 'source', 'acquisition', 'measurements'], 'reference');
    const s = object(r.source, ['citation', 'rights', 'file'], 'source');
    return {
      id: text(r.id, 'reference id'),
      role: choice(r.role, ['development', 'held-out'], 'role'),
      origin: choice(r.origin, ['physical-phantom', 'clinical', 'literature', 'synthetic'], 'origin'),
      subjectId: r.subjectId === null ? null : text(r.subjectId, 'subjectId'),
      sessionId: r.sessionId === null ? null : text(r.sessionId, 'sessionId'),
      source: { citation: text(s.citation, 'citation'), rights: text(s.rights, 'rights'), file: file(s.file) },
      acquisition: acquisition(r.acquisition),
      measurements: file(r.measurements),
    };
  });
  if (!references.length || new Set(references.map((r) => r.id)).size !== references.length)
    throw new Error('references: empty or duplicate ids');
  const tuningReferenceIds = list(m.tuningReferenceIds, 'tuningReferenceIds').map((x) => text(x, 'tuning id'));
  if (new Set(tuningReferenceIds).size !== tuningReferenceIds.length) throw new Error('tuningReferenceIds: duplicate ids');
  return {
    schemaVersion: 1,
    protocolId: text(m.protocolId, 'protocolId'),
    profile: {
      id: choice(p.id, ['convex-c35'], 'profile id'),
      basis: choice(p.basis, ['generic-estimate'], 'profile basis'),
      parametersSha256: sha(p.parametersSha256, 'profile parameters'),
    },
    references,
    tuningReferenceIds,
  };
}

function observables(value: unknown, referenceId: string) {
  const m = object(value, ['schemaVersion', 'referenceId', 'observables'], 'measurements');
  if (m.schemaVersion !== 1 || m.referenceId !== referenceId) throw new Error('measurements: version or reference identity differs');
  const rows = list(m.observables, 'observables').map((item) => {
    const o = object(item, ['metric', 'value', 'unit', 'level', 'method', 'region'], 'observable');
    const metric = choice(o.metric, Object.keys(METRICS) as (keyof typeof METRICS)[], 'metric');
    const spec = METRICS[metric];
    if (o.unit !== spec.unit || o.level !== spec.level) throw new Error('observable: unit or signal level differs');
    const value = finite(o.value, metric);
    if (
      value < 0 ||
      ((metric === 'axialFwhm' || metric === 'lateralFwhm') && value === 0) ||
      (spec.unit === 'gray-0-255' && value > (metric === 'stdGray' ? 127.5 : 255))
    )
      throw new Error('observable: value outside its representation');
    return { metric, value, ...spec, method: text(o.method, 'method'), region: text(o.region, 'region') };
  });
  if (!rows.length) throw new Error('measurements: empty observables');
  return rows;
}

export function validateExternalEvidence(value: unknown, artifacts: readonly VerifiedEvidenceFile[], expectedProfileSha256: string) {
  const manifest = parseExternalEvidence(value);
  if (manifest.profile.parametersSha256 !== sha(expectedProfileSha256, 'expected profile')) throw new Error('profile: parameters differ');
  const verified = new Map(artifacts.map((a) => [a.path, a]));
  if (verified.size !== artifacts.length) throw new Error('artifacts: duplicate paths');
  const partitions = new Map<string, EvidenceReference['role']>();
  const separate = (key: string, role: EvidenceReference['role']) => {
    if (partitions.has(key) && partitions.get(key) !== role) throw new Error(`development/held-out leakage: ${key}`);
    partitions.set(key, role);
  };
  for (const id of manifest.tuningReferenceIds) {
    const r = manifest.references.find((r) => r.id === id);
    if (!r || r.role !== 'development') throw new Error('tuningReferenceIds: unknown or held-out reference');
  }
  const references = manifest.references.map((r) => {
    const missing: string[] = [];
    for (const f of [r.source.file, r.measurements]) {
      if (verified.get(f.path)?.sha256 !== f.sha256) throw new Error(`artifact hash not verified: ${f.path}`);
      separate(`sha256:${f.sha256}`, r.role);
    }
    if (r.subjectId) separate(`subject:${r.subjectId}`, r.role);
    if (r.sessionId) separate(`session:${r.sessionId}`, r.role);
    const measured = r.origin === 'clinical' || r.origin === 'physical-phantom';
    if (measured && !r.sessionId) missing.push('independent acquisition session');
    if (r.origin === 'clinical' && !r.subjectId) missing.push('clinical subject pseudonym');
    for (const [key, value] of Object.entries(r.acquisition)) if (value === null) missing.push(`acquisition.${key}`);
    if (!measured) missing.push('not an independently measured physical reference');
    return { id: r.id, role: r.role, origin: r.origin, missing, observables: observables(verified.get(r.measurements.path)?.json, r.id) };
  });
  return {
    schemaVersion: 1,
    protocolId: manifest.protocolId,
    profile: manifest.profile,
    externalEvidence: references.every((r) => !r.missing.length) ? 'admitted' : 'incomplete',
    measuredReferenceCount: references.filter((r) => !r.missing.length).length,
    declaredHeldOutCount: references.filter((r) => r.role === 'held-out').length,
    calibration: 'pending',
    heldOutEvaluation: 'pending',
    humanValidation: 'pending',
    identityLimit: 'Subject/session identities and measurement methods are declarations, not independently authenticated by this tool.',
    references,
  };
}
