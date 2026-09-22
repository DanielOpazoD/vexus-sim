import { RespiratoryDeformation } from '../deformation';
import { LUNG_CURTAIN } from '../organs/lungCurtain';
import type { AnatomyScene } from '../scene';
import type { PhysiologySample } from '../../physiology/engine';

/**
 * Esquema ÚNICO de los uniforms de la anatomía (Fase 2): cada entrada declara nombre, tipo,
 * tamaño, documentación y cómo se obtiene su valor de la escena y del instante. De aquí salen
 * a la vez las declaraciones GLSL (`SCENE_UNIFORMS_GLSL`, incluidas en `ANATOMY_GLSL`) y la
 * subida desde el renderer (`evaluateSceneUniforms` + `uploadSceneUniforms`). Antes había que
 * escribir cada nombre dos veces (≈ 85 líneas en el renderer) y un olvido fallaba en silencio.
 */
export const MAX_GAS = 6;
export const MAX_RIBS = 6;

type GlslType = 'float' | 'int' | 'vec2' | 'vec3' | 'vec4';
const SIZE: Record<GlslType, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 };

export interface UniformContext {
  sample: PhysiologySample;
  tubeCount: number;
}

interface UniformSpec {
  name: string;
  type: GlslType;
  /** Tamaño del array GLSL (sin él, escalar/vector simple). */
  count?: number;
  doc: string;
  value: (s: AnatomyScene, c: UniformContext) => ArrayLike<number>;
}

const pad = (values: number[][], count: number, filler: number[]): number[] =>
  Array.from({ length: count }, (_, i) => values[i] ?? filler).flat();

