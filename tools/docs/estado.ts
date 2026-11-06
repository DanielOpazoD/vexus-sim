import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { S0028_BUNDLE } from '../../src/anatomy/people/s0028/descriptor';
import { personShader } from '../../src/anatomy/gpu/personShader';
import { shaderCosts } from '../anatomy/s0028-shader-metrics';
import { bundleAssets } from '../ci/bundleAssets';
import { BUDGETS } from '../ci/bundleBudgets';
import { DEFAULT_JS_BUDGET, S0028_JS_BUDGET, measurePersonBundles, type PersonBundleGraph } from '../ci/personBundles';
import { SAMPLER_GUARD, SLOT_GUARD } from '../ci/shaderBudgets';

/**
 * Presupuestos vigentes (decisión 322, punto 9): cada techo leído de la fuente que lo aplica y su valor actual medido con
 * las mismas funciones (`bundleAssets` + `bundleBudgets.ts` sobre `dist`, `shaderCosts` sobre los ocho programas de
 * `shaderLimits.test.ts`, los descriptores de `people/s0028/descriptor.ts`). Escribe `docs/estado/medidas.json` y la tabla generada
 * de `docs/estado/presupuestos.md`. Uso, tras `vite build`: `node --import tsx tools/docs/estado.ts --write`.
 */

export const MEDIDAS = 'docs/estado/medidas.json';
export const PRESUPUESTOS = 'docs/estado/presupuestos.md';
export const TABLE_START = '<!-- tabla generada por tools/docs/estado.ts -->';
export const TABLE_END = '<!-- fin de la tabla generada -->';

/** Página → bloque generado (marcadores propios) que `--write` rehace desde `medidas.json`. */
export const BLOCKS = {
  'docs/estado/presupuestos.md': { start: TABLE_START, end: TABLE_END, render: (m: Medidas) => renderTable(m) },
  'docs/estado/imagen.md': {
    start: '<!-- programas: generado por tools/docs/estado.ts -->',
    end: '<!-- fin de programas -->',
    render: (m: Medidas) => renderShaders(m),
  },
  'docs/estado/anatomia.md': {
    start: '<!-- presupuestos s0028: generado por tools/docs/estado.ts -->',
    end: '<!-- fin de presupuestos s0028 -->',
    render: (m: Medidas) => renderS0028(m),
  },
  'docs/estado/pruebas.md': {
    start: '<!-- capas: generado por tools/docs/estado.ts -->',
    end: '<!-- fin de capas -->',
    render: (m: Medidas) => renderTests(m),
  },
} as const;

/** Activos del paquete s0028 que cuenta la descarga (decisiones 317–321): los seis del paquete y el cuerpo abdominal. */
export const S0028_DOWNLOAD = [
  /^surfaces\.gzip-/,
  /^abdominal-direct\.gzip-/,
  /^thoracic-direct\.gzip-/,
  /^annotation-capacity\.gzip-/,
  /^skin-polar\.gzip-/,
  /^candidate-manifest-/,
  /^abdominal-body-/,
];

/** Decisión que fijó cada techo del bundle (la historia completa está en `bundleBudgets.ts`). */
const BUDGET_DECISION: ReadonlyArray<[RegExp, number | null]> = [
  [/^surfaces/, 318],
  [/^abdominal-direct|^thoracic-direct|^skin-polar/, 317],
  [/^annotation-capacity/, 320],
  [/^candidate-manifest/, 321],
  [/^three/, 307],
];

export interface Ceiling {
  /** Qué limita. */
  what: string;
  limit: number;
  unit: 'B' | 'tokens' | 'ramas' | 'ranuras' | 'samplers' | 'min';
  /** Decisión que lo fijó (null: anterior a las decisiones numeradas o sin una propia; ver la fuente). */
  decision: number | null;
  /** Archivo que lo aplica. */
  source: string;
}

export interface Measured extends Ceiling {
  /** Valor actual (null: no se mide en local, como la duración de un trabajo de la CI). */
  actual: number | null;
}

export interface ShaderRow {
  name: string;
  tokenLimit: number;
  branchLimit: number;
  current: { tokens: number; branches: number; slots: number; samplers: number; sourceSha256: string };
  s0028: { tokens: number; branches: number; slots: number; samplers: number; sourceSha256: string };
}

