import { createHash } from 'node:crypto';

// Three 0.186.1. A dependency update requires re-auditing the registries and consumers;
// a changed source must fail instead of silently losing a material or an include.
const REGISTRIES = {
  'ShaderLib.js': '3e743420bd5d20eb1372786908a001dec8ef3bf62f479eeb283cf38bd5b1376e',
  'ShaderChunk.js': '471f53cd38f3d86889f534a25b1829643db475e968627f5528d2a254a189eaae',
} as const;

const UNUSED_FAMILIES = [
  ['lambert', 'meshlambert'],
  ['phong', 'meshphong'],
  ['toon', 'meshtoon'],
  ['matcap', 'meshmatcap'],
  ['points', 'points'],
  ['dashed', 'linedashed'],
  ['normal', 'meshnormal'],
  ['shadow', 'shadow'],
] as const;

function removeExactlyOnce(code: string, pattern: RegExp): string {
  const matches = [...code.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Three registry: expected one match for ${pattern}, got ${matches.length}`);
  return code.replace(pattern, '');
}

/** Only top-level programs with no application consumer; no GLSL body or shared include is edited. */
export function pruneThreeShaderRegistry(code: string, id: string): string | null {
  const match = /\/node_modules\/three\/src\/renderers\/shaders\/(ShaderLib\.js|ShaderChunk\.js)$/.exec(id.replaceAll('\\', '/'));
  if (!match) return null;
  const file = match[1] as keyof typeof REGISTRIES;
  if (createHash('sha256').update(code).digest('hex') !== REGISTRIES[file])
    throw new Error(`Three 0.186.1 registry changed: ${file}; review shader consumers before updating its contract`);
  let out = code;
  for (const [family, module] of UNUSED_FAMILIES) {
    if (file === 'ShaderLib.js') {
      // Exact upstream hash bounds this indentation-specific edit. Inner object closes use two tabs.
      out = removeExactlyOnce(out, new RegExp(`^\\t${family}: \\{[\\s\\S]*?^\\t\\},?\\n`, 'gm'));
    } else {
      out = removeExactlyOnce(out, new RegExp(`^import \\* as ${module} from '\\./ShaderLib/${module}\\.glsl\\.js';\\n`, 'gm'));
      for (const [suffix, exported] of [
        ['vert', 'vertex'],
        ['frag', 'fragment'],
      ] as const)
        out = removeExactlyOnce(out, new RegExp(`^\\t${module}_${suffix}: ${module}\\.${exported},?\\n`, 'gm'));
    }
  }
  return out;
}
