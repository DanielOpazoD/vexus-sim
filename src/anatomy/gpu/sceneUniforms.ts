import type { ProbeCompression } from '../compression';
import { RespiratoryDeformation } from '../deformation';
import { GALLBLADDER_NODES } from '../organs/gallbladder';
import { PERIRENAL } from '../organs/kidney';
import { LUNG_CURTAIN } from '../organs/lungCurtain';
import type { AnatomyScene } from '../scene';
import type { PhysiologySample } from '../../physiology/engine';

/**
 * Esquema ÚNICO de los uniforms de la anatomía (Fase 2): cada entrada declara nombre, tipo,
 * tamaño y cómo se obtiene su valor de la escena y del instante, con su documentación en un comentario (decisión 85:
 * antes era un campo que viajaba en el bundle, ~2 kB, solo para acabar como comentario en el GLSL). De aquí salen
 * a la vez las declaraciones GLSL (`SCENE_UNIFORMS_GLSL`, incluidas en `ANATOMY_GLSL`) y la
 * subida desde el renderer (`evaluateSceneUniforms` + `uploadSceneUniforms`). Antes había que
 * escribir cada nombre dos veces (≈ 85 líneas en el renderer) y un olvido fallaba en silencio.
 */
/** Seis registros bilaterales (pares 5–10); no doce evaluaciones por punto. */
export const MAX_RIBS = 6;

type GlslType = 'float' | 'int' | 'vec2' | 'vec3' | 'vec4';
const SIZE: Record<GlslType, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 };

export interface UniformContext {
  sample: PhysiologySample;
  tubeCount: number;
  /** Contacto de la sonda del cuadro (decisión 63); null: sin compresión (uCompC.w = 0). */
  compression: ProbeCompression | null;
}

interface UniformSpec {
  name: string;
  type: GlslType;
  /** Tamaño del array GLSL (sin él, escalar/vector simple). */
  count?: number;
  value: (s: AnatomyScene, c: UniformContext) => ArrayLike<number>;
}

const pad = (values: number[][], count: number, filler: number[]): number[] =>
  Array.from({ length: count }, (_, i) => values[i] ?? filler).flat();

