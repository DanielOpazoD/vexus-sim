import * as abdomen from '../../anatomy/organs/abdomen';
import * as bowel from '../../anatomy/organs/bowel';
import * as gallbladder from '../../anatomy/organs/gallbladder';
import * as heart from '../../anatomy/organs/heart';
import * as kidney from '../../anatomy/organs/kidney';
import * as liver from '../../anatomy/organs/liver';
import * as liverLigaments from '../../anatomy/organs/liverLigaments';
import * as lungCurtain from '../../anatomy/organs/lungCurtain';
import * as retroperitoneum from '../../anatomy/organs/retroperitoneum';
import * as sternum from '../../anatomy/organs/sternum';
import * as wall from '../../anatomy/organs/wall';

import * as interior from '../../anatomy/people/default/kidneyInterior';
import * as paravertebral from '../../anatomy/people/default/paravertebral';
import * as atlas from './legacyPerson/abdominalAtlas';
export { ORGAN_GLSL } from '../../anatomy/organs';
/**
 * Registro de módulos de órgano (decisión 46). Cada módulo reúne en UN archivo la geometría,
 * sus funciones TS y sus pares GLSL (mismos nombres); `ANATOMY_GLSL` incluye todos los pares.
 * `organs.test.ts` exige que cada función GLSL tenga su par TS exportada con el mismo nombre,
 * salvo las declaradas en `gpuOnly` con su motivo.
 * El ORDEN es el de dependencia en GLSL (el hígado usa riñón, vesícula y fisura; el retroperitoneo, los conos del riñón; el corazón,
 * los elipsoides y la unión suave de la anatomía). Los tubos
 * (árbol vascular en textura de datos) y las primitivas genéricas siguen en `primitives.ts`.
 * fixture-twin organo-abdomen
 * fixture-twin organo-intestino
 * fixture-twin organo-esternon
 * fixture-twin organo-pared
 * fixture-twin organo-rinon
 * fixture-twin organo-ligamentos
 * fixture-twin organo-cortina
 * fixture-twin organo-vesicula
 * fixture-twin organo-higado
 * fixture-twin organo-retroperitoneo
 * fixture-twin organo-corazon
 */
export interface OrganModule {
  id: string;
  /** Exportaciones TS del módulo (para comprobar por nombre los pares TS/GLSL). */
  exports: Record<string, unknown>;
  glsl: string;
  /** Funciones GLSL sin pareja TS (nombre → motivo), p. ej. normales que solo usa el shader. */
  gpuOnly?: Readonly<Record<string, string>>;
}

export const ORGAN_MODULES: readonly OrganModule[] = [
  { id: 'abdomen', exports: { ...abdomen, ...atlas }, glsl: abdomen.ABDOMEN_GLSL },
  { id: 'bowel', exports: bowel, glsl: bowel.BOWEL_GLSL },
  { id: 'sternum', exports: sternum, glsl: sternum.STERNUM_GLSL },
  {
    id: 'wall',
    exports: wall,
    glsl: wall.WALL_GLSL,
    // el relieve de las caras (decisión 88): una función GLSL por cara, generada de las tablas de sus términos
    gpuOnly: Object.fromEntries<string>([
      ...[0, 1, 2, 3, 4].map((k): [string, string] => [`wallWave${k}`, `wallWave(u, z, ${k}, t) de TS, generada de WALL_WAVE_TERMS[${k}]`]),
      ...[0, 1, 2, 3].map((k): [string, string] => [`wallSwell${k}`, `wallSwell(u, z, ${k}, t) de TS, generada de WALL_SWELL_TERMS[${k}]`]),
      // el gradiente de la profundidad del tronco, que usan wallFaceGradient y el eco de las copias de la pared
      ['torsoDepthGrad', 'torsoDepthGradient de anatomy/primitives'],
    ]),
  },
  {
    id: 'kidney',
    exports: { ...kidney, ...interior },
    glsl: kidney.KIDNEY_GLSL,
    gpuOnly: {
      kidneyOuter: 'contorno sin atlas y su normal, para la impresión renal del hígado; TS no usa normales',
      kidneyOuterNormal:
        'normal de la clasificación (el eco de interfaz usa el gradiente del contorno, `faceGradient`); TS no usa normales',
    },
  },
  { id: 'liverLigaments', exports: liverLigaments, glsl: liverLigaments.LIVER_LIGAMENTS_GLSL },
  { id: 'lungCurtain', exports: lungCurtain, glsl: lungCurtain.LUNG_CURTAIN_GLSL },
  { id: 'gallbladder', exports: gallbladder, glsl: gallbladder.GALLBLADDER_GLSL },
  { id: 'liver', exports: liver, glsl: liver.LIVER_GLSL },
  { id: 'retroperitoneum', exports: { ...retroperitoneum, ...paravertebral }, glsl: retroperitoneum.RETROPERITONEUM_GLSL },
  {
    id: 'heart',
    exports: heart,
    glsl: heart.HEART_GLSL,
    // la normal del epicardio (eco del pericardio) y de la frontera del mediastino (espejo del pulmón), que la GPU deja en c.n;
    // TS usa el gradiente numérico de `faceSdf`
    gpuOnly: { epiNormal: 'normal en c.n; TS: gradiente de faceSdf' },
  },
];
