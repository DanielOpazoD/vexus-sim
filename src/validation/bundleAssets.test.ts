import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { bundleAssets } from '../../tools/ci/bundleAssets';
it('cuenta el worklet raíz y los assets anidados una sola vez; excluye sourcemaps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vexus-assets-'));
  try {
    mkdirSync(join(dir, 'assets', 'workers'), { recursive: true });
    writeFileSync(join(dir, 'doppler-worklet.js'), '12345');
    writeFileSync(join(dir, 'assets', 'main.js'), '123');
    writeFileSync(join(dir, 'assets', 'workers', 'one.js'), '12');
    writeFileSync(join(dir, 'assets', 'main.js.map'), 'not a shipped runtime');
    const files = bundleAssets(dir);
    expect(files.map((f) => f.file).sort()).toEqual(['assets/main.js', 'assets/workers/one.js', 'doppler-worklet.js']);
    expect(files.reduce((s, f) => s + f.size, 0)).toBe(10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
