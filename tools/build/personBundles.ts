import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { measurePersonBundles, type PersonBundleGraph, type PersonChunk } from '../ci/personBundles';
import { assertLiteralImports } from './literalImports';

/** Reports the emitted graph, not guessed chunk names or source-module byte estimates. */
export function personBundles(): Plugin {
  let root = '',
    out = '';
  let graph: PersonBundleGraph | undefined;
  return {
    name: 'person-bundle-provenance',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      out = resolve(root, config.build.outDir);
    },
    transform(code, id) {
      const module = relative(root, id).replaceAll('\\', '/');
      if (module.startsWith('src/') && /\.[cm]?[jt]sx?$/.test(module)) assertLiteralImports(code, id);
      return null;
    },
    generateBundle(_options, bundle) {
      const chunks: PersonChunk[] = [];
      const owners = new Map<string, string>();
      const normalize = (id: string) => relative(root, id).replaceAll('\\', '/');
      const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const modules = Object.keys(output.modules).map(normalize).sort();
        for (const module of modules) owners.set(module, output.fileName);
        chunks.push({
          file: output.fileName,
          bytes: Buffer.byteLength(output.code),
          sha256: hash(output.code),
          modules,
          imports: output.imports,
          dynamicImports: output.dynamicImports,
        });
      }
      const worker = owners.get('src/ui/cutMapWorker.ts');
      const main = owners.get('src/main.ts');
      if (!worker || !main) throw new Error('Raíces de persona ausentes');
      const worklet = 'doppler-worklet.js';
      const workletBytes = readFileSync(join(root, 'public', worklet));
      chunks.push({
        file: worklet,
        bytes: workletBytes.length,
        sha256: hash(workletBytes),
        modules: ['public/doppler-worklet.js'],
        imports: [],
        dynamicImports: [],
      });
      graph = { schema: 1, chunks, roots: [main, worker, worklet], worker, worklet, preloads: [], selections: [] };
      for (const [importer, entry] of [
        ['src/anatomy/loadPerson.ts', 'runtime'],
        ['src/ui/cutMapWorker.ts', 'cpu'],
      ] as const) {
        for (const person of ['default', 's0028'] as const) {
          const module = `src/anatomy/people/${person}/${entry}.ts`;
          const from = owners.get(importer),
            to = owners.get(module);
          if (!from || !to || !chunks.find((c) => c.file === from)!.dynamicImports.includes(to))
            throw new Error(`Arista de selección ausente: ${importer} → ${module}`);
          const info = this.getModuleInfo(join(root, importer));
          if (!info?.dynamicallyImportedIds.some((id) => normalize(id) === module))
            throw new Error(`Import de selección no observado: ${module}`);
          graph.selections.push({ from, to, person, importer, module });
        }
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.html')) continue;
        const html = String(output.source);
        for (const tag of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/g)) {
          const href = tag[0].match(/\bhref=["']([^"']+)["']/)?.[1];
          if (href) graph.preloads.push(href.replace(/^\//, ''));
        }
      }
    },
    // Rolldown adds sourcemap URLs after generateBundle. Count the final bytes on disk,
    // before the provenance writer hashes these reports. The gate checks them again.
    writeBundle: {
      order: 'pre',
      sequential: true,
      handler() {
        if (!graph) throw new Error('Grafo de persona ausente');
        const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
        for (const chunk of graph.chunks) {
          const bytes = readFileSync(join(out, chunk.file));
          chunk.bytes = bytes.length;
          chunk.sha256 = hash(bytes);
        }
        writeFileSync(join(out, 'person-bundle-graph.json'), JSON.stringify(graph, null, 2) + '\n');
        const graphSha256 = hash(JSON.stringify(graph));
        let report;
        try {
          report = { graphSha256, ...measurePersonBundles(graph) };
        } catch (error) {
          report = { graphSha256, error: error instanceof Error ? error.message : String(error) };
        }
        writeFileSync(join(out, 'person-bundle-report.json'), JSON.stringify(report, null, 2) + '\n');
      },
    },
  };
}
