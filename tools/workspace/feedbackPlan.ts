import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Incluye cambios confirmados, preparados, sin preparar y archivos nuevos; nunca usa la shell. */
export function feedbackFiles(root: string, base: string, explicit: string[]): string[] {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  if (base.startsWith('-')) throw new Error('La base debe ser una revisión Git');
  const inputs = explicit.length
    ? explicit
    : [...git('diff', '--name-only', '-z', base, '--'), ...git('ls-files', '--others', '--exclude-standard', '-z')];
  return [
    ...new Set(
      inputs.map((file) => {
        const name = relative(root, resolve(root, file)).replaceAll('\\', '/');
        if (
          !name ||
          isAbsolute(name) ||
          name === '..' ||
          name.startsWith('../') ||
          name.startsWith('-') ||
          /^(\.git|node_modules|dist|coverage|\.cache|\.validation)(\/|$)/.test(name)
        )
          throw new Error(`Elige archivos fuente dentro del checkout: ${file}`);
        if (existsSync(resolve(root, name)) && !statSync(resolve(root, name)).isFile()) throw new Error(`Se requiere un archivo: ${file}`);
        return name;
      }),
    ),
  ].sort();
}

/** Detecta también una segunda edición de un archivo que ya estaba marcado M. No es una caché. */
export function feedbackFingerprint(root: string, output: string): string {
  const hash = createHash('sha256');
  hash.update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root }));
  const files = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const file of files) {
    const absolute = resolve(root, file);
    if (absolute === output || absolute.startsWith(output + '/')) continue;
    hash.update(file + '\0');
    hash.update(lstatSync(absolute).isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute));
  }
  return hash.digest('hex');
}

export function feedbackPlan(root: string, files: string[], allFast = false) {
  if (!files.length && !allFast) throw new Error('No hay cambios; indica archivos, --base <ref> o --all-fast');
  const existing = files.filter((file) => existsSync(resolve(root, file)));
  const staticOnly = files.length > 0 && files.every((file) => /\.md$/.test(file) || file.startsWith('docs/'));
  const direct = existing.length > 0 && existing.length === files.length && existing.every((file) => file.endsWith('.test.ts'));
  const broad = files.some((file) =>
    /^(tools\/|e2e\/|\.github\/|\.githooks\/|src\/ui\/|src\/bootstrap\.ts|src\/ultrasound\/(renderer|shaders)|[^/]+$)/.test(file),
  );
  const mode = allFast ? 'fast' : staticOnly ? 'docs' : direct ? 'tests' : broad || existing.length !== files.length ? 'fast' : 'related';
  const slow =
    mode === 'tests' && existing.some((file) => readFileSync(resolve(root, file), 'utf8').split('\n')[0].trim() === '// @tier slow');
  return {
    mode,
    existing,
    slow,
    browserNotRun: files.some((file) => /^(src\/|e2e\/|public\/)/.test(file)),
    docsIndex: files.some((file) => /docs\/DECISIONS(_INDEX)?\.md$/.test(file)),
  };
}
