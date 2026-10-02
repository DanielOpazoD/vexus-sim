import type { Vec3 } from '../../core/vec3';

/** Segmento yeyunoileal representativo, mm/LAS. Recorrido estimado, no registro de un atlas.
 * Extremos fuera de la región abdominal estudiada; no pretende reconstruir todo el intestino.
 * Un único eje para el campo TS, los nodos de GPU y el navegador. */
export const BOWEL_RADIUS_MM = 10;
export const BOWEL_WALL_MM = 2;
export const BOWEL_FIELD_REACH_MM = 5;
export const BOWEL_NODES: readonly Vec3[] = [
  [-48, 22, -330],
  [-48, 22, -205],
  [-49.3, 22.3, -195.7],
  [-50.9, 22.6, -186.3],
  [-52.6, 22.9, -177.0],
  [-54.1, 23.2, -167.7],
  [-55.1, 23.6, -158.3],
  [-55.3, 23.9, -148.8],
  [-54.2, 24.2, -139.4],
  [-52.5, 24.7, -130.2],
  [-49.5, 25.1, -121.2],
  [-43.9, 25.1, -113.7],
  [-35.1, 23.9, -111.4],
  [-25.9, 22.4, -112.9],
  [-16.7, 21.0, -114.8],
  [-7.3, 20.1, -115.3],
  [1.8, 20.3, -112.8],
  [10.2, 21.3, -108.6],
  [18.2, 22.7, -103.8],
  [26.2, 24.0, -99.0],
  [34.9, 25.0, -95.0],
  [43.7, 25.2, -92],
  [52.8, 25.1, -89.5],
  [62.2, 25, -90.1],
  [69.3, 25, -96.1],
  [74.0, 25, -104.3],
  [74.3, 25.0, -113.5],
  [69.9, 25.1, -121.9],
  [63.4, 25.0, -128.7],
  [55.3, 24.2, -133.4],
  [46.4, 23.2, -136.5],
  [37.3, 22.2, -138.9],
  [28.1, 21.8, -140.9],
  [18.8, 22.5, -142.6],
  [9.5, 24.4, -142.8],
  [0.4, 26.8, -142.7],
  [-8.4, 29.5, -144.6],
  [-12.9, 31.1, -152.5],
  [-13.9, 31.8, -161.8],
  [-12.5, 32.1, -171.2],
  [-6.9, 31.6, -178.4],
  [2.1, 30.1, -180.8],
  [11.4, 28.4, -181.6],
  [20.7, 26.9, -182.2],
  [30.0, 25.5, -183.5],
  [38.8, 24.7, -186.7],
  [47.0, 24.5, -191.4],
  [54.7, 24.6, -196.9],
  [62.3, 24.9, -202.6],
  [55, 20, -220],
  [55, 20, -330],
];
export const BOWEL_GROUP_SIZE = 8;
export const BOWEL_GROUPS = Math.ceil((BOWEL_NODES.length - 1) / BOWEL_GROUP_SIZE);
/** Esferas conservadoras por grupo: descarte antes de recorrer los segmentos. */
export const BOWEL_BOUNDS = Array.from({ length: BOWEL_GROUPS }, (_, k): [number, number, number, number] => {
  const p = BOWEL_NODES.slice(k * BOWEL_GROUP_SIZE, Math.min(BOWEL_NODES.length, (k + 1) * BOWEL_GROUP_SIZE + 1));
  const c = [0, 1, 2].map((j) => (Math.min(...p.map((v) => v[j])) + Math.max(...p.map((v) => v[j]))) / 2) as Vec3;
  return [...c, Math.max(...p.map((v) => Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]))) + BOWEL_RADIUS_MM];
});
export const BOWEL_TEXELS = BOWEL_GROUPS + BOWEL_NODES.length;
/** Distancia exterior truncada a +5 mm y normal; una unión de cápsulas sobre el eje continuo. */
export function bowelQuery(m: Vec3): { d: number; normal: Vec3; axis: Vec3 } {
  let d = BOWEL_FIELD_REACH_MM;
  let normal: Vec3 = [0, 1, 0],
    axis: Vec3 = [0, 0, 1];
  for (let g = 0; g < BOWEL_GROUPS; g++) {
    const b = BOWEL_BOUNDS[g];
    if (Math.hypot(m[0] - b[0], m[1] - b[1], m[2] - b[2]) - b[3] > BOWEL_FIELD_REACH_MM) continue;
    for (let i = g * BOWEL_GROUP_SIZE; i < Math.min((g + 1) * BOWEL_GROUP_SIZE, BOWEL_NODES.length - 1); i++) {
      const a = BOWEL_NODES[i],
        b = BOWEL_NODES[i + 1];
      const v: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        p: Vec3 = [m[0] - a[0], m[1] - a[1], m[2] - a[2]];
      const l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      const t = Math.max(0, Math.min(1, (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / l2));
      const q: Vec3 = [p[0] - t * v[0], p[1] - t * v[1], p[2] - t * v[2]],
        r = Math.hypot(...q);
      if (r - BOWEL_RADIUS_MM < d) {
        d = r - BOWEL_RADIUS_MM;
        normal = r > 1e-8 ? (q.map((x) => x / r) as Vec3) : [0, 1, 0];
        axis = v.map((x) => x / Math.sqrt(l2)) as Vec3;
      }
    }
  }
  return { d, normal, axis };
}
export function bowelSdf(m: Vec3): number {
  return bowelQuery(m).d;
}
/** Pequeñas inclusiones anteriores de gas, siempre recortadas por la luz. Distribución estática estimada. */
export const BOWEL_GAS: readonly { center: Vec3; radii: Vec3 }[] = [
  { center: [-37, 29, -112], radii: [9, 3, 5] },
  { center: [65, 29, -96], radii: [7, 3, 7] },
];
export function bowelGasSdf(m: Vec3, lumen: number): number {
  let d = 1e3;
  for (const g of BOWEL_GAS) d = Math.min(d, (Math.hypot(...m.map((x, j) => (x - g.center[j]) / g.radii[j])) - 1) * Math.min(...g.radii));
  return Math.max(lumen, d);
}
const f = (x: number) => x.toFixed(3);
/** Gemelo: BOWEL_BASE apunta a las esferas de descarte y después a los nodos en uSceneTex. */
export const BOWEL_GLSL = /* glsl */ `
#define BOWEL_REACH ${f(BOWEL_FIELD_REACH_MM)}
#define BOWEL_RADIUS ${f(BOWEL_RADIUS_MM)}
#define BOWEL_WALL ${f(BOWEL_WALL_MM)}
float bowelQuery(vec3 m, out vec3 n, out vec3 axis) {
  float d = ${f(BOWEL_FIELD_REACH_MM)}; n=vec3(0,1,0); axis=vec3(0,0,1);
  for(int g=0;g<${BOWEL_GROUPS};g++){
    vec4 bound=sceneTexel(BOWEL_BASE+g);
    if(distance(m,bound.xyz)-bound.w>${f(BOWEL_FIELD_REACH_MM)})continue;
    for(int j=0;j<${BOWEL_GROUP_SIZE};j++){
      int i=g*${BOWEL_GROUP_SIZE}+j;
      if(i>=${BOWEL_NODES.length - 1})break;
      vec3 a=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS}+i).xyz;
      vec3 v=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS}+i+1).xyz-a;
      vec3 p=m-a;
      float t=clamp(dot(p,v)/dot(v,v),0.0,1.0);
      vec3 q=p-t*v;float r=length(q);
      if(r-BOWEL_RADIUS<d){d=r-BOWEL_RADIUS;n=r>1e-8?q/r:vec3(0,1,0);axis=normalize(v);}
    }
  }
  return d;
}
float bowelSdf(vec3 m){vec3 n,axis;return bowelQuery(m,n,axis);}
float bowelGasSdf(vec3 m,float lumen){
  float d=1e3;
  ${BOWEL_GAS.map((g) => `d=min(d,(length((m-vec3(${g.center.map(f).join(',')}))/vec3(${g.radii.map(f).join(',')}))-1.0)*${f(Math.min(...g.radii))});`).join('\n')}
  return max(lumen,d);
}
`;
