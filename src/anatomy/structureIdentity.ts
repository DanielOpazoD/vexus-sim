import { Interface } from './interfaces';
import { Tissue } from './tissues';
import type { AnatomyScene } from './scene';
import type { Vec3 } from '../core/vec3';

/** Identidad de guía del modelo; no añade tejidos ni modifica su clasificación. */
export const STRUCTURE_LABELS = ['', 'Hígado', 'Riñón derecho', 'Riñón izquierdo', 'Vesícula biliar'] as const;

export function structureIdentity(p: Vec3, tissue: Tissue, iface: Interface, scene: AnatomyScene): number {
  if (tissue === Tissue.Liver || tissue === Tissue.LiverCapsule) return 1;
  if ([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule, Tissue.RenalPelvis].includes(tissue)) {
    const d = (center: Vec3) => center.reduce((sum, value, i) => sum + (value - p[i]) ** 2, 0);
    return d(scene.kidneyRight.center) <= d(scene.kidneyLeft.center) ? 2 : 3;
  }
  if (iface === Interface.GallbladderLumen) return 4;
  return 0;
}
