import type { Vec3 } from '../../core/vec3';
import { compressionSample, type ProbeCompression } from '../compression';

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
/** Abscisa curvilínea, compartida por radio y pliegues: no reinicia la fase en cada cápsula. */
export const BOWEL_ARC = BOWEL_NODES.map((_, i) =>
  BOWEL_NODES.slice(1, i + 1).reduce((s, p, j) => s + Math.hypot(...p.map((x, k) => x - BOWEL_NODES[j][k])), 0),
);
/** Radios de reposo estimados. La envolvente anterior de 10 mm sigue siendo conservadora. */
export const BOWEL_RADII = BOWEL_ARC.map((s) => 8.8 + 1.2 * Math.cos(s / 43));
export const BOWEL_FOLD_MM = 1.2;
export const BOWEL_FOLD_PERIOD_MM = 8;
/** Respuesta cuasiestática local estimada: carga de la sonda reduce el radio hasta 18 %.
 * No simula conservación de volumen, presión intraluminal ni peristalsis. null restaura el reposo. */
export function bowelRadii(k: ProbeCompression | null): Float32Array {
  return Float32Array.from(
    BOWEL_RADII,
    (r, i) => r * (1 - (k ? Math.min(0.18, Math.max(0, -compressionSample(BOWEL_NODES[i], k).shift) * 0.012) : 0)),
  );
}
export const BOWEL_REST_RADII = bowelRadii(null);
export const BOWEL_GROUP_SIZE = 8;
export const BOWEL_GROUPS = Math.ceil((BOWEL_NODES.length - 1) / BOWEL_GROUP_SIZE);
/** Esferas conservadoras por grupo: descarte antes de recorrer los segmentos. */
export const BOWEL_BOUNDS = Array.from({ length: BOWEL_GROUPS }, (_, k): [number, number, number, number] => {
  const p = BOWEL_NODES.slice(k * BOWEL_GROUP_SIZE, Math.min(BOWEL_NODES.length, (k + 1) * BOWEL_GROUP_SIZE + 1));
  const c = [0, 1, 2].map((j) => (Math.min(...p.map((v) => v[j])) + Math.max(...p.map((v) => v[j]))) / 2) as Vec3;
  return [...c, Math.max(...p.map((v) => Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]))) + BOWEL_RADIUS_MM];
});
export const BOWEL_TEXELS = BOWEL_GROUPS + 2 * BOWEL_NODES.length;
/** Campos de serosa y luz, uniones independientes; gradientes analíticos en el segmento ganador.
 * Los campos no son distancias euclídeas: su norma se conserva para el eco de interfaz. */
