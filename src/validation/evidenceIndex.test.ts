import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_CITATION,
  collectCitations,
  evidenceDocs,
  evidenceId,
  INDEX_LINK,
  INDEX_MD,
  readIndex,
  renderIndexMd,
  rewriteDoc,
} from '../../tools/docs/evidence-index';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** Cualquier ruta absoluta de una máquina: `/Users/<x>/…`, `/home/<x>/…`, `/private/{tmp,var}/…`, `~/…` o `C:\\…`. */
const LOCAL_PATH = /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|\/private\/(?:tmp|var)\/|(?<![\w.])~\/\.\w|[A-Z]:\\)[^\s)`"'<>]*/g;
/** El valor por defecto de la raíz (y su carpeta) se puede nombrar; lo que cuelga de ella se cita por el índice. */
const ROOT_MENTIONS = new Set(['~/.t3/scratch', '~/.t3/scratch/vexus-owner-evidence-20261031']);

/**
 * Rutas absolutas históricas que no son evidencia de la raíz y se conservan como estaban (05-11-2026, decisión 322,
 * punto 9): la carpeta de trabajo de otra máquina en tres resultados de octubre, la evidencia de la elevación
 * independiente en su propia carpeta y la orden que espera al runner de EchoTwin. Cualquier otra ruta absoluta rompe.
 */
const HISTORICAL: Readonly<Record<string, readonly string[]>> = {
  'docs/anatomy/LOCAL_ANATOMY_RESULT.md': ['/Users/daniel/Documents/Codex/2026-10-05/task/vexus-sim-anatomia.'],
  'docs/anatomy/PORTAL_LIVER_RESULT.md': ['/Users/daniel/Documents/Codex/2026-10-05/task/vexus-sim-anatomia'],
  'docs/anatomy/PORTAL_PRESENTATION_RESULT.md': [
    '/Users/daniel/Documents/Codex/2026-10-05/task/vexus-sim-anatomia',
    '/Users/daniel/Documents/Codex/2026-10-05/task/evaluacion-vexus/porta-roja/',
  ],
  'docs/fidelity/independent-elevation.md': ['/Users/daniel/.t3/scratch/vexus-psf-elevation-evidence-20261028'],
  'docs/fidelity/README.md': ['/Users/daniel/builds/'],
};

/** Todos los archivos de texto de `docs/`. */
const DOCS = evidenceDocs(ROOT).concat(INDEX_MD);

describe('Índice de la evidencia (decisión 322, punto 9)', () => {
  it('ninguna ruta absoluta nueva en docs/: la evidencia se cita por el índice', () => {
    const found: Record<string, string[]> = {};
    for (const doc of DOCS) {
      const paths = [...read(doc).matchAll(LOCAL_PATH)].map((m) => m[0]).filter((p) => !ROOT_MENTIONS.has(p));
      if (paths.length) found[doc] = paths;
    }
    expect(found).toEqual(HISTORICAL);
  });

  it('index.json: una entrada por ruta citada, con id estable, tipo, bytes, hash y quién la cita', () => {
    const index = readIndex(ROOT);
    expect(index.schema).toBe(1);
    expect(index.entries.length).toBeGreaterThan(50);
    expect(index.entries.map((e) => e.id)).toEqual([...index.entries.map((e) => e.id)].sort());
    for (const e of index.entries) {
      expect(e.id, e.path).toBe(evidenceId(e.path));
      expect(e.round, e.path).toBe(e.path.split('/')[0]);
      expect(e.citedBy.length, e.id).toBeGreaterThan(0);
      if (e.kind === 'missing') expect([e.sha256, e.bytes, e.files], e.id).toEqual(['', 0, 0]);
      else expect(e.sha256, e.id).toMatch(/^[0-9a-f]{64}$/);
      expect(['file', 'dir', 'symlink', 'missing']).toContain(e.kind);
    }
  });

  it('cada cita de docs/ está en el índice, cada entrada se cita, e INDEX.md es el de index.json', () => {
    const index = readIndex(ROOT);
    const { byPath, unknownIds } = collectCitations(ROOT, new Map(index.entries.map((e) => [e.id, e.path])));
    expect(unknownIds, 'enlaces a ids que el índice no tiene').toEqual([]);
    expect([...byPath.keys()].sort()).toEqual(index.entries.map((e) => e.path).sort());
    for (const e of index.entries)
      expect(
        [...(byPath.get(e.path) ?? [])].sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : (a.decision ?? 0) - (b.decision ?? 0))),
        e.id,
      ).toEqual(e.citedBy);
    expect(read(INDEX_MD), 'regenera con node --import tsx tools/docs/evidence-index.ts --write').toBe(renderIndexMd(index));
  });

  it('los enlaces al índice resuelven a docs/evidence/INDEX.md desde su documento, y no queda nada por reescribir', () => {
    const wrong: string[] = [];
    for (const doc of DOCS) {
      const text = read(doc);
      for (const m of text.matchAll(INDEX_LINK))
        if (resolve(ROOT, dirname(doc), m[1]) !== resolve(ROOT, INDEX_MD)) wrong.push(`${doc}: ${m[1]}`);
      expect(rewriteDoc(doc, text), doc).toBe(text);
    }
    expect(wrong).toEqual([]);
  });

  it('la reescritura: enlace, código y JSON, desde cualquier máquina', () => {
    const abs = '/home/otra/.t3/scratch/vexus-owner-evidence-20261031/migration-p1/report.md';
    expect(rewriteDoc('docs/anatomia/x.md', `[informe](${abs}).`)).toBe('[informe](../evidence/INDEX.md#migration-p1-report-md).');
    expect(rewriteDoc('docs/DECISIONS.md', `en \`${abs}\`.`)).toBe(
      'en [`migration-p1/report.md`](evidence/INDEX.md#migration-p1-report-md).',
    );
    expect(rewriteDoc('docs/evidence/s0028-p1/measurements.json', `{"a": "${abs}"}`)).toBe(
      '{"a": "$VEXUS_EVIDENCE_ROOT/migration-p1/report.md"}',
    );
    expect('`~/.t3/scratch/vexus-owner-evidence-20261031/ivc-wall/`'.match(ABSOLUTE_CITATION)).toHaveLength(1);
    expect(rewriteDoc('docs/a.md', '`~/.t3/scratch/vexus-owner-evidence-20261031/ivc-wall/`')).toBe(
      '[`ivc-wall/`](evidence/INDEX.md#ivc-wall)',
    );
    // la prueba de rutas tiene dientes: una absoluta nueva de cualquier forma se ve
    for (const p of [
      '/Users/x/a.md',
      '/home/x/b',
      '~/.t3/c',
      'C:\\Users\\x',
      '/private/tmp/y',
      '~/.t3/scratch/vexus-owner-evidence-20261031/x',
    ])
      expect(`ver ${p} aquí`.match(LOCAL_PATH), p).not.toBeNull();
  });
});