export interface Medidas {
  schema: 1;
  date: string;
  main: string;
  rows: Measured[];
  shaders: ShaderRow[];
  /** Huella de los descriptores s0028 con que se calcularon las texturas (para comprobar sin rehacer el build). */
  s0028DescriptorSha256: string;
  tests: TestCounts;
}

export interface TestCounts {
  /** Archivos `*.test.ts` de `src` (vitest) y los que llevan `// @tier slow`. */
  vitestFiles: number;
  slowFiles: number;
  /** Especificaciones Playwright y llamadas `test(` literales (las parametrizadas cuentan una vez). */
  e2eSpecs: number;
  e2eTestCalls: number;
  /** Fragmentos de la e2e en la matriz de la CI. */
  e2eShards: number;
  /** Contratos Python de `tools/anatomy`. */
  pythonContracts: number;
}

/** Recuento de las capas de prueba (sin ejecutar nada). */
export function testCounts(repo: string): TestCounts {
  const walk = (dir: string): string[] =>
    readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`],
    );
  const vitest = walk('src').filter((f) => f.endsWith('.test.ts'));
  const specs = readdirSync(join(repo, 'e2e')).filter((f) => f.endsWith('.spec.ts'));
  const shards = read(repo, '.github/workflows/ci.yml').match(/\n\s+shard:\s*\[([^\]]+)\]/);
  return {
    vitestFiles: vitest.length,
    slowFiles: vitest.filter((f) => read(repo, f).startsWith('// @tier slow')).length,
    e2eSpecs: specs.length,
    e2eTestCalls: specs.reduce((n, f) => n + (read(repo, `e2e/${f}`).match(/^\s*test\(/gm) ?? []).length, 0),
    e2eShards: shards ? shards[1].split(',').length : 0,
    pythonContracts: readdirSync(join(repo, 'tools/anatomy')).filter((f) => f.endsWith('_test.py')).length,
  };
}

const read = (repo: string, f: string): string => readFileSync(join(repo, f), 'utf8');
/** El `nth` literal numérico (0…) que captura `re` en `file`. */
const literal = (repo: string, file: string, re: RegExp, nth = 0): number => {
  const m = [...read(repo, file).matchAll(new RegExp(re.source, 'g'))][nth];
  if (!m) throw new Error(`${file}: no se encuentra ${re} (${nth})`);
  return Number(m[1].replace(/_/g, ''));
};

/** Texturas s0028 que sube `people/s0028/runtime.ts` (la misma cuenta que su comprobación de techo). */
export function s0028Textures(): { abdominal: number; thoracic: number } {
  const B = S0028_BUNDLE;
  return {
    abdominal: B.abdominal.rawBytes + B.capacity.rawBytes - 1179648 + B.skin.rawBytes + B.manifest.bytes + 960,
    thoracic: B.thoracic.rawBytes + 1179648,
  };
}

/** Expresión de `people/s0028/runtime.ts` que `s0028Textures` reproduce: si cambia allí, la prueba lo detecta. */
export const LOAD_S0028_GUARD = [
  'B.abdominal.rawBytes + B.capacity.rawBytes - 1179648 + B.skin.rawBytes + B.manifest.bytes + 960 >',
  'B.thoracic.rawBytes + 1179648 >',
];

export const descriptorSha256 = (): string =>
  createHash('sha256')
    .update(
      JSON.stringify([S0028_BUNDLE.abdominal, S0028_BUNDLE.thoracic, S0028_BUNDLE.capacity, S0028_BUNDLE.skin, S0028_BUNDLE.manifest]),
    )
    .digest('hex');

const PERSON_CEILINGS: Ceiling[] = [
  {
    what: 'JS clausura default (Workers y ganchos incluidos)',
    limit: DEFAULT_JS_BUDGET,
    unit: 'B',
    decision: 322,
    source: 'tools/ci/personBundles.ts',
  },
  {
    what: 'JS clausura s0028 (Workers y ganchos incluidos)',
    limit: S0028_JS_BUDGET,
    unit: 'B',
    decision: 322,
    source: 'tools/ci/personBundles.ts',
  },
];

/** Techos que no dependen del build, leídos de la fuente que los aplica. */
export function staticCeilings(repo: string): Ceiling[] {
  const ci = read(repo, '.github/workflows/ci.yml');
  const jobs = [...ci.matchAll(/\n {2}([\w-]+):\n(?: {4}.*\n)*? {4}timeout-minutes: (\d+)/g)].map((m) => ({
    job: m[1],
    minutes: Number(m[2]),
  }));
  return [
    ...PERSON_CEILINGS,
    {
      what: 'Descarga del paquete s0028 (gzip)',
      limit: literal(repo, 'src/anatomy/people/s0028/surfaces.ts', /gzipLimit:\s*([\d_]+)/),
      unit: 'B',
      decision: 318,
      source: 'src/anatomy/people/s0028/surfaces.ts',
    },
    {
      what: 'Cada `.gzip` fijado del paquete s0028 (por archivo)',
      limit: literal(repo, 'src/anatomy/people/s0028/runtime.ts', /gzipLimit:\s*([\d_]+)/),
      unit: 'B',
      decision: 317,
      source: 'src/anatomy/people/s0028/runtime.ts',
    },
    {
      what: 'Textura abdominal s0028 en memoria (RAW)',
      limit: literal(repo, 'src/anatomy/people/s0028/runtime.ts', /rawLimit:\s*([\d_]+)/),
      unit: 'B',
      decision: 317,
      source: 'src/anatomy/people/s0028/runtime.ts',
    },
    {
      what: 'Textura torácica s0028 en memoria (RAW)',
      // el segundo `rawLimit` de la carga es el del tórax
      limit: literal(repo, 'src/anatomy/people/s0028/runtime.ts', /rawLimit:\s*([\d_]+)/, 1),
      unit: 'B',
      decision: 317,
      source: 'src/anatomy/people/s0028/runtime.ts',
    },
    {
      what: 'Samplers por programa (las dos personas)',
      limit: SAMPLER_GUARD,
      unit: 'samplers',
      decision: 317,
      source: 'tools/ci/shaderBudgets.ts',
    },
    {
      what: 'Ranuras vec4 de uniforms por programa',
      limit: SLOT_GUARD,
      unit: 'ranuras',
      decision: 317,
      source: 'tools/ci/shaderBudgets.ts',
    },
    ...jobs.map((j) => ({
      what: `Trabajo «${j.job}» de la CI`,
      limit: j.minutes,
      unit: 'min' as const,
      decision: null,
      source: '.github/workflows/ci.yml',
    })),
  ];
}

/** Techos por activo y por clausura: usa el mismo grafo verificado por bundle-budget. */
export function bundleRows(dist: string): Measured[] {
  const files = bundleAssets(dist);
  const rows: Measured[] = [];
  for (const { file, size } of files) {
    const name = basename(file);
    const budget = BUDGETS.find(([re]) => re.test(name));
    if (!budget) continue;
    const clean = name.replace(/-[A-Za-z0-9_-]{8}(\.\w+)$/, '$1');
    rows.push({
      what: `\`${clean}\``,
      limit: budget[1],
      unit: 'B',
      decision: BUDGET_DECISION.find(([re]) => re.test(clean))?.[1] ?? null,
      source: 'tools/ci/bundleBudgets.ts',
      actual: size,
    });
  }
  rows.sort((a, b) => (a.what < b.what ? -1 : 1));
  const graph = JSON.parse(readFileSync(join(dist, 'person-bundle-graph.json'), 'utf8')) as PersonBundleGraph;
  const closures = measurePersonBundles(graph);
  const download = files.filter((f) => S0028_DOWNLOAD.some((re) => re.test(basename(f.file)))).reduce((n, f) => n + f.size, 0);
  return [
    ...PERSON_CEILINGS.map((c, i) => ({ ...c, actual: closures[i === 0 ? 'default' : 's0028'].bytes })),
    ...rows,
    {
      what: 'Descarga del paquete s0028 (gzip)',
      limit: Number.NaN,
      unit: 'B',
      decision: 318,
      source: 'src/anatomy/people/s0028/surfaces.ts',
      actual: download,
    },
  ];
}

