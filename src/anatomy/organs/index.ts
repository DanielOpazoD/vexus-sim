import * as liverLigaments from './liverLigaments';
import * as lungCurtain from './lungCurtain';

/**
 * Registro de módulos de órgano (decisión 46). Cada módulo reúne en UN archivo la geometría,
 * sus funciones TS y su gemelo GLSL (mismos nombres); `ANATOMY_GLSL` incluye todos los gemelos.
 * `organs.test.ts` exige que cada función GLSL tenga su gemela TS exportada con el mismo nombre.
 * Migración progresiva: vesícula, riñón, hígado y tubos siguen en `scene.ts`/`primitives.ts`.
 */
export interface OrganModule {
  id: string;
  /** Exportaciones TS del módulo (para comprobar los gemelos por nombre). */
  exports: Record<string, unknown>;
  glsl: string;
}

export const ORGAN_MODULES: readonly OrganModule[] = [
  { id: 'liverLigaments', exports: liverLigaments, glsl: liverLigaments.LIVER_LIGAMENTS_GLSL },
  { id: 'lungCurtain', exports: lungCurtain, glsl: lungCurtain.LUNG_CURTAIN_GLSL },
];
