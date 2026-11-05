import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARCHIVOS_PENDIENTES, TWINS, twinStatus, type TwinPair, type TwinSide, type TwinStatus } from './registry';
import { scanTree, type ScannedSource } from './scan';

/**
 * Inventario de gemelos (decisión 322, punto 5): el resumen y la tabla de `docs/engineering/gemelos.md`, generados del
 * registro (`tools/twins/registry.ts`) y de la lectura de `src`. Uso: `node --import tsx tools/twins/inventory.ts --write`
 * reescribe la sección entre los marcadores; sin argumentos, la imprime.
 */

export const INVENTORY_START = '<!-- inventario de gemelos: generado por tools/twins/inventory.ts -->';
export const INVENTORY_END = '<!-- fin del inventario -->';

const STATUS_LABEL: Record<TwinStatus, string> = {
  demostrada: 'demostrada',
  parcial: 'parcial',
  inspeccion: 'solo inspección',
  'sin-paridad': 'sin paridad',
};

/** Lados de un par cuyo archivo edita la r3 de P3: su marcador `@twin` queda pendiente. */
export const pendingSides = (t: TwinPair): string[] =>
  [...t.cpu, ...t.gpu].map((s) => s.file).filter((f, i, all) => f in ARCHIVOS_PENDIENTES && all.indexOf(f) === i);

/** Cifras que dependen solo del registro: la prueba exige que el documento las lleve tal cual. */
export function registrySummary(twins: readonly TwinPair[] = TWINS): string {
  const count = (s: TwinStatus): number => twins.filter((t) => twinStatus(t) === s).length;
  const worker = twins.filter((t) => t.kind === 'cpu-worker').length;
  const symbols = (sides: (t: TwinPair) => readonly TwinSide[], key: 'symbols' | 'templates' = 'symbols'): number =>
    twins.reduce((n, t) => n + sides(t).reduce((m, s) => m + (s[key]?.length ?? 0), 0), 0);
  const pending = twins.filter((t) => pendingSides(t).length > 0).length;
  return (
    `**Cifras del registro:** ${twins.length} pares (${twins.length - worker} CPU↔GLSL, ${worker} CPU↔Worker); ` +
    `paridad demostrada ${count('demostrada')}, parcial ${count('parcial')}, solo inspección ${count('inspeccion')}, ` +
    `sin paridad ${count('sin-paridad')}; ${symbols((t) => t.cpu)} símbolos del lado CPU, ${symbols((t) => t.gpu)} del lado GPU/Worker ` +
    `y ${symbols((t) => t.gpu, 'templates')} plantillas; ` +
    `${pending} pares con un marcador pendiente de la r3 de P3.`
  );
}

const where = (tree: ReadonlyMap<string, ScannedSource>, side: TwinSide, name: string): string => {
  const scan = tree.get(side.file);
  const line =
    scan?.glslFunctions.find((f) => f.name === name)?.line ?? scan?.tsDeclarations.find((d) => d.name === name)?.line ?? undefined;
  return line === undefined ? name : `${name}:${line}`;
};

const sideCell = (tree: ReadonlyMap<string, ScannedSource>, sides: readonly TwinSide[]): string =>
  sides
    .map((s) => {
      const names = [...s.symbols.map((n) => where(tree, s, n)), ...(s.templates ?? []).map((n) => `plantilla ${where(tree, s, n)}`)];
      return `\`${s.file.replace(/^src\//, '')}\` ${names.join(', ')}`;
    })
    .join('<br>');

/** Lo que la comparación no cubre: el hueco del par y el alcance de cada prueba parcial. */
const gapCell = (t: TwinPair): string =>
  [t.gap, ...t.evidence.filter((e) => e.scope).map((e) => `${e.file.replace(/^(src\/validation|e2e)\//, '')}: ${e.scope}`)]
    .filter(Boolean)
    .join('<br>') || '—';

/** Tabla de pares con archivo y línea de cada símbolo (instantánea: las líneas se mueven con el código). */
export function renderInventory(root: string, twins: readonly TwinPair[] = TWINS): string {
  const tree = new Map(scanTree(root).map((s) => [s.file, s]));
  const rows = twins.map((t) => {
    const tests = t.evidence.map((e) => `${e.kind}: \`${e.file.replace(/^src\/validation\//, '')}\``).join('<br>') || '—';
    const pending = pendingSides(t).length
      ? ` (marcador pendiente en ${pendingSides(t)
          .map((f) => `\`${f.replace(/^src\//, '')}\``)
          .join(', ')})`
      : '';
    return `| \`${t.id}\` | ${t.what} | ${sideCell(tree, t.cpu)} | ${sideCell(tree, t.gpu)} | ${STATUS_LABEL[twinStatus(t)]}${pending} | ${tests} | ${gapCell(t).replace(/\|/g, '\\|')} |`;
  });
  return [
    INVENTORY_START,
    '',
    registrySummary(twins),
    '',
    '| Par | Qué | CPU (archivo, símbolo:línea) | GPU o Worker | Paridad | Pruebas | Huecos y alcance |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    INVENTORY_END,
  ].join('\n');
}

/** El documento con la sección del inventario sustituida. */
export function withInventory(doc: string, section: string): string {
  const start = doc.indexOf(INVENTORY_START);
  const end = doc.indexOf(INVENTORY_END);
  if (start < 0 || end < start) throw new Error('gemelos.md: faltan los marcadores del inventario');
  return doc.slice(0, start) + section + doc.slice(end + INVENTORY_END.length);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(import.meta.dirname, '../..');
  const section = renderInventory(root);
  if (process.argv.includes('--write')) {
    const path = join(root, 'docs/engineering/gemelos.md');
    // con el formato del repositorio, para que `format:check` no pida otra pasada
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(path)) ?? {};
    writeFileSync(path, await prettier.format(withInventory(readFileSync(path, 'utf8'), section), { ...options, filepath: path }));
    console.log(`gemelos.md: ${TWINS.length} pares`);
  } else console.log(section);
}
