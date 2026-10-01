import type { Plugin } from 'vite';

/** Lossless nibble encoding of the immutable triangle lookup table, not geometry simplification. */
export function compactMarchingTable(code: string): string {
  const pattern = /const triTable = new Int32Array\(\s*\[([\s\S]*?)\]\s*\);/;
  const match = pattern.exec(code);
  if (!match) throw new Error('MarchingCubes table layout changed');
  const values = match[1].split(',').map((n) => Number(n.replaceAll(' ', '').trim()));
  if (values.length !== 4096 || values.some((n) => !Number.isInteger(n) || n < -1 || n > 11))
    throw new Error('MarchingCubes table domain changed');
  const bytes = Buffer.alloc(values.length / 2);
  for (let i = 0; i < values.length; i += 2) bytes[i / 2] = (values[i] + 1) | ((values[i + 1] + 1) << 4);
  const replacement = `const triangleBytes = atob('${bytes.toString('base64')}');\nconst triTable = Int32Array.from({length:${values.length}},(_,i)=>((triangleBytes.charCodeAt(i>>1)>>((i&1)*4))&15)-1);`;
  return code.replace(pattern, replacement);
}
export function marchingTable(): Plugin {
  return {
    name: 'marching-table',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules\/three\/examples\/jsm\/objects\/MarchingCubes\.js$/.test(id.replaceAll('\\', '/'))) return null;
      return { code: compactMarchingTable(code), map: null };
    },
  };
}
