/**
 * Mutantes reproducibles (decisión 322, punto 8). Uso: `npm run mutants -- [--module X] [--only a,b] [--out carpeta]`;
 * `--list` sólo lee. Focales con un trabajador y `nice`. Salida: 0 todos muertos; 1 alguno sobrevive; 2 error,
 * interrupción o caída. La lógica está en `cli.ts` (probada con un repositorio temporal) y `runner.ts`.
 */
import { resolve } from 'node:path';
import { mutantsCli, vitestRunTests } from './cli';
import { MANIFESTS } from './manifests';

const root = resolve(import.meta.dirname, '../..');
mutantsCli(process.argv.slice(2), { root, manifests: MANIFESTS, makeRunTests: vitestRunTests(root) }).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
