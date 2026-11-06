import { describe, expect, it } from 'vitest';
import { assertLiteralImports } from '../../tools/build/literalImports';
import {
  DEFAULT_JS_BUDGET,
  measurePersonBundles,
  PERSON_JS_CEILING,
  S0028_JS_BUDGET,
  type PersonBundleGraph,
  type PersonChunk,
} from '../../tools/ci/personBundles';

function fixture(): PersonBundleGraph {
  const chunk = (file: string, bytes: number, modules: string[] = []): PersonChunk => ({
    file,
    bytes,
    modules,
    sha256: 'fixture',
    imports: [],
    dynamicImports: [],
  });
  return {
    schema: 1,
    roots: ['main.js', 'worker.js', 'worklet.js'],
    worker: 'worker.js',
    worklet: 'worklet.js',
    preloads: [],
    selections: [
      {
        from: 'main.js',
        to: 'current.js',
        person: 'default',
        importer: 'src/anatomy/loadPerson.ts',
        module: 'src/anatomy/people/default/runtime.ts',
      },
      {
        from: 'main.js',
        to: 'private.js',
        person: 's0028',
        importer: 'src/anatomy/loadPerson.ts',
        module: 'src/anatomy/people/s0028/runtime.ts',
      },
      { from: 'worker.js', to: 'cpu.js', person: 's0028', importer: 'src/ui/cutMapWorker.ts', module: 'src/anatomy/people/s0028/cpu.ts' },
    ],
    chunks: [
      { ...chunk('main.js', 10, ['src/main.ts', 'src/anatomy/loadPerson.ts']), dynamicImports: ['current.js', 'private.js', 'hooks.js'] },
      { ...chunk('worker.js', 2, ['src/ui/cutMapWorker.ts']), dynamicImports: ['cpu.js'] },
      chunk('worklet.js', 1),
      { ...chunk('current.js', 20, ['src/anatomy/people/default/runtime.ts']) },
      { ...chunk('private.js', 30, ['src/anatomy/people/s0028/runtime.ts']), imports: ['cpu.js'] },
      { ...chunk('cpu.js', 40, ['src/anatomy/people/s0028/cpu.ts']) },
      chunk('hooks.js', 3, ['src/app/testHooks.ts']),
    ],
  };
}

describe('clausuras completas por persona', () => {
  it('rechaza import() computados que no pueden entrar en la clausura', () => {
    expect(() => assertLiteralImports('const load = () => import(path)', 'src/load.ts')).toThrow('Import dinámico no resoluble');
    expect(() => assertLiteralImports('const load = () => import(`./people/${person}/cpu`)', 'src/load.ts')).toThrow(
      'Import dinámico no resoluble',
    );
    expect(() => assertLiteralImports("const load = () => import('./people/s0028/cpu')", 'src/load.ts')).not.toThrow();
  });
  it('cuenta diferidos, hooks, Worker, worklet y CPU compartida una vez por ruta', () => {
    const result = measurePersonBundles(fixture());
    expect(result.default.bytes).toBe(36);
    expect(result.s0028.bytes).toBe(86);
    expect(result.totalJsBytes).toBe(106);
  });
  it('conserva el techo JS de main para las dos personas', () => {
    expect(DEFAULT_JS_BUDGET).toBe(1_070_080);
    expect(S0028_JS_BUDGET).toBe(1_070_080);
    expect(PERSON_JS_CEILING).toBe(1_070_080);
  });
  it.each(['default', 's0028'] as const)('acepta el techo de main y rechaza +1 B en %s', (person) => {
    const g = fixture();
    const ceiling = 1_070_080;
    const chunk = g.chunks.find((c) => c.file === (person === 'default' ? 'current.js' : 'private.js'))!;
    chunk.bytes += ceiling - (person === 'default' ? 36 : 86);
    expect(measurePersonBundles(g)[person]).toMatchObject({ bytes: ceiling, ceiling, margin: 0 });
    chunk.bytes += 1;
    expect(() => measurePersonBundles(g)).toThrow(`${person}: ${ceiling + 1} B`);
  });
  it.each(['worker.js', 'worklet.js'])('rechaza omitir %s', (file) => {
    const g = fixture();
    g.roots = g.roots.filter((f) => f !== file);
    expect(() => measurePersonBundles(g)).toThrow('Falta raíz Worker/worklet');
  });
  it.each(['barrel', 'hook', 'dynamic-hook', 'preload'])('detecta la fuga por %s incluso al renombrar el chunk', (kind) => {
    const g = fixture();
    const old = 'private.js',
      renamed = 'totally-generic.js';
    g.chunks.find((c) => c.file === old)!.file = renamed;
    g.chunks.forEach((c) => {
      c.imports = c.imports.map((s) => (s === old ? renamed : s));
      c.dynamicImports = c.dynamicImports.map((s) => (s === old ? renamed : s));
    });
    g.selections.forEach((s) => {
      if (s.to === old) s.to = renamed;
    });
    if (kind === 'preload') g.preloads.push(renamed);
    else if (kind === 'dynamic-hook') g.chunks.find((c) => c.file === 'hooks.js')!.dynamicImports.push(renamed);
    else g.chunks.find((c) => c.file === (kind === 'hook' ? 'hooks.js' : 'main.js'))!.imports.push(renamed);
    expect(() => measurePersonBundles(g)).toThrow('s0028 en default');
  });
  it('rechaza JS huérfano, aristas desconocidas y duplicar CPU entre página/Worker', () => {
    const g = fixture();
    g.chunks.push({ ...g.chunks[2], file: 'orphan.js' });
    expect(() => measurePersonBundles(g)).toThrow('JS sin ruta');
    g.chunks.pop();
    g.chunks[0].imports.push('unknown.js');
    expect(() => measurePersonBundles(g)).toThrow('Arista JS desconocida');
    g.chunks[0].imports.pop();
    g.chunks[0].modules.push('src/anatomy/people/s0028/cpu.ts');
    expect(() => measurePersonBundles(g)).toThrow('CPU/módulo duplicado');
  });
  it.each(['default', 's0028'] as const)('no permite ampliar el techo %s', (person) => {
    const limits = { default: PERSON_JS_CEILING, s0028: PERSON_JS_CEILING };
    limits[person] += 1;
    expect(() => measurePersonBundles(fixture(), limits)).toThrow('Techo de persona ampliado');
  });
  it('rechaza una dependencia GPU en la entrada CPU del Worker', () => {
    const g = fixture();
    g.chunks.find((c) => c.file === 'cpu.js')!.modules.push('src/anatomy/people/s0028/gpu.ts');
    expect(() => measurePersonBundles(g)).toThrow('Worker importa GPU/carga/vistas');
  });
});
