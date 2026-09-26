import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Carga diferida: estos módulos viajan en su propio chunk y el chunk principal no los debe arrastrar. Un `import`
 * estático (que no sea `import type`) desde el código de la aplicación los metería en él sin que nada falle, salvo el
 * presupuesto del bundle mucho después. Los ganchos de prueba solo se cargan con `?e2e` o en desarrollo; el navegador
 * 3D (three.js) tras el primer cuadro; la pestaña Docente solo en modo docente.
 */
const LAZY: Array<{ module: RegExp; name: string }> = [
  { module: /\/testHooks['"]/, name: 'testHooks' },
  { module: /\/navigator3d['"]/, name: 'navigator3d' },
  { module: /\/panel\/teacherTab['"]/, name: 'teacherTab' },
];

const SRC = join(__dirname, '..');
function appSources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'validation') out.push(...appSources(p));
    } else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('Carga diferida: el chunk principal no importa los módulos diferidos', () => {
  const files = appSources(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));

  it.each(LAZY)('$name solo se importa con import() o como tipo', ({ module }) => {
    const offenders: string[] = [];
    let dynamic = 0;
    for (const f of files) {
      // las sentencias import de varias líneas terminan en `from '…'`: se buscan desde `import` hasta su `from`
      for (const m of f.text.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+['"][^'"]+['"]/gms)) {
        if (module.test(m[0]) && !m[1]) offenders.push(`${f.path}: ${m[0].trim().replace(/\s+/g, ' ')}`);
      }
      for (const m of f.text.matchAll(/import\(\s*['"][^'"]+['"]\s*\)/g)) if (module.test(m[0])) dynamic++;
    }
    expect(offenders).toEqual([]);
    // la prueba no pasa en vacío: el módulo existe y se carga en algún sitio
    expect(dynamic).toBeGreaterThan(0);
  });
});
