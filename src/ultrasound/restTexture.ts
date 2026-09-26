import type { Vec3 } from '../core/vec3';
import { valueNoise } from './speckleField';

/**
 * Textura del «resto» del abdomen (decisión 74): lo que la anatomía no modela como órgano (asas intestinales, mesenterio y
 * epiplón, grasa retroperitoneal) se veía con la retrodispersión y el moteado del hígado (0,9 frente a 1), así que el
 * riñón, la porta y la VCI del flanco aparecían rodeados de «hígado». Ahora es un factor de la amplitud de
 * retrodispersión del intestino (`fieldFor` de la pasada B y el gemelo de la pared), anclado al material (no hierve):
 *
 *  - asas: el nivel `threshold` de un ruido de valor suave (dos octavas, ~16 mm) separa las asas de la grasa; hacia
 *    dentro del borde, con la distancia aproximada t = (n − umbral)·celda (mm), la firma intestinal: serosa brillante,
 *    muscular hipoecoica, mucosa brillante y la luz, con contenido líquido (oscuro) o mixto con gas (brillante) según
 *    un segundo ruido de ~5 mm;
 *  - grasa mesentérica entre las asas: hiperecoica y granulosa (con los grumos del tejido).
 *
 * Niveles relativos al hígado = 1 [ESTIMADO sobre las referencias de la revisión: grasa mesentérica hiperecoica,
 * pared intestinal en capas de 2–4 mm, contenido variable]. Sin la sombra del gas (la transmisión no cambia).
 * Gemelos: `restTexture` (TS) y `REST_TEXTURE_GLSL` (pasada B), misma fórmula.
 */
export const REST_TEXTURE = {
  /** Célula del ruido de las asas (mm): asas de 1,5–3 cm en el corte. */
  loopCellMm: 16,
  /** Peso de la segunda octava (célula / 2,3), que rompe la forma de rejilla del ruido de valor. */
  detailWeight: 0.35,
  /** Nivel del ruido en el borde de las asas (≈ 45 % del volumen son asas). */
  threshold: 0.52,
  /** Capas de la pared desde el borde hacia la luz (mm): serosa, muscular, mucosa. */
  serosaMm: 0.6,
  muscularisMm: 2.2,
  mucosaMm: 0.6,
  /** Suavizado de cada transición (mm). */
  edgeMm: 0.3,
  /** Retrodispersión (hígado = 1): grasa, serosa, muscular, mucosa y contenido oscuro/brillante. */
  fatBack: 1.35,
  serosaBack: 1.8,
  muscularisBack: 0.38,
  mucosaBack: 2.2,
  contentDark: 0.12,
  contentBright: 2.0,
  /** Célula del ruido del contenido (mm) y umbrales del paso de líquido a mixto. */
  contentCellMm: 5,
  contentMix: [0.45, 0.65] as const,
} as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Factor de retrodispersión del intestino en el punto material m (1 en ningún caso: niveles absolutos). */
export function restTexture(m: Vec3, seed: number): number {
  const R = REST_TEXTURE;
  const q: Vec3 = [m[0] / R.loopCellMm, m[1] / R.loopCellMm, m[2] / R.loopCellMm];
  const q2: Vec3 = [q[0] * 2.3, q[1] * 2.3, q[2] * 2.3];
  const n = (valueNoise(q, seed + 41) + R.detailWeight * valueNoise(q2, seed + 42)) / (1 + R.detailWeight);
  const t = (n - R.threshold) * R.loopCellMm;
  const e = R.edgeMm;
  const s1 = R.serosaMm;
  const s2 = s1 + R.muscularisMm;
  const s3 = s2 + R.mucosaMm;
  const c = valueNoise([m[0] / R.contentCellMm, m[1] / R.contentCellMm, m[2] / R.contentCellMm], seed + 43);
  const content = R.contentDark + (R.contentBright - R.contentDark) * smooth(R.contentMix[0], R.contentMix[1], c);
  let v = R.fatBack;
  v += (R.serosaBack - v) * smooth(-e, e, t);
  v += (R.muscularisBack - v) * smooth(s1 - e, s1 + e, t);
  v += (R.mucosaBack - v) * smooth(s2 - e, s2 + e, t);
  v += (content - v) * smooth(s3 - e, s3 + e, t);
  return v;
}

/** Gemelo GLSL (pasada B): necesita `valueNoise` (SPECKLE_TISSUE_GLSL) y `uSeed`. */
export const REST_TEXTURE_GLSL = /* glsl */ `
const float REST_LOOP_CELL_MM = ${REST_TEXTURE.loopCellMm.toFixed(4)};
const float REST_DETAIL_W = ${REST_TEXTURE.detailWeight.toFixed(4)};
const float REST_THRESHOLD = ${REST_TEXTURE.threshold.toFixed(4)};
const float REST_S1 = ${REST_TEXTURE.serosaMm.toFixed(4)};
const float REST_S2 = ${(REST_TEXTURE.serosaMm + REST_TEXTURE.muscularisMm).toFixed(4)};
const float REST_S3 = ${(REST_TEXTURE.serosaMm + REST_TEXTURE.muscularisMm + REST_TEXTURE.mucosaMm).toFixed(4)};
const float REST_EDGE = ${REST_TEXTURE.edgeMm.toFixed(4)};
const vec4 REST_BACK = vec4(${REST_TEXTURE.fatBack.toFixed(4)}, ${REST_TEXTURE.serosaBack.toFixed(4)}, ${REST_TEXTURE.muscularisBack.toFixed(4)}, ${REST_TEXTURE.mucosaBack.toFixed(4)});
const vec2 REST_CONTENT = vec2(${REST_TEXTURE.contentDark.toFixed(4)}, ${REST_TEXTURE.contentBright.toFixed(4)});
const float REST_CONTENT_CELL_MM = ${REST_TEXTURE.contentCellMm.toFixed(4)};
const vec2 REST_CONTENT_MIX = vec2(${REST_TEXTURE.contentMix[0].toFixed(4)}, ${REST_TEXTURE.contentMix[1].toFixed(4)});
float restTexture(vec3 m) {
  vec3 q = m / REST_LOOP_CELL_MM;
  float n = (valueNoise(q, uSeed + 41.0) + REST_DETAIL_W * valueNoise(q * 2.3, uSeed + 42.0)) / (1.0 + REST_DETAIL_W);
  float t = (n - REST_THRESHOLD) * REST_LOOP_CELL_MM;
  float c = valueNoise(m / REST_CONTENT_CELL_MM, uSeed + 43.0);
  float content = mix(REST_CONTENT.x, REST_CONTENT.y, smoothstep(REST_CONTENT_MIX.x, REST_CONTENT_MIX.y, c));
  float v = REST_BACK.x;
  v += (REST_BACK.y - v) * smoothstep(-REST_EDGE, REST_EDGE, t);
  v += (REST_BACK.z - v) * smoothstep(REST_S1 - REST_EDGE, REST_S1 + REST_EDGE, t);
  v += (REST_BACK.w - v) * smoothstep(REST_S2 - REST_EDGE, REST_S2 + REST_EDGE, t);
  v += (content - v) * smoothstep(REST_S3 - REST_EDGE, REST_S3 + REST_EDGE, t);
  return v;
}
`;