/** Las ocho filas de `shaderLimits.test.ts` medidas en las dos personas. */
export function shaderRows(): ShaderRow[] {
  return shaderCosts(
    (s) => personShader(s, { person: 's0028', bundle: S0028_BUNDLE }),
    (s) => personShader(s, { person: 'current' }),
  ).map((r) => ({
    name: r.name,
    tokenLimit: r.tokenLimit,
    branchLimit: r.branchLimit,
    current: pick(r.current),
    s0028: pick(r.specialized),
  }));
}
const pick = (m: { tokens: number; branches: number; slots: number; samplers: number; sourceSha256: string }): ShaderRow['current'] => ({
  tokens: m.tokens,
  branches: m.branches,
  slots: m.slots,
  samplers: m.samplers,
  sourceSha256: m.sourceSha256,
});

/** Medida completa (necesita `dist` del build de este árbol). */
export function measure(repo: string, main: string, date: string): Medidas {
  const dist = join(repo, 'dist');
  if (!existsSync(dist) || readdirSync(dist).length === 0) throw new Error('sin dist: ejecuta `vite build` antes');
  const statics = staticCeilings(repo);
  const textures = s0028Textures();
  const bundle = bundleRows(dist);
  const shaders = shaderRows();
  const actual = (c: Ceiling): number | null => {
    const bundled = bundle.find((b) => b.what === c.what);
    if (bundled) return bundled.actual;
    if (c.what.startsWith('Textura abdominal')) return textures.abdominal;
    if (c.what.startsWith('Textura torácica')) return textures.thoracic;
    if (c.what.startsWith('Cada `.gzip`'))
      return Math.max(
        ...bundle
          .filter((b) => /^`(abdominal-direct|thoracic-direct|annotation-capacity|skin-polar)\.gzip\.bin`$/.test(b.what))
          .map((b) => b.actual ?? 0),
      );
    if (c.unit === 'samplers') return Math.max(...shaders.flatMap((s) => [s.current.samplers, s.s0028.samplers]));
    if (c.unit === 'ranuras') return Math.max(...shaders.flatMap((s) => [s.current.slots, s.s0028.slots]));
    return null;
  };
  return {
    schema: 1,
    date,
    main,
    rows: [...bundle.filter((b) => b.source === 'tools/ci/bundleBudgets.ts'), ...statics.map((c) => ({ ...c, actual: actual(c) }))],
    shaders,
    s0028DescriptorSha256: descriptorSha256(),
    tests: testCounts(repo),
  };
}

