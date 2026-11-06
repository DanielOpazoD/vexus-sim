import { TOTAL_JS_BUDGET } from './bundleBudgets';

export type BundlePerson = 'default' | 's0028';
export interface PersonChunk {
  file: string;
  bytes: number;
  sha256: string;
  modules: string[];
  imports: string[];
  dynamicImports: string[];
}
export interface PersonBundleGraph {
  schema: 1;
  chunks: PersonChunk[];
  roots: string[];
  worker: string;
  worklet: string;
  preloads: string[];
  selections: Array<{ from: string; to: string; person: BundlePerson; importer: string; module: string }>;
}

export const PERSON_JS_CEILING = TOTAL_JS_BUDGET;
// Ambas conservan el techo de main: el margen liberado queda disponible para la anatomía default (322.3).
export const DEFAULT_JS_BUDGET = PERSON_JS_CEILING;
export const S0028_JS_BUDGET = PERSON_JS_CEILING;

export function measurePersonBundles(graph: PersonBundleGraph, limits = { default: DEFAULT_JS_BUDGET, s0028: S0028_JS_BUDGET }) {
  const chunks = new Map(graph.chunks.map((c) => [c.file, c]));
  if (chunks.size !== graph.chunks.length) throw new Error('Archivo JS duplicado');
  if (!graph.roots.includes(graph.worker) || !graph.roots.includes(graph.worklet)) throw new Error('Falta raíz Worker/worklet');
  for (const max of Object.values(limits)) if (max > PERSON_JS_CEILING) throw new Error('Techo de persona ampliado');
  const owners = new Map<string, string>();
  for (const chunk of chunks.values()) {
    if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes < 0) throw new Error('Tamaño JS inválido');
    for (const module of chunk.modules) {
      const previous = owners.get(module);
      if (previous) throw new Error(`CPU/módulo duplicado: ${module} en ${previous} y ${chunk.file}`);
      owners.set(module, chunk.file);
    }
    for (const edge of [...chunk.imports, ...chunk.dynamicImports])
      if (!chunks.has(edge)) throw new Error(`Arista JS desconocida: ${edge}`);
  }
  for (const edge of graph.selections) {
    const entry = edge.importer === 'src/anatomy/loadPerson.ts' ? 'runtime' : edge.importer === 'src/ui/cutMapWorker.ts' ? 'cpu' : null;
    if (
      !entry ||
      edge.module !== `src/anatomy/people/${edge.person}/${entry}.ts` ||
      !chunks.get(edge.from)?.modules.includes(edge.importer) ||
      !chunks.get(edge.to)?.modules.includes(edge.module) ||
      !chunks.get(edge.from)?.dynamicImports.includes(edge.to)
    )
      throw new Error('Selección no autorizada');
  }
  const reach = (person: BundlePerson, roots = [...graph.roots, ...graph.preloads]) => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      const chunk = chunks.get(file);
      if (!chunk) throw new Error(`Raíz JS desconocida: ${file}`);
      seen.add(file);
      chunk.imports.forEach(visit);
      chunk.dynamicImports
        .filter((target) => {
          const selection = graph.selections.find((s) => s.from === file && s.to === target);
          return !selection || selection.person === person;
        })
        .forEach(visit);
    };
    roots.forEach(visit);
    const files = [...seen].sort();
    if (person === 'default') {
      const privateModules = files.flatMap((f) => chunks.get(f)!.modules).filter((m) => /(?:^|\/)s0028|\/personShader\.ts$/.test(m));
      if (privateModules.length) throw new Error(`s0028 en default: ${privateModules.join(', ')}`);
    }
    const bytes = files.reduce((sum, file) => sum + chunks.get(file)!.bytes, 0);
    if (bytes > limits[person]) throw new Error(`${person}: ${bytes} B > ${limits[person]} B`);
    return { bytes, margin: limits[person] - bytes, ceiling: limits[person], files };
  };
  const result = { default: reach('default'), s0028: reach('s0028') };
  const worker = { default: reach('default', [graph.worker]), s0028: reach('s0028', [graph.worker]) };
  for (const person of ['default', 's0028'] as const) {
    const nonCpu = worker[person].files
      .flatMap((f) => chunks.get(f)!.modules)
      .filter((m) =>
        /(?:\.glsl\.ts$|\/personShader\.ts$|\/loadPinnedAsset\.ts$|\/people\/[^/]+\/(?:runtime|gpu|surfaces)\.ts$|node_modules\/three\/)/.test(
          m,
        ),
      );
    if (nonCpu.length) throw new Error(`Worker importa GPU/carga/vistas: ${nonCpu.join(', ')}`);
  }
  const union = new Set([...result.default.files, ...result.s0028.files]);
  const orphaned = [...chunks.keys()].filter((f) => !union.has(f));
  if (orphaned.length) throw new Error(`JS sin ruta: ${orphaned.join(', ')}`);
  return {
    ...result,
    worker,
    totalJsBytes: graph.chunks.reduce((n, c) => n + c.bytes, 0),
    sharedBytes: result.default.files.filter((f) => result.s0028.files.includes(f)).reduce((n, f) => n + chunks.get(f)!.bytes, 0),
  };
}