export const SCENE_UNIFORMS: readonly UniformSpec[] = [
  /** a, b, zMin, zMax */
  { name: 'uReferenceBody', type: 'int', value: (s) => [s.torso.profile ? 1 : 0] },
  { name: 'uTorsoY', type: 'float', value: (s) => [s.torso.y0 ?? 0] },
  { name: 'uTorso', type: 'vec4', value: (s) => [s.torso.a, s.torso.b, s.torso.zMin, s.torso.zMax] },
  {
    name: 'uWall',
    type: 'vec4',
    // piel, grasa, músculo (con la grasa preperitoneal), grasa preperitoneal (mm)
    value: (s) => [s.torso.skinMm, s.torso.fatMm, s.torso.muscleMm, s.torso.preperitonealMm],
  },
  {
    name: 'uDomeR',
    type: 'vec4',
    // hemicúpula derecha: x0, y0, rx, ry
    value: (s) => [s.diaphragm.right.x0, s.diaphragm.right.y0, s.diaphragm.right.rx, s.diaphragm.right.ry],
  },
  {
    name: 'uDomeL',
    type: 'vec4',
    // hemicúpula izquierda
    value: (s) => [s.diaphragm.left.x0, s.diaphragm.left.y0, s.diaphragm.left.rx, s.diaphragm.left.ry],
  },
  {
    name: 'uDiaphragm',
    type: 'vec4',
    // apexR, apexL, edgeZ, edgeRise
    value: (s) => [s.diaphragm.right.apex, s.diaphragm.left.apex, s.diaphragm.edgeZ, s.diaphragm.edgeRise],
  },
  /** x0, y0, r (cuerpo vertebral) */
  { name: 'uSpine', type: 'vec3', value: (s) => [s.spine.x0, s.spine.y0, s.spine.r] },
  {
    name: 'uSpineArch',
    type: 'vec4',
    // semiancho, y0, y1 del arco posterior, 0
    value: (s) => [s.spine.archHalfWidth, s.spine.archY0, s.spine.archY1, 0],
  },
  /** centro del lóbulo derecho */
  { name: 'uLiverC', type: 'vec3', value: (s) => s.liver.center },
  /** semiejes del lóbulo derecho */
  { name: 'uLiverR', type: 'vec3', value: (s) => s.liver.radii },
  /** afilamiento en +x del lóbulo derecho */
  { name: 'uLiverTaper', type: 'float', value: (s) => [s.liver.taperX] },
  /** centro del lóbulo izquierdo */
  { name: 'uLiverLC', type: 'vec3', value: (s) => s.liverLeft.center },
  /** semiejes del lóbulo izquierdo */
  { name: 'uLiverLR', type: 'vec3', value: (s) => s.liverLeft.radii },
  /** afilamiento del lóbulo izquierdo */
  { name: 'uLiverLTaper', type: 'float', value: (s) => [s.liverLeft.taperX] },
  /** unión suave de los lóbulos (mm) */
  { name: 'uLiverBlend', type: 'float', value: (s) => [s.liverBlendMm] },
  {
    name: 'uVisInnerA',
    type: 'vec3',
    // cara visceral interior c₀, c₁, c₂ (z = c₀ + c₁x + c₂y + …; decisión 72)
    value: (s) => [s.visceralFace.inner[0], s.visceralFace.inner[1], s.visceralFace.inner[2]],
  },
  {
    name: 'uVisInnerB',
    type: 'vec3',
    // cara visceral interior c₃, c₄, c₅ (… + c₃x² + c₄xy + c₅y²)
    value: (s) => [s.visceralFace.inner[3], s.visceralFace.inner[4], s.visceralFace.inner[5]],
  },
  /** borde anterior a₀…a₃ (cúbica en x) */
  { name: 'uVisAnt', type: 'vec4', value: (s) => [...s.visceralFace.anterior] },
  /** borde lateral derecho l₀…l₃ (en y) */
  { name: 'uVisLat', type: 'vec4', value: (s) => [...s.visceralFace.lateral] },
  {
    name: 'uVisSlope',
    type: 'vec4',
    // pendiente del borde anterior (lóbulo dcho., izdo.), del lateral y redondeo de la arista (mm)
    value: (s) => [s.visceralFace.tipSlope[0], s.visceralFace.tipSlope[1], s.visceralFace.lateralSlope, s.visceralFace.edgeRoundMm],
  },
  {
    name: 'uFissure',
    type: 'vec4',
    // fisura umbilical: x, semiancho, profundidad, zMax
    value: (s) => [s.umbilicalFissure.x, s.umbilicalFissure.halfWidth, s.umbilicalFissure.depthMm, s.umbilicalFissure.zMax],
  },
  {
    name: 'uLigVen',
    type: 'vec4',
    // plano del ligamento venoso: normal.xyz, n·a
    value: (s) => {
      const lv = s.ligamentumVenosumPlane();
      return [...lv.normal, lv.normal[0] * lv.point[0] + lv.normal[1] * lv.point[1] + lv.normal[2] * lv.point[2]];
    },
  },
  {
    name: 'uLigVenBox',
    type: 'vec4',
    // caja del ligamento venoso: xMin, xMax, zMin, zMax
    value: (s) => [s.ligamentumVenosum.xMin, s.ligamentumVenosum.xMax, s.ligamentumVenosum.zMin, s.ligamentumVenosum.zMax],
  },
  {
    name: 'uGbNodes',
    type: 'vec4',
    count: GALLBLADDER_NODES,
    // línea media de la luz vesicular, del fondo al cuello: centro, radio
    value: (s) => s.gallbladder.nodes.flatMap((n) => [...n.p, n.r]),
  },
  {
    name: 'uGbExtra',
    type: 'vec2',
    // radio de la unión suave entre tramos, espesor de pared (mm)
    value: (s) => [s.gallbladder.blendMm, s.gallbladderWallMm],
  },
  {
    name: 'uRibs',
    type: 'vec4',
    count: MAX_RIBS,
    // costillas: zAnterior, tilt, halfWidth, halfThickness
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
    // escala, cartilageFromPhi
    value: (s) => [s.ribs[0]?.scale ?? 0.85, s.ribs[0]?.cartilageFromPhi ?? 9],
  },
  {
    name: 'uKidC',
    type: 'vec3',
    count: 2,
    // centros de los riñones (dcho, izq)
    value: (s) => [...s.kidneyRight.center, ...s.kidneyLeft.center],
  },
  /** semiejes de los riñones */
  { name: 'uKidR', type: 'vec3', count: 2, value: (s) => [...s.kidneyRight.radii, ...s.kidneyLeft.radii] },
  /** eje largo de cada riñón */
  { name: 'uKidU', type: 'vec3', count: 2, value: (s) => [...s.kidneyRight.u, ...s.kidneyLeft.u] },
  /** eje hacia el hilio */
  { name: 'uKidV', type: 'vec3', count: 2, value: (s) => [...s.kidneyRight.v, ...s.kidneyLeft.v] },
  /** tercer eje */
  { name: 'uKidW', type: 'vec3', count: 2, value: (s) => [...s.kidneyRight.w, ...s.kidneyLeft.w] },
  {
    name: 'uKidSinus',
    type: 'vec4',
    count: 2,
    // seno: semiejes xyz, desplazamiento
    value: (s) => [...s.kidneyRight.sinusRadii, s.kidneyRight.sinusOffset, ...s.kidneyLeft.sinusRadii, s.kidneyLeft.sinusOffset],
  },
  {
    name: 'uKidExtra',
    type: 'vec2',
    // radio del hilio, grosor máximo de la grasa perirrenal (mm; el local lo da perirenalThicknessMm)
    value: (s) => [s.kidneyRight.hilumRadius, PERIRENAL.maxMm],
  },
  /** tubos en la lista del cuadro */
  { name: 'uTubeCount', type: 'int', value: (_s, c) => [c.tubeCount] },
  {
    name: 'uResp',
    type: 'vec4',
    // descenso diafragmático (mm), dirección xyz
    value: (_s, c) => [c.sample.resp.diaphragmCaudalMm, ...RespiratoryDeformation.direction],
  },
  /** velocidad del diafragma (mm/s) */
  { name: 'uRespVel', type: 'float', value: (_s, c) => [c.sample.resp.diaphragmVelocityMmS] },
  {
    name: 'uCompC',
    type: 'vec4',
    // compresión de la sonda (decisión 63): centro de curvatura de la cara, radio + alcance (0 = sin compresión)
    value: (_s, c) => (c.compression ? [...c.compression.center, c.compression.radiusMm + c.compression.reachMm] : [0, 0, 0, 0]),
  },
  {
    name: 'uCompAx',
    type: 'vec4',
    // eje axial de la sonda, sen del semiángulo de la cara (la tabla por nodo, con el radio, va en uSceneTex, COMP_BASE)
    value: (_s, c) => (c.compression ? [...c.compression.axial, Math.sin(c.compression.halfAngle)] : [0, 0, 1, 1]),
  },
  {
    name: 'uCompLat',
    type: 'vec4',
    // eje lateral de la sonda, media huella elevacional (mm)
    value: (_s, c) => (c.compression ? [...c.compression.lateral, c.compression.halfElevationMm] : [1, 0, 0, 0]),
  },
  {
    name: 'uCurtain',
    type: 'vec4',
    // cortina pulmonar: borde caudal z, espesor, xMax, yMax
    value: (_s, c) => [LUNG_CURTAIN.z0 - c.sample.resp.diaphragmCaudalMm, LUNG_CURTAIN.thicknessMm, LUNG_CURTAIN.xMax, LUNG_CURTAIN.yMax],
  },
];

/** Declaraciones GLSL generadas del esquema (más el sampler de la textura de escena). */
export const SCENE_UNIFORMS_GLSL = [
  ...SCENE_UNIFORMS.map((u) => `uniform ${u.type} ${u.name}${u.count ? `[${u.count}]` : ''};`),
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
