/** Build-stage dictionary candidates; estimates are not final tree-shaken bundle savings. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GLSL_WORDS } from '../../src/core/glslPacking';
import { findGlslTemplates, prepareGlslMangle, readSources, transformWithMangle } from './glslMinify';
import { bindingNames, compactBindings } from './glslUniformNames';
import { threeGlslCompact } from './threeGlslCompact';
const root = process.cwd();
const sources = readSources(join(root, 'src'));
const ctx = prepareGlslMangle(sources);
const bindings = bindingNames(sources.map((s) => s.code).join('\n'));
const counts = new Map<string, number>();
const baseSize = Number(process.argv[2] ?? GLSL_WORDS.length);
if (!Number.isInteger(baseSize) || baseSize < 0 || baseSize > GLSL_WORDS.length) throw new RangeError('Invalid base dictionary size');
const existing = new Set<string>(GLSL_WORDS.slice(0, baseSize));
const count = (code: string) => {
  for (const template of findGlslTemplates(code))
    for (const raw of template.statics) {
      if (/[\\@`]/.test(raw)) continue;
      for (const word of raw.match(/\b[A-Za-z_]\w*\b/g) ?? []) {
        if (word.length > 3 && !existing.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
};
for (const { path, code } of sources) count(compactBindings(transformWithMangle(code, path, ctx, { compact: true }), bindings));
const vendor = threeGlslCompact();
(vendor.configResolved as (config: { root: string }) => void)({ root });
(vendor.buildStart as () => void)();
const transform = vendor.transform as (code: string, id: string) => { code: string };
for (const folder of ['ShaderChunk', 'ShaderLib']) {
  const dir = join(root, 'node_modules/three/src/renderers/shaders', folder);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.glsl.js'))) {
    const id = join(dir, name);
    count(transform(readFileSync(id, 'utf8'), id).code);
  }
}
const candidates = [...counts]
  .map(([word, count]) => ({ word, count, saving: (word.length - 3) * count - word.length - 3 }))
  .filter((x) => x.saving > 0)
  .sort((a, b) => b.saving - a.saving || a.word.localeCompare(b.word));
console.log(JSON.stringify(candidates.slice(0, 64), null, 2));
