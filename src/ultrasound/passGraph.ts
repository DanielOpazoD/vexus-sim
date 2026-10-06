/**
 * Grafo de pasadas del modo B / color (Fase 2): qué lee y qué escribe cada pasada de
 * `UltrasoundRenderer.render`, declarado como datos. El renderer recorre esta tabla (no un
 * orden escrito a mano) y `passGraphErrors` comprueba que es un grafo válido: nadie lee un
 * recurso antes de que exista, nadie lo escribe dos veces, nadie lee una historia antes de que su
 * pasada la escriba en el cuadro y ninguna pasada trabaja para nadie. Las letras A–G y K son las de
 * ARCHITECTURE.md y de `shaders/passes.glsl.ts`.
 */

/** Recursos: texturas intermedias, historia de la persistencia y la pantalla. */
export type Resource =
  | 'scene'
  | 'coupling'
  | 'transHits'
  | 'transSeg'
  | 'transPrefix'
  | 'trans'
  | 'raw'
  | 'axial'
  | 'envLooks'
  | 'env'
  | 'colorRaw'
  | 'color'
  | 'scan'
  | 'persist'
  | 'screen';

export type PassId =
  | 'transmissionHits'
  | 'transmissionSegments'
  | 'transmissionPrefix'
  | 'transmission'
  | 'rawField'
  | 'axial'
  | 'lateral'
  | 'compound'
  | 'color'
  | 'colorFilter'
  | 'scanConvert'
  | 'persistence'
  | 'present';

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

/**
 * Recursos que existen antes de la primera pasada: escena, acoplamiento e historias: la de la persistencia
 * (ping-pong) y el anillo de miradas de la composición espacial (decisión 58), cuyas ranuras guardan las
 * envolventes de los cuadros anteriores.
 */
export const EXTERNAL_RESOURCES: readonly Resource[] = ['scene', 'coupling', 'persist', 'envLooks'];

export const FRAME_PASSES: readonly PassSpec[] = [
  // A en cuatro etapas (decisión 54): impactos por línea, segmentos, suma acumulada y apertura
  { id: 'transmissionHits', label: 'A0', reads: ['scene'], writes: 'transHits', cadence: 'frame' },
  { id: 'transmissionSegments', label: 'A1', reads: ['scene', 'transHits'], writes: 'transSeg', cadence: 'frame' },
  { id: 'transmissionPrefix', label: 'A2', reads: ['transSeg', 'transHits'], writes: 'transPrefix', cadence: 'frame' },
  { id: 'transmission', label: 'A', reads: ['transPrefix', 'transHits'], writes: 'trans', cadence: 'frame' },
  // B lee además la pleura parietal de A0 (decisión 61)
  { id: 'rawField', label: 'B', reads: ['scene', 'trans', 'transHits'], writes: 'raw', cadence: 'frame' },
  // C lee la transmisión hasta la pared para las réplicas de su reverberación (decisión 76)
  { id: 'axial', label: 'C', reads: ['raw', 'trans'], writes: 'axial', cadence: 'frame' },
  // D escribe la envolvente de la mirada del cuadro en su ranura del anillo; K compone las válidas (paso
  // directo exacto con una sola mirada: compuesto apagado). D lee de A la fracción del haz que sobrevive a los
  // huesos: bajo una costilla la línea no recibe lóbulos laterales (decisión 88)
  { id: 'lateral', label: 'D', reads: ['axial', 'trans'], writes: 'envLooks', cadence: 'frame' },
  { id: 'compound', label: 'K', reads: ['envLooks', 'transHits'], writes: 'env', cadence: 'frame' },
  { id: 'color', label: 'F', reads: ['scene', 'trans'], writes: 'colorRaw', cadence: 'color' },
  { id: 'colorFilter', label: 'F1', reads: ['colorRaw'], writes: 'color', cadence: 'color' },
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
  // una historia que escribe una pasada del cuadro solo la leen, además de ella misma (ping-pong), las
  // pasadas que van detrás: antes leerían la del cuadro anterior (K antes de D compondría miradas viejas)
  for (const r of external) {
    const w = passes.findIndex((p) => p.writes === r);
    if (w < 0) continue;
    for (const q of passes.slice(0, w))
      if (q.reads.includes(r)) errors.push(`${q.id} lee «${r}» antes de que ${passes[w].id} lo escriba en el cuadro`);
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
