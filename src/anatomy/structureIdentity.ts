import { abdominalAtlasSdf, abdominalAtlasValue } from './abdominalAtlas';
import { kidneyLocal, kidneyOuterSdf } from './organs/kidney';
import { Interface } from './interfaces';
import { Tissue } from './tissues';
import type { Vec3 } from '../core/vec3';
import type { AnatomyScene } from './scene';

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

export function structureIdentity(p: Vec3, tissue: Tissue, iface: Interface, scene: AnatomyScene): number {
  if (tissue === Tissue.Liver || tissue === Tissue.LiverCapsule) return 1;
  if ([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule, Tissue.RenalPelvis].includes(tissue)) {
    const d = (center: Vec3) => center.reduce((sum, value, i) => sum + (value - p[i]) ** 2, 0);
    return d(scene.kidneyRight.center) <= d(scene.kidneyLeft.center) ? 2 : 3;
  }
  if (iface === Interface.GallbladderLumen) return 4;
  if (tissue === Tissue.Pancreas) return 5;
  if (tissue === Tissue.Spleen) return 6;
  if (tissue === Tissue.BladderWall) return 7;
  if (!scene.hasAbdominalAtlas) return 0;
  if (tissue === Tissue.Blood) {
    if (abdominalAtlasSdf(p, 4) < 0) return 1;
    if (kidneyOuterSdf(kidneyLocal(p, scene.kidneyRight), scene.kidneyRight) < 0) return 2;
    if (kidneyOuterSdf(kidneyLocal(p, scene.kidneyLeft), scene.kidneyLeft) < 0) return 3;
    return 0;
  }
  if (
    ![
      Tissue.Fluid,
      Tissue.ColonicContents,
      Tissue.GastricContents,
      Tissue.Bowel,
      Tissue.BowelGas,
      Tissue.GutMuscularis,
      Tissue.GutSubmucosa,
      Tissue.SoftCapsule,
    ].includes(tissue)
  )
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
