import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Índice de la evidencia pesada (decisión 322, punto 9). La evidencia vive fuera de Git, en una raíz versionada por
 * fecha (`VEXUS_EVIDENCE_ROOT`, por defecto `~/.t3/scratch/vexus-owner-evidence-20261031`); los documentos la citan por
 * el índice (`docs/evidence/INDEX.md#<id>`) o, en JSON, como `$VEXUS_EVIDENCE_ROOT/<ruta>`, nunca por una ruta absoluta.
 * `docs/evidence/index.json` guarda por artefacto su ruta en la raíz, tipo, bytes, SHA-256 y quién lo cita.
 *
 * Uso: `node --import tsx tools/docs/evidence-index.ts [--rewrite | --write | --check]`
 * - `--rewrite`: convierte las rutas absolutas de `docs/` en citas del índice y lo regenera.
 * - `--write`: regenera índice y hashes desde la raíz.
 * - `--check` (por defecto): el índice cuadra con las citas de `docs/`; con la raíz presente, los hashes también; sin
 *   ella (otra máquina, la CI) solo avisa.
 */

export const ROOT_NAME = 'vexus-owner-evidence-20261031';
export const ROOT_VAR = '$VEXUS_EVIDENCE_ROOT';
export const INDEX_JSON = 'docs/evidence/index.json';
export const INDEX_MD = 'docs/evidence/INDEX.md';

