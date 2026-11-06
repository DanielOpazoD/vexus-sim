import baseline from './fixtures/person-glsl-abi.json' with { type: 'json' };
import type { GlslMangleContext } from './glslMinify';

/** ABI capturada de main; el SHA de origen está en el artefacto. Este artefacto sólo se usa durante el build. */
export function personShaderAbi(context: GlslMangleContext): GlslMangleContext {
  const names = new Map<string, string>(baseline.names as [string, string][]);
  const afterDot = new Set(baseline.afterDot);
  const used = new Set(names.values());
  for (const value of used) {
    if (context.analysis.seen.has(value)) throw new Error(`Colisión con ABI GLSL fijada: ${value}`);
  }
  let index = 0;
  for (const name of [...context.map.names.keys()].sort()) {
    if (names.has(name)) continue;
    const value = `_p${(index++).toString(36)}`;
    if (used.has(value) || context.analysis.seen.has(value)) throw new Error(`Colisión en extensión GLSL: ${value}`);
    names.set(name, value);
    used.add(value);
    if (context.map.afterDot.has(name)) afterDot.add(name);
  }
  return { ...context, map: { names, afterDot } };
}

export function personBindingAbi(candidates: ReadonlyMap<string, string>, code: string): Map<string, string> {
  const names = new Map<string, string>(baseline.bindings as [string, string][]);
  let index = 0;
  for (const name of [...candidates.keys()].sort()) if (!names.has(name)) names.set(name, `_pu${(index++).toString(36)}`);
  for (const value of names.values()) if (new RegExp(`\\b${value}\\b`).test(code)) throw new Error(`Colisión de binding GLSL: ${value}`);
  return names;
}
