import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Todo el build, incluidos Workers/worklets fuera de assets. No cuenta mapas de fuentes. */
export function bundleAssets(root: string, prefix = ''): Array<{ file: string; size: number }> {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const file = join(prefix, name),
      st = statSync(join(root, file));
    return st.isDirectory() ? bundleAssets(root, file) : file.endsWith('.map') ? [] : [{ file, size: st.size }];
  });
}
