import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDecisions, renderIndex } from '../../tools/docs/decisions-index';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Consistencia de la documentación (práctica de EchoTwin): los documentos son
 * de carga; si se desvían del código, la suite falla.
 */
describe('Documentación', () => {
  it('parseDecisions/renderIndex: numeración, estado «superada» y niveles ### ignorados (entrada sintética)', () => {
    const md = '# T\n## 1. Elegir Vitest\ntexto\n## 2. Reloj único [Estado: superada por 5]\nx\n### 3. No\n## 10. Otra\n';
    const ds = parseDecisions(md);
    expect(ds).toEqual([
      { n: 1, title: 'Elegir Vitest', status: 'vigente', line: 2 },
      { n: 2, title: 'Reloj único', status: 'superada por 5', line: 4 },
      { n: 10, title: 'Otra', status: 'vigente', line: 7 },
    ]);
    expect(renderIndex(ds)).toContain('| [2](DECISIONS.md#L4) | Reloj único | superada por 5 |');
    expect(renderIndex([]).endsWith('|---|---|---|\n\n')).toBe(true);
  });

  it('DECISIONS.md numera 1..N sin huecos y el índice generado está al día', () => {
    const ds = parseDecisions(read('docs/DECISIONS.md'));
    expect(ds.length).toBeGreaterThan(10);
    ds.forEach((d, i) => expect(d.n).toBe(i + 1));
    expect(read('docs/DECISIONS_INDEX.md')).toBe(renderIndex(ds));
  });

  it('ARCHITECTURE.md y README.md solo nombran archivos fuente que existen', () => {
    for (const doc of ['docs/ARCHITECTURE.md', 'README.md', 'docs/APPROXIMATIONS.md']) {
      const md = read(doc);
      const refs = [...md.matchAll(/`((?:src|tools|public|docs)\/[A-Za-z0-9_./-]+\.(?:ts|js|md|mjs))`/g)].map((m) => m[1]);
      // APPROXIMATIONS.md cita módulos por carpeta (`src/physiology`), no archivos; los otros dos, archivos
      if (doc !== 'docs/APPROXIMATIONS.md') expect(refs.length, `${doc} no cita archivos fuente`).toBeGreaterThan(2);
      for (const r of refs) expect(existsSync(resolve(ROOT, r)), `${doc} nombra ${r}, que no existe`).toBe(true);
    }
  });

  it('README documenta cada script de package.json que un usuario debe conocer', () => {
    const readme = read('README.md');
    for (const s of ['npm run dev', 'npm test', 'npm run test:all', 'npm run calibrate', 'npm run check']) {
      expect(readme.includes(s), `README no menciona ${s}`).toBe(true);
    }
  });

  it('README cita la versión actual del paquete en su «Estado» (antes lo congelaba en la iteración 2)', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(read('README.md')).toContain(`## Estado (v${version}`);
  });

  it('cada limitación declarada en código aparece en docs/LIMITATIONS.md', async () => {
    const { KNOWN_LIMITATIONS } = await import('./limitations');
    const md = read('docs/LIMITATIONS.md');
    for (const id of KNOWN_LIMITATIONS) expect(md.includes(`\`${id}\``), `LIMITATIONS.md no cita \`${id}\``).toBe(true);
  });
});