/** Cita por ruta absoluta de algo dentro de la raíz de evidencia, en cualquier máquina: `/Users/<x>/…/<raíz>/<ruta>` o `~/…/<raíz>/<ruta>`. */
export const ABSOLUTE_CITATION = new RegExp(`(?:/(?:Users|home)/[^/\\s]+|~)/[^\\s)\\]\`"'<>]*?/${ROOT_NAME}(/[^\\s)\\]\`"'<>,;]+)`, 'g');
/** Cita relativa a la raíz (JSON y texto): `$VEXUS_EVIDENCE_ROOT/<ruta>`. */
export const ROOT_CITATION = /\$VEXUS_EVIDENCE_ROOT\/([^\s)\]`"'<>,;]+)/g;
/** Enlace a una entrada del índice desde cualquier documento. */
export const INDEX_LINK = /\]\(((?:\.\.\/|\.\/)*(?:evidence\/)?INDEX\.md)#([a-z0-9-]+)\)/g;

export interface EvidenceCitation {
  /** Documento de `docs/` que cita, desde la raíz del repositorio. */
  doc: string;
  /** Decisión de `DECISIONS.md` en cuyo texto está la cita; null en los demás documentos. */
  decision: number | null;
}

export interface EvidenceEntry {
  id: string;
  /** Ruta dentro de la raíz, con `/` y sin barra final. */
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'missing';
  bytes: number;
  /** Archivo: SHA-256 del contenido. Directorio: SHA-256 de las líneas `sha256  ruta` de sus archivos, ordenadas. */
  sha256: string;
  /** Archivos de un directorio (1 en un archivo). */
  files: number;
  /** Ronda o bloque de evidencia: el primer segmento de la ruta. */
  round: string;
  citedBy: EvidenceCitation[];
}

export interface EvidenceIndex {
  schema: 1;
  root: string;
  entries: EvidenceEntry[];
}

/** Identificador estable de una ruta de la raíz: minúsculas, alfanuméricos y guiones. */
export const evidenceId = (path: string): string =>
  path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const normalizePath = (path: string): string => path.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');

/** Raíz de evidencia de esta máquina. */
export const evidenceRoot = (): string => process.env.VEXUS_EVIDENCE_ROOT ?? join(homedir(), '.t3/scratch', ROOT_NAME);

/** Documentos de `docs/` que pueden citar evidencia (Markdown y JSON), sin el propio índice. */
export function evidenceDocs(repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(join(repo, dir)).sort()) {
      const p = `${dir}/${f}`;
      if (lstatSync(join(repo, p)).isDirectory()) walk(p);
      else if (/\.(md|json)$/.test(f) && p !== INDEX_JSON && p !== INDEX_MD) out.push(p);
    }
  };
  walk('docs');
  return out;
}

/** Decisión de `DECISIONS.md` que contiene la posición `offset`. */
function decisionAt(text: string, offset: number): number | null {
  let found: number | null = null;
  for (const m of text.matchAll(/^## (\d+)\. /gm)) {
    if (m.index > offset) break;
    found = Number(m[1]);
  }
  return found;
}

/** Citas de evidencia de un documento: (ruta en la raíz o id del índice, decisión). */
export function citationsIn(
  doc: string,
  text: string,
): {
  absolute: Array<{ path: string; decision: number | null }>;
  rooted: Array<{ path: string; decision: number | null }>;
  links: Array<{ id: string; target: string; decision: number | null }>;
} {
  const decision = (offset: number): number | null => (doc === 'docs/DECISIONS.md' ? decisionAt(text, offset) : null);
  return {
    absolute: [...text.matchAll(ABSOLUTE_CITATION)].map((m) => ({ path: normalizePath(m[1]), decision: decision(m.index) })),
    rooted: [...text.matchAll(ROOT_CITATION)].map((m) => ({ path: normalizePath(m[1]), decision: decision(m.index) })),
    links: [...text.matchAll(INDEX_LINK)].map((m) => ({ target: m[1], id: m[2], decision: decision(m.index) })),
  };
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Tipo, bytes, archivos y SHA-256 de una ruta de la raíz (sin seguir enlaces simbólicos de directorio). */
export function hashEvidence(root: string, path: string): Pick<EvidenceEntry, 'kind' | 'bytes' | 'sha256' | 'files'> {
  const abs = join(root, path);
  if (!existsSync(abs) && !isSymlink(abs)) return { kind: 'missing', bytes: 0, sha256: '', files: 0 };
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    const target = readlinkSync(abs);
    return { kind: 'symlink', bytes: Buffer.byteLength(target), sha256: sha256(`symlink ${target}`), files: 1 };
  }
  if (st.isFile()) return { kind: 'file', bytes: st.size, sha256: sha256(readFileSync(abs)), files: 1 };
  const lines: string[] = [];
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const f of readdirSync(join(abs, dir)).sort()) {
      const p = dir ? `${dir}/${f}` : f;
      const s = lstatSync(join(abs, p));
      if (s.isSymbolicLink()) lines.push(`${sha256(`symlink ${readlinkSync(join(abs, p))}`)}  ${p}`);
      else if (s.isDirectory()) walk(p);
      else {
        bytes += s.size;
        lines.push(`${sha256(readFileSync(join(abs, p)))}  ${p}`);
      }
    }
  };
  walk('');
  return { kind: 'dir', bytes, sha256: sha256(lines.join('\n')), files: lines.length };
}

function isSymlink(abs: string): boolean {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Ruta del índice vista desde un documento (`docs/a/b.md` → `../evidence/INDEX.md`). */
export const indexLinkFrom = (doc: string): string => relative(dirname(doc), INDEX_MD).split('\\').join('/');

/** Reúne las citas de `docs/` en entradas (sin hashes), con el mapa id → ruta del índice anterior para los enlaces. */
export function collectCitations(
  repo: string,
  known: ReadonlyMap<string, string>,
): { byPath: Map<string, EvidenceCitation[]>; unknownIds: string[] } {
  const byPath = new Map<string, EvidenceCitation[]>();
  const unknownIds: string[] = [];
  const add = (path: string, c: EvidenceCitation): void => {
    const list = byPath.get(path) ?? byPath.set(path, []).get(path)!;
    if (!list.some((x) => x.doc === c.doc && x.decision === c.decision)) list.push(c);
  };
  for (const doc of evidenceDocs(repo)) {
    const found = citationsIn(doc, readFileSync(join(repo, doc), 'utf8'));
    for (const a of [...found.absolute, ...found.rooted]) add(a.path, { doc, decision: a.decision });
    for (const l of found.links) {
      const path = known.get(l.id);
      if (path === undefined) unknownIds.push(`${doc}: #${l.id}`);
      else add(path, { doc, decision: l.decision });
    }
  }
  return { byPath, unknownIds };
}

