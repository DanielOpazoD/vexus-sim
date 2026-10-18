import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { feedbackFingerprint, feedbackGitEnvironment } from '../workspace/feedbackPlan';

export const provenanceFile = 'vexus-build.json';
export type BuildSource = ReturnType<typeof buildSource>;
export interface BuildProvenance {
  schema: 1;
  createdAt: string;
  source: BuildSource;
  files: ReturnType<typeof buildFiles>;
}

/** HEAD solo no distingue dos ediciones sin commit; el índice y sus cambios también cuentan. */
export function buildSource(root: string, outputs: string[]) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: feedbackGitEnvironment() }).trim();
  return {
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    fingerprint: feedbackFingerprint(root, outputs),
  };
}

/** Incluye HTML, workers, CSS y recursos públicos; no sigue enlaces fuera del build. */
export function buildFiles(out: string, directory = out): { path: string; bytes: number; sha256: string }[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const file = join(directory, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`Enlace inesperado en el build: ${file}`);
      if (stat.isDirectory()) return buildFiles(out, file);
      if (!stat.isFile()) throw new Error(`Recurso no regular en el build: ${file}`);
      if (file === join(out, provenanceFile)) return [];
      const bytes = readFileSync(file);
      return [
        {
          path: file.slice(out.length + 1).replaceAll('\\', '/'),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ];
    });
}

/** Recibo local de procedencia, sin entrar en el JS de la aplicación ni acreditar aceptación. */
export function buildProvenance(): Plugin {
  let root: string, out: string, outputs: string[], source: BuildSource | undefined;
  return {
    name: 'build-provenance',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      out = resolve(root, config.build.outDir);
      outputs = [out, ...(process.env.VEXUS_RUN_DIR ? [resolve(process.env.VEXUS_RUN_DIR)] : [])];
    },
    buildStart() {
      source = buildSource(root, outputs);
      rmSync(join(out, provenanceFile), { force: true });
    },
    writeBundle() {
      if (!source) throw new Error('Falta la fuente del build');
      deepStrictEqual(buildSource(root, outputs), source, 'La fuente cambió durante el build; vuelve a construir');
      const files = buildFiles(out);
      if (!files.some((file) => file.path === 'index.html')) throw new Error('Build incompleto: falta index.html');
      const receipt: BuildProvenance = { schema: 1, createdAt: new Date().toISOString(), source, files };
      writeFileSync(join(out, provenanceFile), JSON.stringify(receipt, null, 2) + '\n');
    },
  };
}
