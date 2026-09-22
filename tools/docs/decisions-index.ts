/**
 * Genera docs/DECISIONS_INDEX.md a partir de docs/DECISIONS.md (práctica de
 * EchoTwin): una tabla con número, título, estado y enlace a la línea. No se
 * edita a mano; `npm run docs:index -- --check` falla si está desactualizado.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export interface Decision {
  n: number;
  title: string;
  status: string;
  line: number;
}

export function parseDecisions(md: string): Decision[] {
  const out: Decision[] = [];
  md.split('\n').forEach((line, i) => {
    const m = /^## (\d+)\. (.+?)\s*$/.exec(line);
    if (!m) return;
    const st = /\[Estado: ([^\]]+)\]/.exec(m[2]);
    out.push({ n: Number(m[1]), title: m[2].replace(/\s*\[Estado:[^\]]+\]/, ''), status: st ? st[1] : 'vigente', line: i + 1 });
  });
  return out;
}

export function renderIndex(ds: Decision[]): string {
  const rows = ds.map((d) => `| [${d.n}](DECISIONS.md#L${d.line}) | ${d.title} | ${d.status} |`);
  return `# Índice de decisiones\n\nGenerado por \`npm run docs:index\` — no editar a mano.\n\n| N.º | Decisión | Estado |\n|---|---|---|\n${rows.join('\n')}\n`;
}

const isMain = process.argv[1]?.endsWith('decisions-index.ts');
if (isMain) {
  const md = readFileSync('docs/DECISIONS.md', 'utf8');
  const index = renderIndex(parseDecisions(md));
  if (process.argv.includes('--check')) {
    const current = readFileSync('docs/DECISIONS_INDEX.md', 'utf8');
    if (current !== index) {
      console.error('DECISIONS_INDEX.md desactualizado: ejecuta npm run docs:index');
      process.exit(1);
    }
  } else writeFileSync('docs/DECISIONS_INDEX.md', index);
}