/** Índice con hashes calculados en `root`. */
export function buildIndex(repo: string, root: string, known: ReadonlyMap<string, string>): EvidenceIndex {
  const { byPath, unknownIds } = collectCitations(repo, known);
  if (unknownIds.length) throw new Error(`enlaces a entradas que no existen: ${unknownIds.join(', ')}`);
  const entries = [...byPath]
    .map(([path, citedBy]): EvidenceEntry => ({
      id: evidenceId(path),
      path,
      ...hashEvidence(root, path),
      round: path.split('/')[0],
      citedBy: citedBy.sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : (a.decision ?? 0) - (b.decision ?? 0))),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('dos rutas dan el mismo id');
  return { schema: 1, root: `${ROOT_VAR} (por defecto ~/.t3/scratch/${ROOT_NAME})`, entries };
}

const thousands = (n: number): string => n.toLocaleString('es-ES').replace(/\s/g, '.');

/** `docs/evidence/INDEX.md` a partir del índice. */
export function renderIndexMd(index: EvidenceIndex): string {
  const kind = { file: 'archivo', dir: 'carpeta', symlink: 'enlace', missing: 'ausente' } as const;
  const cites = (e: EvidenceEntry): string =>
    e.citedBy.map((c) => `${c.doc.replace(/^docs\//, '')}${c.decision === null ? '' : ` (${c.decision})`}`).join(', ');
  return [
    '# Índice de la evidencia',
    '',
    'Evidencia pesada de las rondas (informes, láminas, medidas, logs), fuera de Git en una raíz versionada por fecha:',
    `\`${ROOT_VAR}\`, por defecto \`~/.t3/scratch/${ROOT_NAME}\`. Los documentos citan cada artefacto por su ancla en esta`,
    'página (o en JSON como `$VEXUS_EVIDENCE_ROOT/<ruta>`), nunca por una ruta absoluta (decisión 322, punto 9).',
    '',
    'Generado por `tools/docs/evidence-index.ts` desde `index.json`, que guarda además el SHA-256 completo. Con la raíz',
    'presente, `node --import tsx tools/docs/evidence-index.ts --check` verifica tipo, bytes y hash de cada entrada; sin',
    'ella solo avisa. Una carpeta se resume por el SHA-256 de las líneas `sha256  ruta` de sus archivos, ordenadas.',
    '',
    `${index.entries.length} artefactos; ${thousands(index.entries.reduce((n, e) => n + e.bytes, 0))} bytes.`,
    '',
    '| Id | Ruta en la raíz | Tipo | Archivos | Bytes | SHA-256 | Citado en (decisión) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...index.entries.map(
      (e) =>
        `| <a id="${e.id}"></a>\`${e.id}\` | \`${e.path}\` | ${kind[e.kind]} | ${e.files} | ${thousands(e.bytes)} | \`${e.sha256.slice(0, 12)}\` | ${cites(e)} |`,
    ),
    '',
  ].join('\n');
}

/**
 * Sustituye las rutas absolutas de un documento: en Markdown, un enlace o un código pasa a enlace del índice
 * (`[\`ruta\`](../evidence/INDEX.md#id)`); en JSON, la cadena pasa a `$VEXUS_EVIDENCE_ROOT/ruta`.
 */