export const SCENE_UNIFORMS: readonly UniformSpec[] = [
  { name: 'uTorso', type: 'vec4', doc: 'a, b, zMin, zMax', value: (s) => [s.torso.a, s.torso.b, s.torso.zMin, s.torso.zMax] },
  { name: 'uWall', type: 'vec3', doc: 'piel, grasa, músculo (mm)', value: (s) => [s.torso.skinMm, s.torso.fatMm, s.torso.muscleMm] },
  {
    name: 'uDomeR',
    type: 'vec4',
    doc: 'hemicúpula derecha: x0, y0, rx, ry',
    value: (s) => [s.diaphragm.right.x0, s.diaphragm.right.y0, s.diaphragm.right.rx, s.diaphragm.right.ry],
  },
  {
    name: 'uDomeL',
    type: 'vec4',
    doc: 'hemicúpula izquierda',
    value: (s) => [s.diaphragm.left.x0, s.diaphragm.left.y0, s.diaphragm.left.rx, s.diaphragm.left.ry],
  },
  {
    name: 'uDiaphragm',
    type: 'vec4',
    doc: 'apexR, apexL, edgeZ, edgeRise',
    value: (s) => [s.diaphragm.right.apex, s.diaphragm.left.apex, s.diaphragm.edgeZ, s.diaphragm.edgeRise],
  },
  { name: 'uSpine', type: 'vec3', doc: 'x0, y0, r (cuerpo vertebral)', value: (s) => [s.spine.x0, s.spine.y0, s.spine.r] },
  {
    name: 'uSpineArch',
    type: 'vec4',
    doc: 'semiancho, y0, y1 del arco posterior, 0',
    value: (s) => [s.spine.archHalfWidth, s.spine.archY0, s.spine.archY1, 0],
  },
  { name: 'uLiverC', type: 'vec3', doc: 'centro del lóbulo derecho', value: (s) => s.liver.center },
  { name: 'uLiverR', type: 'vec3', doc: 'semiejes del lóbulo derecho', value: (s) => s.liver.radii },
  { name: 'uLiverTaper', type: 'float', doc: 'afilamiento en +x del lóbulo derecho', value: (s) => [s.liver.taperX] },
  { name: 'uLiverLC', type: 'vec3', doc: 'centro del lóbulo izquierdo', value: (s) => s.liverLeft.center },
  { name: 'uLiverLR', type: 'vec3', doc: 'semiejes del lóbulo izquierdo', value: (s) => s.liverLeft.radii },
  { name: 'uLiverLTaper', type: 'float', doc: 'afilamiento del lóbulo izquierdo', value: (s) => [s.liverLeft.taperX] },
  { name: 'uLiverBlend', type: 'float', doc: 'unión suave de los lóbulos (mm)', value: (s) => [s.liverBlendMm] },
  {
    name: 'uVisceral',
    type: 'vec4',
    doc: 'zAtY0, slopeY, edgeRound, renalImpression',
    value: (s) => [s.visceralPlane.zAtY0, s.visceralPlane.slopeY, s.visceralPlane.edgeRoundMm, s.renalImpressionMm],
  },
  {
    name: 'uFissure',
    type: 'vec4',
    doc: 'fisura umbilical: x, semiancho, profundidad, zMax',
    value: (s) => [s.umbilicalFissure.x, s.umbilicalFissure.halfWidth, s.umbilicalFissure.depthMm, s.umbilicalFissure.zMax],
  },
  {
    name: 'uLigVen',
    type: 'vec4',
    doc: 'plano del ligamento venoso: normal.xyz, n·a',
    value: (s) => {
      const lv = s.ligamentumVenosumPlane();
      return [...lv.normal, lv.normal[0] * lv.point[0] + lv.normal[1] * lv.point[1] + lv.normal[2] * lv.point[2]];
    },
  },
  {
    name: 'uLigVenBox',
    type: 'vec4',
    doc: 'caja del ligamento venoso: xMin, xMax, zMin, zMax',
    value: (s) => [s.ligamentumVenosum.xMin, s.ligamentumVenosum.xMax, s.ligamentumVenosum.zMin, s.ligamentumVenosum.zMax],
  },
  { name: 'uGbC', type: 'vec3', doc: 'centro de la vesícula', value: (s) => s.gallbladder.center },
  { name: 'uGbR', type: 'vec3', doc: 'semiejes de la vesícula', value: (s) => s.gallbladder.radii },
  { name: 'uGbU', type: 'vec3', doc: 'eje fondo → cuello', value: (s) => s.gallbladder.u },
  { name: 'uGbV', type: 'vec3', doc: 'eje v de la vesícula', value: (s) => s.gallbladder.v },
  { name: 'uGbW', type: 'vec3', doc: 'eje w de la vesícula', value: (s) => s.gallbladder.w },
  {
    name: 'uGbExtra',
    type: 'vec2',
    doc: 'afilamiento en +u, espesor de pared (mm)',
    value: (s) => [s.gallbladder.taperU, s.gallbladderWallMm],
  },
  { name: 'uRA', type: 'vec4', doc: 'aurícula derecha: centro, radio', value: (s) => [...s.rightAtrium.center, s.rightAtrium.r] },
  {
    name: 'uGas',
    type: 'vec4',
    count: MAX_GAS,
    doc: 'bolsas de gas: centro, radio (relleno lejos)',
    value: (s) =>
      pad(
        s.gasPockets.slice(0, MAX_GAS).map((g) => [...g.center, g.r]),
        MAX_GAS,
        [0, 0, 9999, 0],
      ),
  },
  {
    name: 'uRibs',
    type: 'vec4',
    count: MAX_RIBS,
    doc: 'costillas: zAnterior, tilt, halfWidth, halfThickness',
    value: (s) =>
      pad(
        s.ribs.slice(0, MAX_RIBS).map((r) => [r.zAnterior, r.tilt, r.halfWidth, r.halfThickness]),
        MAX_RIBS,
        [9999, 0, 1, 1],
      ),
  },
  {
    name: 'uRibParams',
    type: 'vec2',
    doc: 'escala, cartilageFromPhi',
    value: (s) => [s.ribs[0]?.scale ?? 0.85, s.ribs[0]?.cartilageFromPhi ?? 9],
  },
  {
    name: 'uKidC',
    type: 'vec3',
    count: 2,
    doc: 'centros de los riñones (dcho, izq)',
    value: (s) => [...s.kidneyRight.center, ...s.kidneyLeft.center],
  },
  { name: 'uKidR', type: 'vec3', count: 2, doc: 'semiejes de los riñones', value: (s) => [...s.kidneyRight.radii, ...s.kidneyLeft.radii] },
  { name: 'uKidU', type: 'vec3', count: 2, doc: 'eje largo de cada riñón', value: (s) => [...s.kidneyRight.u, ...s.kidneyLeft.u] },
  { name: 'uKidV', type: 'vec3', count: 2, doc: 'eje hacia el hilio', value: (s) => [...s.kidneyRight.v, ...s.kidneyLeft.v] },
  { name: 'uKidW', type: 'vec3', count: 2, doc: 'tercer eje', value: (s) => [...s.kidneyRight.w, ...s.kidneyLeft.w] },
  {
    name: 'uKidSinus',
    type: 'vec4',
    count: 2,
    doc: 'seno: semiejes xyz, desplazamiento',
    value: (s) => [...s.kidneyRight.sinusRadii, s.kidneyRight.sinusOffset, ...s.kidneyLeft.sinusRadii, s.kidneyLeft.sinusOffset],
  },
  {
    name: 'uKidExtra',
    type: 'vec2',
    doc: 'radio del hilio, grasa perirrenal (mm)',
    value: (s) => [s.kidneyRight.hilumRadius, s.perirenalMm],
  },
  { name: 'uTubeCount', type: 'int', doc: 'tubos en la lista del cuadro', value: (_s, c) => [c.tubeCount] },
  {
    name: 'uResp',
    type: 'vec4',
    doc: 'descenso diafragmático (mm), dirección xyz',
    value: (_s, c) => [c.sample.resp.diaphragmCaudalMm, ...RespiratoryDeformation.direction],
  },
  { name: 'uRespVel', type: 'float', doc: 'velocidad del diafragma (mm/s)', value: (_s, c) => [c.sample.resp.diaphragmVelocityMmS] },
  {
    name: 'uCurtain',
    type: 'vec4',
    doc: 'cortina pulmonar: borde caudal z, espesor, xMax, yMax',
    value: (_s, c) => [LUNG_CURTAIN.z0 - c.sample.resp.diaphragmCaudalMm, LUNG_CURTAIN.thicknessMm, LUNG_CURTAIN.xMax, LUNG_CURTAIN.yMax],
  },
];

