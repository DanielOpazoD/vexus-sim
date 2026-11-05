import type { MutantManifest } from '../manifest';

/** Pared continua s0028 (P2): mapa E, cara del contacto y rampas U de la respiración. */
export const s0028Wall: MutantManifest = {
  module: 'src/anatomy/s0028Wall.ts',
  mutants: [
    {
      name: 'U-sin-E-en-contacto',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'El contacto usa la cara de la clasificación en vez del mapa E: una celda U con E pierde su cara y su compresión.',
      from: '  return insideCore(p[0], p[1], p[2], null, true);\n}',
      to: '  return insideCore(p[0], p[1], p[2], null, false);\n}',
      tests: ['src/validation/s0028UContact.test.ts'],
    },
    {
      name: 'E-rotulado-D',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'La cara de contacto de una celda U con E se rotula «D/E»: su procedencia E deja de declararse.',
      from: "source: s0028InsideWall(p) === null ? 'E' : 'D/E'",
      to: "source: 'D/E'",
      tests: ['src/validation/s0028UContact.test.ts'],
    },
    {
      name: 'E-tratado-como-D-en-clasificacion',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'La clasificación toma la cara E del contacto como si fuera D: una celda U deja de ser U en tejido, cara y respiración.',
      from: '  return insideCore(p[0], p[1], p[2], null, false);\n}\n\n/** Profundidad y fila',
      to: '  return insideCore(p[0], p[1], p[2], null, true);\n}\n\n/** Profundidad y fila',
      tests: ['src/validation/s0028UContact.test.ts', 'src/validation/s0028WallRuntime.test.ts'],
    },
    {
      name: 'rampa-U-nula-CPU',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'Peso respiratorio 0 en las celdas U en vez de la rampa p10/p90 de su fila: órganos quietos bajo U.',
      from: '  if (inside !== null) return smoothstep(0, 25, inside);\n  const r = buffers.ramps,',
      to: '  if (inside !== null) return smoothstep(0, 25, inside);\n  if (inside === null) return 0;\n  const r = buffers.ramps,',
      tests: ['src/validation/s0028UContact.test.ts'],
    },
    {
      name: 'mapa-E-sin-verificar',
      origin: 'P2 r2b-U (decisión 320)',
      breaks: 'La carga acepta un mapa E cuyo nodo apunta a la cara de otro nodo.',
      from: "      if (e !== nodeWord(r, c, 0)) throw new Error('Mapa E con otra cara');",
      to: '',
      tests: ['src/validation/s0028UContact.test.ts'],
    },
  ],
};