export function rewriteDoc(doc: string, text: string): string {
  if (doc.endsWith('.json')) return text.replace(ABSOLUTE_CITATION, (_m, rel: string) => `${ROOT_VAR}/${normalizePath(rel)}`);
  const link = indexLinkFrom(doc);
  return (
    text
      // enlace Markdown cuyo destino es la ruta absoluta: solo cambia el destino
      .replace(new RegExp(`\\]\\((${ABSOLUTE_CITATION.source})\\)`, 'g'), (_m, _abs: string, rel: string) => {
        const path = normalizePath(rel);
        return `](${link}#${evidenceId(path)})`;
      })
      // código con la ruta absoluta: enlace al índice con la ruta en la raíz como texto
      .replace(new RegExp(`\`(${ABSOLUTE_CITATION.source})\``, 'g'), (_m, _abs: string, rel: string) => {
        const path = normalizePath(rel);
        return `[\`${path}${rel.endsWith('/') ? '/' : ''}\`](${link}#${evidenceId(path)})`;
      })
  );
}

/** Comprueba un índice frente a la raíz: lista de discrepancias (vacía si cuadra). */
export function verifyHashes(index: EvidenceIndex, root: string): string[] {
  const bad: string[] = [];
  for (const e of index.entries) {
    const now = hashEvidence(root, e.path);
    if (now.kind !== e.kind || now.bytes !== e.bytes || now.sha256 !== e.sha256 || now.files !== e.files)
      bad.push(`${e.id}: ${e.kind} ${e.bytes} B ${e.sha256.slice(0, 12)} → ${now.kind} ${now.bytes} B ${now.sha256.slice(0, 12)}`);
  }
  return bad;
}

export const readIndex = (repo: string): EvidenceIndex => JSON.parse(readFileSync(join(repo, INDEX_JSON), 'utf8')) as EvidenceIndex;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = resolve(import.meta.dirname, '../..');
  const root = evidenceRoot();
  const hasRoot = existsSync(root);
  const previous = existsSync(join(repo, INDEX_JSON)) ? readIndex(repo) : { schema: 1 as const, root: '', entries: [] };
  const known = new Map(previous.entries.map((e) => [e.id, e.path]));
  const mode = process.argv.includes('--rewrite') ? 'rewrite' : process.argv.includes('--write') ? 'write' : 'check';
  if (mode !== 'check') {
    if (!hasRoot) throw new Error(`sin la raíz de evidencia (${root}): no se puede calcular el índice`);
    // las rutas absolutas pasan a citas por id: se apuntan antes de sustituirlas
    for (const doc of evidenceDocs(repo))
      for (const a of citationsIn(doc, readFileSync(join(repo, doc), 'utf8')).absolute) known.set(evidenceId(a.path), a.path);
    if (mode === 'rewrite')
      for (const doc of evidenceDocs(repo)) {
        const text = readFileSync(join(repo, doc), 'utf8');
        const next = rewriteDoc(doc, text);
        if (next !== text) writeFileSync(join(repo, doc), next);
      }
    const index = buildIndex(repo, root, known);
    writeFileSync(join(repo, INDEX_JSON), JSON.stringify(index, null, 1) + '\n');
    writeFileSync(join(repo, INDEX_MD), renderIndexMd(index));
    console.log(`índice: ${index.entries.length} artefactos (${index.entries.filter((e) => e.kind === 'missing').length} ausentes)`);
  } else {
    const { byPath, unknownIds } = collectCitations(repo, known);
    const problems = [...unknownIds];
    const cited = new Set(byPath.keys());
    for (const e of previous.entries) if (!cited.has(e.path)) problems.push(`${e.id}: nadie lo cita`);
    for (const p of cited) if (!previous.entries.some((e) => e.path === p)) problems.push(`${p}: citado y fuera del índice`);
    if (readFileSync(join(repo, INDEX_MD), 'utf8') !== renderIndexMd(previous)) problems.push('INDEX.md no es el de index.json');
    if (hasRoot) problems.push(...verifyHashes(previous, root));
    else console.warn(`aviso: sin la raíz de evidencia (${root}); no se verifican los hashes`);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log(`índice de evidencia: ${previous.entries.length} artefactos${hasRoot ? ', hashes verificados' : ''}`);
  }
}
