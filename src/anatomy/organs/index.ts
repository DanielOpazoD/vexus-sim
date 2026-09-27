import * as gallbladder from './gallbladder';
import * as heart from './heart';
import * as kidney from './kidney';
import * as liver from './liver';
import * as liverLigaments from './liverLigaments';
import * as lungCurtain from './lungCurtain';
import * as retroperitoneum from './retroperitoneum';
import * as wall from './wall';

/**
 * Registro de módulos de órgano (decisión 46). Cada módulo reúne en UN archivo la geometría,
 * sus funciones TS y su gemelo GLSL (mismos nombres); `ANATOMY_GLSL` incluye todos los gemelos.
 * `organs.test.ts` exige que cada función GLSL tenga su gemela TS exportada con el mismo nombre,
 * salvo las declaradas en `gpuOnly` con su motivo.
 * El ORDEN es el de dependencia en GLSL (el hígado usa riñón, vesícula y fisura; el retroperitoneo, los conos del riñón; el corazón,
 * los elipsoides y la unión suave de la anatomía). Los tubos
 * (árbol vascular en textura de datos) y las primitivas genéricas siguen en `primitives.ts`.
 */
export interface OrganModule {
  id: string;
  /** Exportaciones TS del módulo (para comprobar los gemelos por nombre). */
  exports: Record<string, unknown>;
  glsl: string;
  /** Funciones GLSL sin gemela TS (nombre → motivo), p. ej. normales que solo usa el shader. */
  gpuOnly?: Readonly<Record<string, string>>;
}

export const ORGAN_MODULES: readonly OrganModule[] = [
  { id: 'wall', exports: wall, glsl: wall.WALL_GLSL },
  {
    id: 'kidney',
    exports: kidney,
    glsl: kidney.KIDNEY_GLSL,
    gpuOnly: {
      kidneyOuter:
        'normal del elipsoide de la clasificación (el eco de interfaz usa el gradiente del contorno, `faceGradient`); TS no usa normales',
    },
  },
  { id: 'liverLigaments', exports: liverLigaments, glsl: liverLigaments.LIVER_LIGAMENTS_GLSL },
  { id: 'lungCurtain', exports: lungCurtain, glsl: lungCurtain.LUNG_CURTAIN_GLSL },
  { id: 'gallbladder', exports: gallbladder, glsl: gallbladder.GALLBLADDER_GLSL },
  { id: 'liver', exports: liver, glsl: liver.LIVER_GLSL },
  { id: 'retroperitoneum', exports: retroperitoneum, glsl: retroperitoneum.RETROPERITONEUM_GLSL },
  {
    id: 'heart',
    exports: heart,
    glsl: heart.HEART_GLSL,
    gpuOnly: {
      epiNormal:
        'normal del epicardio para el eco del pericardio y de la frontera del mediastino para el espejo del pulmón (la GPU la deja en c.n); TS usa el gradiente numérico de `faceSdf`',
    },
  },
];
