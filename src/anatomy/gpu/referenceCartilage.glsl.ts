import { CARTILAGE_ROWS, CARTILAGE_X0, CARTILAGE_X1 } from '../referenceCartilageData';

/** Pure GLSL twin; section data occupies the existing scene-texture tail. */
export const CARTILAGE_GLSL = (base: number): string => /* glsl */ `
float referenceCartilage(vec3 p, out vec3 tangent, out float curvature) {
  float x = -abs(p.x), stepX = ${(CARTILAGE_X1 - CARTILAGE_X0) / (CARTILAGE_ROWS.length - 1)};
  float u = clamp((x - ${CARTILAGE_X0}) / stepX, 0.0, ${CARTILAGE_ROWS.length - 1}.0);
  int i = min(${CARTILAGE_ROWS.length - 2}, int(floor(u)));
  vec4 a = sceneTexel(${base} + i), b = sceneTexel(${base} + i + 1), q = mix(a, b, u - float(i));
  vec2 v = p.yz - q.xy, section = v / q.zw;
  float rho = length(section);
  tangent = normalize(vec3(p.x > 0.0 ? -stepX : stepX, b.xy - a.xy));
  vec2 cs = rho > 0.0 ? section / rho : vec2(1,0);
  curvature = q.z * q.w / pow(q.z * q.z * cs.y * cs.y + q.w * q.w * cs.x * cs.x, 1.5);
  return max((rho - 1.0) * min(q.z, q.w), max(${CARTILAGE_X0} - x, x - ${CARTILAGE_X1}));
}
`;
