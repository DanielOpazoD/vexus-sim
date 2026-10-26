/** Back references within one static fragment; never cross a dynamic interpolation. */
export function packBackrefs(source: string): string {
  if (source.includes('`')) throw new Error('Reserved GLSL transport marker');
  const seen = new Map<string, number[]>();
  let out = '';
  for (let i = 0; i < source.length;) {
    let best = 0;
    let at = 0;
    for (const j of (seen.get(source.slice(i, i + 8)) ?? []).slice(-24)) {
      let n = 8;
      while (n < Math.min(i - j, 256, source.length - i) && source[i + n] === source[j + n]) n++;
      if (n <= i - j && n > best) {
        best = n;
        at = j;
      }
    }
    const token = '`' + (i - at).toString(36) + ',' + best.toString(36) + ';';
    const count = best > token.length + 2 ? best : 1;
    out += count > 1 ? token : source[i];
    for (let k = 0; k < count; k++) {
      const key = source.slice(i + k, i + k + 8);
      let entries = seen.get(key);
      if (!entries) seen.set(key, (entries = []));
      entries.push(i + k);
    }
    i += count;
  }
  return out;
}
