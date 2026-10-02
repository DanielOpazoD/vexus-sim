/** Lossless transport dictionary. Decoding happens once while shader modules initialize. */
export const GLSL_WORDS = [
  'float',
  'return',
  'vec3',
  'uniform',
  'vec2',
  'vec4',
  'const',
  'normalize',
  'length',
  'texture',
  'clamp',
  'smoothstep',
  'sampler2D',
  'precision',
  'highp',
  'inversesqrt',
] as const;
export function unpackGlsl(s: string): string {
  return s.replace(/@([A-P])/g, (_, c: string) => GLSL_WORDS[c.charCodeAt(0) - 65]);
}
