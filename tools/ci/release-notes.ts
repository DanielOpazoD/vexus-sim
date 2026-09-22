import { readFileSync } from 'node:fs';

/**
 * Imprime la sección `## [X.Y.Z]` del CHANGELOG (hasta la siguiente versión) para usarla como
 * notas de la release. Falla si la versión no tiene sección: no se publica sin notas.
 */
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md no tiene sección para ${version}`);
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

if (process.argv[1]?.endsWith('release-notes.ts')) {
  const version = process.argv[2];
  if (!version) throw new Error('uso: tsx tools/ci/release-notes.ts X.Y.Z');
  process.stdout.write(releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version) + '\n');
}