/** Declaraciones GLSL generadas del esquema (más el sampler de la textura de escena). */
export const SCENE_UNIFORMS_GLSL = [
  ...SCENE_UNIFORMS.map((u) => `uniform ${u.type} ${u.name}${u.count ? `[${u.count}]` : ''}; // ${u.doc}`),
  'uniform sampler2D uSceneTex; // cabeceras y nodos de los tubos',
].join('\n');

/** Valores de un cuadro, evaluados UNA vez y subidos a cada programa que usa la anatomía. */
export type SceneUniformValues = ReadonlyArray<{ spec: UniformSpec; data: Float32Array }>;

export function evaluateSceneUniforms(s: AnatomyScene, c: UniformContext): SceneUniformValues {
  return SCENE_UNIFORMS.map((spec) => {
    const raw = spec.value(s, c);
    const expected = SIZE[spec.type] * (spec.count ?? 1);
    if (raw.length !== expected) throw new Error(`uniform ${spec.name}: ${raw.length} valores, se esperaban ${expected}`);
    return { spec, data: Float32Array.from(raw) };
  });
}

/** Mínima interfaz de programa que necesita la subida (la cumple `GLProgram`). */
export interface UniformSink {
  f(name: string, v: number): void;
  i(name: string, v: number): void;
  v2(name: string, a: number, b: number): void;
  v3(name: string, v: ArrayLike<number>): void;
  v4(name: string, a: number, b: number, c: number, d: number): void;
  v3v(name: string, v: Float32Array): void;
  v4v(name: string, v: Float32Array): void;
}

export function uploadSceneUniforms(p: UniformSink, values: SceneUniformValues): void {
  for (const { spec, data: d } of values) {
    if (spec.count) {
      if (spec.type === 'vec4') p.v4v(spec.name, d);
      else if (spec.type === 'vec3') p.v3v(spec.name, d);
      else throw new Error(`array de ${spec.type} no soportado (${spec.name})`);
      continue;
    }
    switch (spec.type) {
      case 'float':
        p.f(spec.name, d[0]);
        break;
      case 'int':
        p.i(spec.name, d[0]);
        break;
      case 'vec2':
        p.v2(spec.name, d[0], d[1]);
        break;
      case 'vec3':
        p.v3(spec.name, d);
        break;
      case 'vec4':
        p.v4(spec.name, d[0], d[1], d[2], d[3]);
        break;
    }
  }
}
