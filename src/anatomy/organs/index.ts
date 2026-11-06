import * as abdomen from './abdomen';
import * as bowel from './bowel';
import * as gallbladder from './gallbladder';
import * as heart from './heart';
import * as kidney from './kidney';
import * as liver from './liver';
import * as liverLigaments from './liverLigaments';
import * as lungCurtain from './lungCurtain';
import * as retroperitoneum from './retroperitoneum';
import * as sternum from './sternum';
import * as wall from './wall';

/** Solo fuentes GLSL en producción: el registro de validación no debe retener namespaces TS completos. */
export const ORGAN_GLSL = [
  abdomen.ABDOMEN_GLSL,
  bowel.BOWEL_GLSL,
  sternum.STERNUM_GLSL,
  wall.WALL_GLSL,
  kidney.KIDNEY_GLSL,
  liverLigaments.LIVER_LIGAMENTS_GLSL,
  lungCurtain.LUNG_CURTAIN_GLSL,
  gallbladder.GALLBLADDER_GLSL,
  liver.LIVER_GLSL,
  retroperitoneum.RETROPERITONEUM_GLSL,
  heart.HEART_GLSL,
];