const n = (x: number | null): string => (x === null || Number.isNaN(x) ? '—' : x.toLocaleString('es-ES').replace(/\s/g, '.'));

/** Tabla de `presupuestos.md`: techos con su decisión y su valor actual, y los ocho programas. */
export function renderTable(m: Medidas): string {
  const margin = (r: Measured): string => (r.actual === null ? '—' : `${n(r.limit - r.actual)}`);
  const dec = (d: number | null): string => (d === null ? '—' : String(d));
  const pct = (a: number, b: number): string => `${((100 * a) / b).toFixed(1).replace('.', ',')} %`;
  return [
    TABLE_START,
    '',
    `${stamp(m)} No se copian a mano.`,
    '',
    '| Techo | Límite | Actual | Margen | Unidad | Decisión | Fuente |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |',
    ...m.rows.map(
      (r) => `| ${r.what} | ${n(r.limit)} | ${n(r.actual)} | ${margin(r)} | ${r.unit} | ${dec(r.decision)} | \`${r.source}\` |`,
    ),
    '',
    'Programas especializados (`shaderLimits.test.ts`, decisiones 309 y 320): tokens y ramas expandidos de `main`, por persona.',
    '',
    '| Programa | Tokens default / s0028 / techo | Uso | Ramas default / s0028 / techo | Uso | Ranuras | Samplers |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...m.shaders.map((s) => {
      const t = Math.max(s.current.tokens, s.s0028.tokens),
        b = Math.max(s.current.branches, s.s0028.branches);
      return (
        `| \`${s.name}\` | ${n(s.current.tokens)} / ${n(s.s0028.tokens)} / ${n(s.tokenLimit)} | ${pct(t, s.tokenLimit)} | ` +
        `${n(s.current.branches)} / ${n(s.s0028.branches)} / ${n(s.branchLimit)} | ${pct(b, s.branchLimit)} | ` +
        `${Math.max(s.current.slots, s.s0028.slots)} | ${Math.max(s.current.samplers, s.s0028.samplers)} |`
      );
    }),
    '',
    TABLE_END,
  ].join('\n');
}

const stamp = (m: Medidas): string => `Medido en el candidato basado en main \`${m.main}\` el ${m.date} con \`tools/docs/estado.ts\`.`;

