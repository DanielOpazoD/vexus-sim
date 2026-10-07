import { abdominalAtlasSdf, abdominalAtlasValue } from './abdominalAtlas';
import { Interface } from './interfaces';
import { Tissue } from './tissues';
import type { Vec3 } from '../core/vec3';

/** Stable anatomical regions, separate from the acoustic tissue and vascular identity. */
export const STRUCTURE_LABELS = [
  '',
  'Hígado',
  'Riñón derecho',
  'Riñón izquierdo',
  'Vesícula biliar',
  'Páncreas',
  'Bazo',
  'Vejiga',
  'Estómago',
  'Duodeno',
  'Yeyuno',
  'Íleon',
  'Ciego',
  'Colon ascendente',
  'Colon transverso',
  'Colon descendente / distal',
  'Recto',
] as const;

export function structureIdentity(p: Vec3, tissue: Tissue, iface: Interface, atlas: boolean): number {
  if (tissue === Tissue.Liver || tissue === Tissue.LiverCapsule) return 1;
  if ([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule, Tissue.RenalPelvis].includes(tissue))
    return p[0] < 0 ? 2 : 3;
  if (iface === Interface.GallbladderLumen) return 4;
  if (tissue === Tissue.Pancreas) return 5;
  if (tissue === Tissue.Spleen) return 6;
  if (tissue === Tissue.BladderWall) return 7;
  if (!atlas) return 0;
  if (tissue === Tissue.Blood) {
    if (abdominalAtlasSdf(p, 4) < 0) return 1;
    if (abdominalAtlasSdf(p, 5) < 0) return 2;
    if (abdominalAtlasSdf(p, 6) < 0) return 3;
    return 0;
  }
  if (![Tissue.Fluid, Tissue.Bowel, Tissue.BowelGas, Tissue.GutMuscularis, Tissue.GutSubmucosa, Tissue.SoftCapsule].includes(tissue))
    return 0;
  for (const [field, id] of [
    [0, 5],
    [2, 7],
    [3, 6],
    [7, 4],
  ])
    if (abdominalAtlasSdf(p, field) < 0) return id;
  const gut = abdominalAtlasValue(p, 1);
  return gut.d < 0 && gut.label >= 1 && gut.label <= 9 ? 7 + gut.label : 0;
}
