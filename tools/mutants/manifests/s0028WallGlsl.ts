import type { MutantManifest } from '../manifest';

/** Gemelo GLSL de la pared s0028 (P2). Sólo mutantes que detectan pruebas CPU o estáticas. */
export const s0028WallGlsl: MutantManifest = {
  module: 'src/anatomy/gpu/s0028Wall.glsl.ts',
  mutants: [
    {
      name: 'busqueda-GPU-en-bucle',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'Un bucle GLSL en la lectura de la rampa (crecimiento que el JIT de SwiftShader no soporta) y una rampa distinta de la CPU.',
      from: 'vec2 s28Ramp(float row){\n',
      to: 'vec2 s28Ramp(float row){\n  for(int k=-8;k<=8;k++){vec4 o,i,e;vec2 f;vec4 b=s28WallSurface(vec2(0.0,row+float(k)),o,i,e,f);if(b.w>=0.0)return b.zz;}\n',
      tests: ['src/validation/s0028WallGpu.test.ts', 'src/validation/shaderLimits.test.ts'],
    },
    {
      name: 'rampa-U-nula-GPU',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'La GPU pesa la celda U con 0 en vez de su rampa: el gemelo GLSL deja de coincidir con la CPU.',
      from: '  vec2 r=s28Ramp(rc.y);\n  return smoothstep(r.x,r.y,-depth);',
      to: '  return 0.0;',
      tests: ['src/validation/s0028WallGpu.test.ts', 'src/validation/shaderLimits.test.ts'],
    },
  ],
};