export function bowelQuery(m: Vec3, radii: ArrayLike<number> = BOWEL_REST_RADII) {
  let d = BOWEL_FIELD_REACH_MM,
    lumen = BOWEL_FIELD_REACH_MM + BOWEL_WALL_MM;
  let normal: Vec3 = [0, 1, 0],
    lumenNormal: Vec3 = [0, 1, 0],
    axis: Vec3 = [0, 0, 1];
  let radius = BOWEL_RADIUS_MM;
  for (let g = 0; g < BOWEL_GROUPS; g++) {
    const bound = BOWEL_BOUNDS[g];
    if (Math.hypot(...m.map((x, j) => x - bound[j])) - bound[3] > BOWEL_FIELD_REACH_MM) continue;
    for (let i = g * BOWEL_GROUP_SIZE; i < Math.min((g + 1) * BOWEL_GROUP_SIZE, BOWEL_NODES.length - 1); i++) {
      const a = BOWEL_NODES[i],
        b = BOWEL_NODES[i + 1];
      const v = b.map((x, j) => x - a[j]) as Vec3,
        len = Math.hypot(...v);
      const u = v.map((x) => x / len) as Vec3,
        p = m.map((x, j) => x - a[j]) as Vec3;
      const h = p.reduce((sum, x, j) => sum + x * u[j], 0) / len,
        t = Math.max(0, Math.min(1, h));
      const q = p.map((x, j) => x - t * v[j]) as Vec3,
        rho = Math.hypot(...q);
      const n = rho > 1e-8 ? (q.map((x) => x / rho) as Vec3) : ([0, 1, 0] as Vec3);
      const active = h > 0 && h < 1;
      const r = radii[i] + (radii[i + 1] - radii[i]) * t * t * (3 - 2 * t);
      const dr = active ? ((radii[i + 1] - radii[i]) * 6 * t * (1 - t)) / len : 0;
      const arc = BOWEL_ARC[i] + t * len,
        phase = (arc * 2 * Math.PI) / BOWEL_FOLD_PERIOD_MM;
      // Crestas redondeadas separadas: fase continua entre segmentos, independiente del grano.
      const c = 0.5 + 0.5 * Math.cos(phase),
        fold = BOWEL_FOLD_MM * c * c;
      const df = active ? (-BOWEL_FOLD_MM * c * Math.sin(phase) * 2 * Math.PI) / BOWEL_FOLD_PERIOD_MM : 0;
      const outer = rho - r,
        inner = outer + BOWEL_WALL_MM + fold;
      if (outer < d) {
        d = outer;
        normal = n.map((x, j) => x - dr * u[j]) as Vec3;
        axis = u;
        radius = r;
      }
      if (inner < lumen) {
        lumen = inner;
        lumenNormal = n.map((x, j) => x + (df - dr) * u[j]) as Vec3;
      }
    }
  }
  return { d, lumen, normal, lumenNormal, axis, radius };
}
export function bowelSdf(m: Vec3, radii: ArrayLike<number> = BOWEL_REST_RADII): number {
  return bowelQuery(m, radii).d;
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
float bowelQuery(vec3 m, out vec3 n, out vec3 axis, out float lumen, out vec3 ln, out float radius) {
  float d=BOWEL_REACH; lumen=BOWEL_REACH+BOWEL_WALL;n=vec3(0,1,0);ln=n;axis=vec3(0,0,1);radius=BOWEL_RADIUS;
  for(int g=0;g<${BOWEL_GROUPS};g++){
    vec4 bound=sceneTexel(BOWEL_BASE+g);
    if(distance(m,bound.xyz)-bound.w>BOWEL_REACH)continue;
    for(int j=0;j<${BOWEL_GROUP_SIZE};j++){
      int i=g*${BOWEL_GROUP_SIZE}+j;if(i>=${BOWEL_NODES.length - 1})break;
      vec4 a=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS}+i), b=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS}+i+1);
      vec3 v=b.xyz-a.xyz;float len=length(v);vec3 u=v/len,p=m-a.xyz;
      float h=dot(p,u)/len,t=clamp(h,0.0,1.0);vec3 q=p-t*v;float rho=length(q);vec3 nn=rho>1e-8?q/rho:vec3(0,1,0);
      float ra=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS + BOWEL_NODES.length}+i).x;
      float rb=sceneTexel(BOWEL_BASE+${BOWEL_GROUPS + BOWEL_NODES.length}+i+1).x;
      float r=mix(ra,rb,t*t*(3.0-2.0*t)),dr=(h>0.0&&h<1.0)?(rb-ra)*6.0*t*(1.0-t)/len:0.0;
      float phase=(a.w+t*len)*${(2 * Math.PI) / BOWEL_FOLD_PERIOD_MM},c=0.5+0.5*cos(phase);
      float fold=${f(BOWEL_FOLD_MM)}*c*c,df=(h>0.0&&h<1.0)?-${f(BOWEL_FOLD_MM)}*c*sin(phase)*${(2 * Math.PI) / BOWEL_FOLD_PERIOD_MM}:0.0;
      float outer=rho-r,inner=outer+BOWEL_WALL+fold;
      if(outer<d){d=outer;n=nn-dr*u;axis=u;radius=r;}
      if(inner<lumen){lumen=inner;ln=nn+(df-dr)*u;}
    }
  }
  return d;
}
float bowelSdf(vec3 m){vec3 n,axis,ln;float lumen,r;return bowelQuery(m,n,axis,lumen,ln,r);}
float bowelGasSdf(vec3 m,float lumen){
  float d=1e3;
  ${BOWEL_GAS.map((g) => `d=min(d,(length((m-vec3(${g.center.map(f).join(',')}))/vec3(${g.radii.map(f).join(',')}))-1.0)*${f(Math.min(...g.radii))});`).join('\n')}
  return max(lumen,d);
}
`;
