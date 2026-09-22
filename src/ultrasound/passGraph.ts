/**
 * Grafo de pasadas del modo B / color (Fase 2): qué lee y qué escribe cada pasada de
 * `UltrasoundRenderer.render`, declarado como datos. El renderer recorre esta tabla (no un
 * orden escrito a mano) y `passGraphErrors` comprueba que es un grafo válido: nadie lee un
 * recurso antes de que exista, nadie lo escribe dos veces y ninguna pasada trabaja para nadie.
 * Las letras A–G son las de ARCHITECTURE.md y de `shaders/passes.glsl.ts`.
 */

/** Recursos: texturas intermedias, historia de la persistencia y la pantalla. */
export type Resource = 'scene' | 'coupling' | 'trans' | 'raw' | 'axial' | 'env' | 'color' | 'scan' | 'persist' | 'screen';

export type PassId = 'transmission' | 'rawField' | 'axial' | 'lateral' | 'color' | 'scanConvert' | 'persistence' | 'present';

export interface PassSpec {
  id: PassId;
  /** Letra de la pasada en la documentación. */
  label: string;
  reads: readonly Resource[];
  writes: Resource;
  /**
   * `frame`: cada cuadro. `color`: a la cadencia física del color (decisión 39); su salida
   * persiste entre cuadros, así que quien la lea puede ver la del cuadro anterior.
   */
  cadence: 'frame' | 'color';
}

/** Recursos que existen antes de la primera pasada: escena, acoplamiento e historia (ping-pong). */
export const EXTERNAL_RESOURCES: readonly Resource[] = ['scene', 'coupling', 'persist'];

export const FRAME_PASSES: readonly PassSpec[] = [
  { id: 'transmission', label: 'A', reads: ['scene', 'coupling'], writes: 'trans', cadence: 'frame' },
  { id: 'rawField', label: 'B', reads: ['scene', 'trans'], writes: 'raw', cadence: 'frame' },
  { id: 'axial', label: 'C', reads: ['raw'], writes: 'axial', cadence: 'frame' },
  { id: 'lateral', label: 'D', reads: ['axial'], writes: 'env', cadence: 'frame' },
  { id: 'color', label: 'F', reads: ['scene', 'trans'], writes: 'color', cadence: 'color' },
  { id: 'scanConvert', label: 'G', reads: ['env', 'color'], writes: 'scan', cadence: 'frame' },
  { id: 'persistence', label: 'P', reads: ['scan', 'persist'], writes: 'persist', cadence: 'frame' },
  { id: 'present', label: 'S', reads: ['persist'], writes: 'screen', cadence: 'frame' },
];

/** Errores del grafo (vacío si es válido). */
export function passGraphErrors(passes: readonly PassSpec[], external: readonly Resource[] = EXTERNAL_RESOURCES): string[] {
  const errors: string[] = [];
  const ids = new Set<PassId>();
  const available = new Set<Resource>(external);
  const writer = new Map<Resource, PassId>();
  // las salidas de cadencia propia persisten del cuadro anterior: legibles desde el principio
  for (const p of passes) if (p.cadence !== 'frame') available.add(p.writes);
  for (const p of passes) {
    if (ids.has(p.id)) errors.push(`pasada repetida: ${p.id}`);
    ids.add(p.id);
    for (const r of p.reads) if (!available.has(r)) errors.push(`${p.id} lee «${r}» antes de que ninguna pasada lo escriba`);
    const prev = writer.get(p.writes);
    // la historia (ping-pong) se lee y se escribe; cualquier otro recurso tiene un único escritor
    if (prev && !external.includes(p.writes)) errors.push(`«${p.writes}» lo escriben ${prev} y ${p.id}`);
    writer.set(p.writes, p.id);
    available.add(p.writes);
  }
  for (const p of passes) {
    if (p.writes === 'screen') continue;
    const later = passes.slice(passes.indexOf(p) + 1).some((q) => q.reads.includes(p.writes));
    const earlierHistory = external.includes(p.writes) && passes.some((q) => q !== p && q.reads.includes(p.writes));
    if (!later && !earlierHistory) errors.push(`nadie lee lo que escribe ${p.id} («${p.writes}»)`);
  }
  if (!passes.some((p) => p.writes === 'screen')) errors.push('ninguna pasada escribe en pantalla');
  return errors;
}
