import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

export function e2eOptions(args: string[], root: string, platform = process.platform) {
  const separator = args.indexOf('--');
  const own = separator < 0 ? args : args.slice(0, separator);
  const tests = separator < 0 ? [] : args.slice(separator + 1);
  const { values } = parseArgs({
    args: own,
    options: { backend: { type: 'string' }, url: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) return { help: true } as const;
  if (values.backend !== 'metal' && values.backend !== 'swiftshader') throw new Error('--backend debe ser metal o swiftshader');
  if (values.backend === 'metal' && platform !== 'darwin') throw new Error('El perfil Metal requiere macOS');
  if (!values.out) throw new Error('--out debe indicar una carpeta nueva para conservar cada ejecución');
  const url = new URL(values.url ?? 'http://127.0.0.1:6609');
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('--url debe ser un origen HTTP local, sin credenciales, ruta ni consulta');
  const fixed = [
    '--config',
    '-c',
    '--workers',
    '-j',
    '--retries',
    '--timeout',
    '--debug',
    '--ui',
    '--update-snapshots',
    '-u',
    '--reporter',
    '--output',
    '-o',
    '--trace',
  ];
  if (
    tests.some((arg) =>
      fixed.some((flag) => arg === flag || arg.startsWith(`${flag}=`) || (['-c', '-j', '-u', '-o'].includes(flag) && arg.startsWith(flag))),
    )
  )
    throw new Error('Este perfil fija config, trabajador, reintentos, plazos y referencias; no se pueden sobrescribir');
  return {
    help: false,
    backend: values.backend,
    url: url.origin,
    external: values.url !== undefined,
    out: resolve(root, values.out),
    tests,
  } as const;
}