/** Programas por persona: samplers, ranuras y uso de los techos (página de imagen). */
export function renderShaders(m: Medidas): string {
  const b = BLOCKS['docs/estado/imagen.md'];
  const pct = (a: number, l: number): string => `${Math.round((100 * a) / l)} %`;
  return [
    b.start,
    '',
    stamp(m),
    '',
    '| Programa | Samplers default / s0028 | Ranuras default / s0028 | Uso de tokens (peor persona) | Uso de ramas |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...m.shaders.map(
      (s) =>
        `| \`${s.name}\` | ${s.current.samplers} / ${s.s0028.samplers} | ${s.current.slots} / ${s.s0028.slots} | ` +
        `${pct(Math.max(s.current.tokens, s.s0028.tokens), s.tokenLimit)} | ${pct(Math.max(s.current.branches, s.s0028.branches), s.branchLimit)} |`,
    ),
    '',
    b.end,
  ].join('\n');
}

/** Presupuestos de la persona s0028 (página de anatomía). */
export function renderS0028(m: Medidas): string {
  const b = BLOCKS['docs/estado/anatomia.md'];
  const pick = (re: RegExp): Measured[] => m.rows.filter((r) => re.test(r.what));
  const rows = [
    ...pick(/^Descarga|^Textura|^Cada `\.gzip`/),
    ...pick(/^`(surfaces|abdominal-direct|thoracic-direct|annotation-capacity|skin-polar)\.gzip\.bin`$|^`candidate-manifest\.bin`$/),
  ];
  return [
    b.start,
    '',
    stamp(m),
    '',
    '| Techo | Límite (B) | Actual (B) | Margen (B) | Decisión |',
    '| --- | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) => `| ${r.what} | ${n(r.limit)} | ${n(r.actual)} | ${r.actual === null ? '—' : n(r.limit - r.actual)} | ${r.decision ?? '—'} |`,
    ),
    '',
    b.end,
  ].join('\n');
}

/** Capas de prueba contadas (página de pruebas). */
export function renderTests(m: Medidas): string {
  const b = BLOCKS['docs/estado/pruebas.md'];
  const t = m.tests;
  return [
    b.start,
    '',
    stamp(m),
    '',
    '| Capa | Cuántas | Dónde |',
    '| --- | ---: | --- |',
    `| Archivos vitest (rápidos + lentos) | ${n(t.vitestFiles)} | \`src/**/*.test.ts\` |`,
    `| De ellos, lentos (\`// @tier slow\`) | ${n(t.slowFiles)} | \`npm run test:slow\`, \`check\`, CI |`,
    `| Especificaciones e2e / llamadas \`test(\` | ${n(t.e2eSpecs)} / ${n(t.e2eTestCalls)} | \`e2e/*.spec.ts\`, ${t.e2eShards} fragmentos en la CI |`,
    `| Contratos Python | ${n(t.pythonContracts)} | \`tools/anatomy/*_test.py\` (local) |`,
    '',
    b.end,
  ].join('\n');
}

/** El documento con el bloque `start`…`end` sustituido. */
export function withBlock(doc: string, start: string, end: string, block: string): string {
  const a = doc.indexOf(start),
    b = doc.indexOf(end);
  if (a < 0 || b < a) throw new Error(`faltan los marcadores ${start}`);
  return doc.slice(0, a) + block + doc.slice(b + end.length);
}

/** El documento con la tabla de presupuestos sustituida. */
export const withTable = (doc: string, table: string): string => withBlock(doc, TABLE_START, TABLE_END, table);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = resolve(import.meta.dirname, '../..');
  process.chdir(repo); // `shaderCosts` lee shaderLimits.test.ts desde la raíz
  // Base del candidato medido; el build y las cifras proceden del checkout actual.
  const main = execFileSync(
    'git',
    ['rev-parse', '--short', execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim()],
    {
      encoding: 'utf8',
    },
  ).trim();
  const date = new Date().toISOString().slice(0, 10);
  const m = measure(repo, main, date);
  writeFileSync(join(repo, MEDIDAS), JSON.stringify(m, null, 1) + '\n');
  if (process.argv.includes('--write')) {
    const prettier = await import('prettier');
    for (const [page, b] of Object.entries(BLOCKS)) {
      const path = join(repo, page);
      const options = (await prettier.resolveConfig(path)) ?? {};
      const doc = withBlock(read(repo, page), b.start, b.end, b.render(m)).replace(
        /Actualizado: \S+ sobre main `\w+`/,
        `Actualizado: ${date} sobre main \`${main}\``,
      );
      writeFileSync(path, await prettier.format(doc, { ...options, filepath: path }));
    }
  }
  console.log(`medidas: ${m.rows.length} techos y ${m.shaders.length} programas sobre ${main}`);
}
