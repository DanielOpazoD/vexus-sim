import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { Interface } from '../anatomy/interfaces';
import {
  HEART_CAVITIES,
  HEART_GLSL,
  HEART_WALLS,
  IVC_ORIFICE_MM,
  MEDIASTINUM,
  domeFloor,
  heartChambers,
  heartOuterSdf,
  ivcAtrium,
  thorax,
} from '../anatomy/organs/heart';
import { HEART_CHAMBER_IDS, heartChamber, type HeartChamber } from '../anatomy/organs/heartChamber';
import { sdDiaphragm, diaphragmHeight, torsoDepth } from '../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER, type VesselCaliber } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

/**
 * Corazón y mediastino (decisión 85): por encima de la cúpula ya no todo es pulmón. Marco levógiro: x = izquierda del
 * paciente, y = anterior, z = craneal (z 0 en la punta del xifoides, cúpula derecha a +55, T8–T9).
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const cls = (m: Vec3, cal: VesselCaliber = BASELINE_CALIBER) => scene.classify(m, cal);
const dome = (m: Vec3) => sdDiaphragm(m, scene.diaphragm, scene.torso);
/** El suelo del corazón (`heartFloor`): la distancia a la cúpula con su pendiente limitada a 2. */
const floorOf = (m: Vec3) => domeFloor(m, scene.diaphragm, scene.torso);
const WALL4 = [HEART_WALLS.lv, HEART_WALLS.rv, HEART_WALLS.ra, HEART_WALLS.la] as const;

/** Muestras de cada cavidad (sangre de `classify` sin vaso) en una rejilla de 1,5 mm del tórax. */
const STEP = 1.5;
const chambers = new Map<HeartChamber, Vec3[]>(HEART_CHAMBER_IDS.map((c) => [c, []]));
for (let x = -60; x < 90; x += STEP)
  for (let y = -30; y < 85; y += STEP)
    for (let z = 5; z < 125; z += STEP) {
      const m: Vec3 = [x, y, z];
      const c = cls(m);
      if (c.tissue !== Tissue.Blood || c.vessel) continue;
      const ch = heartChamber(m, floorOf(m));
      if (ch) chambers.get(ch)!.push(m);
    }
const centroid = (pts: Vec3[]): Vec3 => [0, 1, 2].map((k) => pts.reduce((a, p) => a + p[k], 0) / pts.length) as Vec3;
const extent = (pts: Vec3[], k: number) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
const volumeMl = (pts: Vec3[]) => (pts.length * STEP ** 3) / 1000;

/** Tramos de tejido a lo largo de un rayo (paso 0,1 mm): [tejido, desde, hasta] (mm desde el origen). */
function runs(o: Vec3, d: Vec3, lenMm: number): Array<[Tissue, number, number]> {
  const out: Array<[Tissue, number, number]> = [];
  for (let s = 0; s <= lenMm; s += 0.1) {
    const t = cls([o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s]).tissue;
    const last = out.at(-1);
    if (last && last[0] === t) last[2] = s;
    else out.push([t, s, s]);
  }
  return out;
}

describe('Corazón y mediastino (decisión 85)', () => {
  it('cuatro cavidades en su sitio en el marco levógiro: AD a la derecha, VI a la izquierda, VD delante y AI detrás y arriba', () => {
    const c = Object.fromEntries(HEART_CHAMBER_IDS.map((id) => [id, centroid(chambers.get(id)!)])) as Record<HeartChamber, Vec3>;
    const tag = JSON.stringify(c);
    // la derecha del paciente es x < 0
    expect(c.ra[0], tag).toBeLessThan(-10);
    expect(c.lv[0], tag).toBeGreaterThan(20);
    // el VD delante y a la derecha del VI; la AI la más posterior y craneal
    expect(c.rv[1], tag).toBeGreaterThan(c.lv[1] + 5);
    expect(c.rv[0], tag).toBeLessThan(c.lv[0] - 10);
    for (const id of ['lv', 'rv'] as const) expect(c.la[1], tag).toBeLessThan(c[id][1] - 10);
    expect(c.la[2], tag).toBeGreaterThan(c.lv[2] + 20);
    // a la altura de la AI la AD queda delante y a la derecha (el tabique interauricular es oblicuo); más abajo, su suelo va
    // atrás, donde entra la VCI
    const high = (id: HeartChamber) => centroid(chambers.get(id)!.filter((p) => p[2] >= 85));
    expect(high('ra')[1], tag).toBeGreaterThan(high('la')[1] + 5);
    expect(high('ra')[0], tag).toBeLessThan(high('la')[0] - 20);
    // la punta, delante, abajo y a la izquierda: el punto del VI más alejado de la base
    const lv = chambers.get('lv')!;
    const apex = lv.reduce((a, p) => (p[0] + p[1] - p[2] > a[0] + a[1] - a[2] ? p : a));
    expect(apex[0], JSON.stringify(apex)).toBeGreaterThan(50);
    expect(apex[2], JSON.stringify(apex)).toBeLessThan(c.lv[2]);
  });

  it('tamaños de un adulto (ASE/EACVI 2015) y paredes: VD 3–5 mm, AD fina, VI y tabique más gruesos', () => {
    const ra = chambers.get('ra')!;
    const tag = JSON.stringify(Object.fromEntries(HEART_CHAMBER_IDS.map((id) => [id, +volumeMl(chambers.get(id)!).toFixed(0)])));
    // AD: eje mayor (craneocaudal) ≤ 53 mm y menor ≤ 44 mm, sin quedarse en una ranura
    expect(extent(ra, 2), tag).toBeLessThanOrEqual(53);
    expect(extent(ra, 2), tag).toBeGreaterThan(38);
    expect(extent(ra, 0), tag).toBeLessThanOrEqual(44);
    expect(extent(ra, 0), tag).toBeGreaterThan(30);
    // volúmenes (mL) de un corazón estático a mitad de ciclo
    expect(volumeMl(ra), tag).toBeGreaterThan(25);
    expect(volumeMl(ra), tag).toBeLessThan(60);
    expect(volumeMl(chambers.get('lv')!), tag).toBeGreaterThan(45);
    expect(volumeMl(chambers.get('rv')!), tag).toBeGreaterThan(30);
    expect(volumeMl(chambers.get('la')!), tag).toBeGreaterThan(25);
    // paredes (constantes del esquema, las que recorre `thorax`)
    expect(HEART_WALLS.rv).toBeGreaterThanOrEqual(3);
    expect(HEART_WALLS.rv).toBeLessThanOrEqual(5);
    expect(HEART_WALLS.ra).toBeLessThanOrEqual(3);
    expect(HEART_WALLS.lv).toBeGreaterThanOrEqual(6);
    expect(HEART_WALLS.lv).toBeLessThanOrEqual(10);
    expect(HEART_WALLS.ivs).toBeGreaterThanOrEqual(6);
    expect(HEART_WALLS.ivs).toBeLessThanOrEqual(11);
    // …y en la anatomía: la pared libre del VD, de la cavidad hacia delante (fuera del recorte de la cúpula), es miocardio de
    // 3–5 mm y después el pericardio
    const rv = chambers.get('rv')!;
    const front = rv.filter((p) => p[2] > 45 && p[2] < 60).reduce((a, p) => (p[1] > a[1] ? p : a));
    const seq = runs([front[0], front[1] - 2, front[2]], [0, 1, 0], 25);
    const myo = seq.find((r) => r[0] === Tissue.Myocardium);
    const tagRv = JSON.stringify(seq.map(([t, a, b]) => [Tissue[t], +a.toFixed(1), +b.toFixed(1)]));
    expect(myo, tagRv).toBeDefined();
    expect(myo![2] - myo![1], tagRv).toBeGreaterThanOrEqual(2.9);
    expect(myo![2] - myo![1], tagRv).toBeLessThanOrEqual(5.5);
    expect(seq[seq.indexOf(myo!) + 1][0], tagRv).toBe(Tissue.Mediastinum);
  });

  it('el corazón apoya en el diafragma: bajo su huella, justo por encima de la cúpula, nunca hay pulmón', () => {
    let columns = 0;
    const lung: string[] = [];
    for (let x = -50; x <= 80; x += 3)
      for (let y = -20; y <= 75; y += 3) {
        const zd = diaphragmHeight(x, y, scene.diaphragm, scene.torso);
        if (-torsoDepth([x, y, zd], scene.torso) - scene.wallThickness() < 5) continue;
        // ¿hay corazón en la vertical, a menos de 20 mm de la cúpula?
        let above = false;
        for (let dz = 1; dz <= 20 && !above; dz += 1) above = heartOuterSdf([x, y, zd + dz], floorOf([x, y, zd + dz])) < 0;
        if (!above) continue;
        columns++;
        for (const dz of [0.3, 1, 2, 4])
          if (cls([x, y, zd + dz]).tissue === Tissue.Lung) lung.push(`(${x}, ${y}, ${(zd + dz).toFixed(1)})`);
      }
    expect(columns).toBeGreaterThan(300);
    expect(lung, lung.slice(0, 8).join(' ')).toEqual([]);
  });

  it('el pericardio: capa de 1,5 mm de tejido del mediastino entre el miocardio y la grasa, que dibuja su cara de un lado', () => {
    // del centro del VI hacia la izquierda, por su pared lateral
    const lv = centroid(chambers.get('lv')!);
    const seq = runs(lv, [1, 0, 0], 60);
    const i = seq.findIndex((r) => r[0] === Tissue.Myocardium);
    const tag = JSON.stringify(seq.map(([t, a, b]) => [Tissue[t], +a.toFixed(1), +b.toFixed(1)]));
    expect(i, tag).toBeGreaterThan(0);
    // tras el miocardio, el mediastino: su primer 1,5 mm dibuja la cara del pericardio, a la distancia del epicardio
    const edge = seq[i][2] + 0.05;
    let faced = 0;
    for (let s = 0; s < 3; s += 0.1) {
      const m: Vec3 = [lv[0] + edge + s, lv[1], lv[2]];
      const c = cls(m);
      expect(c.tissue, `${tag} a +${s.toFixed(1)}`).toBe(Tissue.Mediastinum);
      const d = heartOuterSdf(m, floorOf(m));
      if (d < HEART_WALLS.pericardium - 0.05) {
        faced++;
        expect(c.interface).toBe(Interface.Pericardium);
        expect(c.interfaceDistance).toBeCloseTo(d, 9);
      } else if (d > HEART_WALLS.pericardium + 0.05) expect(c.interface).toBe(Interface.None);
    }
    expect(faced).toBeGreaterThan(10);
    // el miocardio y la sangre no dibujan cara
    expect(cls([lv[0] + seq[i][1] + 1, lv[1], lv[2]]).interface).toBe(Interface.None);
    expect(cls(lv).interface).toBe(Interface.None);
  });

  it('mediastino alrededor de la aorta torácica y del saco; los pulmones a los lados y detrás', () => {
    // la aorta por encima de la cúpula: a 3 mm de su pared, a los lados y (bajo la AI, que se le apoya delante desde z ~65)
    // delante, tejido del mediastino (antes, pulmón)
    const aorta = scene.vessels.find((v) => v.id === 'aorta')!.tube.nodes[0].p;
    let around = 0;
    for (const z of [30, 50, 70, 90, 110])
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [-1, 0],
      ] as const) {
        const m: Vec3 = [aorta[0] + dx * 16, aorta[1] + dy * 16, z];
        if (dome(m) >= 0 || (dy > 0 && z >= 70)) continue;
        around++;
        expect(Tissue[cls(m).tissue], JSON.stringify(m)).toBe('Mediastinum');
      }
    expect(around).toBeGreaterThan(10);
    // pulmón lateral al corazón (derecho e izquierdo) y detrás de la aurícula derecha
    for (const m of [
      [-75, -5, 70],
      [95, 10, 60],
      [-35, -35, 75],
    ] as Vec3[])
      expect(Tissue[cls(m).tissue], JSON.stringify(m)).toBe('Lung');
    // la esfera de descarte de `thorax` contiene todo lo que no es pulmón: en su cáscara interior de 3 mm, todo es pulmón
    const b = MEDIASTINUM.bound;
    let shell = 0;
    for (let i = 0; i < 20000; i++) {
      // direcciones de Fibonacci y radios en [r − 3, r]
      const zz = 1 - (2 * (i + 0.5)) / 20000;
      const a = i * 2.399963;
      const rr = b.r - 3 * ((i * 0.618034) % 1);
      const m: Vec3 = [
        b.c[0] + rr * Math.sqrt(1 - zz * zz) * Math.cos(a),
        b.c[1] + rr * Math.sqrt(1 - zz * zz) * Math.sin(a),
        b.c[2] + rr * zz,
      ];
      if (torsoDepth(m, scene.torso) > -scene.wallThickness()) continue;
      const d = dome(m);
      if (d >= 0) continue;
      shell++;
      expect(Tissue[thorax(m, d, floorOf(m)).tissue], m.map((v) => v.toFixed(1)).join(', ')).toBe('Lung');
    }
    expect(shell).toBeGreaterThan(3000);
  });

  it('la VCI cruza el hiato con una cintura y se abre en el suelo de la AD (el «tell» de la ronda 3: paredes paralelas)', () => {
    const nodes = scene.vessels.find((v) => v.id === 'ivcSupra')!.tube.nodes;
    const at = (z: number) => nodes.find((n) => Math.abs(n.p[2] - z) < 0.5)!;
    const hiatus = at(53);
    // la cintura en el hiato (z 53: la cúpula en el eje de la VCI), más estrecha que la confluencia de las suprahepáticas
    // y que el orificio de la aurícula
    expect(dome(hiatus.p)).toBeLessThan(1.5);
    expect(dome(hiatus.p)).toBeGreaterThan(-1.5);
    expect(hiatus.r).toBeLessThan(at(47).r - 0.8);
    expect(hiatus.r).toBeLessThan(at(58).r - 2);
    // a lo largo del eje, del hiato hacia arriba, la luz de la VCI sigue en la cavidad de la AD sin pared de por medio
    const top = nodes.at(-1)!.p;
    const d: Vec3 = [top[0] - hiatus.p[0], top[1] - hiatus.p[1], top[2] - hiatus.p[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const seq = runs(hiatus.p, [d[0] / len, d[1] / len, d[2] / len], len + 12);
    const tag = JSON.stringify(seq.map(([t, a, b]) => [Tissue[t], +a.toFixed(1), +b.toFixed(1)]));
    expect(
      seq.map((r) => r[0]),
      tag,
    ).toEqual([Tissue.Blood]);
    // el orificio: la AD empieza a pocos milímetros de la cúpula
    const floor = ivcAtrium(top, floorOf(top));
    expect(floor.cavity).toBeLessThan(0);
    expect(IVC_ORIFICE_MM).toBeLessThan(6);
  });

  it('con la VCI dilatada de la congestión (×1,57) su embudo no atraviesa paredes ni tabiques ni entra en la AI: gana el corazón', () => {
    const cal: VesselCaliber = { ...BASELINE_CALIBER, radiusScale: (id) => (id.startsWith('ivc') ? 1.57 : 1), ivcApScale: 0.99 };
    // por encima del suelo de la aurícula, donde la VCI toca el corazón, el tejido es el del corazón (`thorax`): la luz y la
    // pared de la VCI solo cambian a sangre dentro de la cavidad tallada de la AD; fuera de ella (tabiques, AI, VI) la VCI
    // no existe
    let above = 0;
    let heart = 0;
    let inLa = 0;
    for (let x = -44.5; x <= 30; x += 1)
      for (let y = -29.5; y <= 30; y += 1)
        for (let z = 50; z <= 100; z += 1) {
          const m: Vec3 = [x, y, z];
          const t = scene.faceTube(m, cal);
          if (!t || t.vessel !== 'ivcSupra') continue;
          const f = floorOf(m);
          if (f >= -IVC_ORIFICE_MM) continue;
          above++;
          const c = cls(m, cal);
          const tag = JSON.stringify(m);
          expect(Tissue[c.tissue], tag).toBe(Tissue[thorax(m, dome(m), f).tissue]);
          if (heartChambers(m)[2] >= 0) {
            heart++;
            expect(c.vessel, tag).toBeNull();
            expect(ivcAtrium(m, f).outside, tag).toBe(true);
            if (heartChamber(m, f) === 'la') inLa++;
          }
        }
    expect(above).toBeGreaterThan(1000);
    // la VCI de la congestión llega a los tabiques y a la AI (antes su luz, con flujo, entraba en ella)
    expect(heart).toBeGreaterThan(100);
    expect(inLa).toBeGreaterThan(10);
  });

  it('el suelo del corazón sigue a la cúpula sin cortinas: lejos de ella, dentro de una cavidad, solo hay sangre', () => {
    // la distancia de verdad a la cúpula (la superficie z = altura del diafragma, en una rejilla de 0,5 mm): un punto está a
    // más de r de ella si queda por encima de max(altura + √(r² − ρ²)) en el disco de radio r (ρ, distancia horizontal)
    const H = (x: number, y: number) => diaphragmHeight(x, y, scene.diaphragm, scene.torso);
    const G = 0.5;
    const hCache = new Map<string, number>();
    const hAt = (x: number, y: number) => {
      const k = `${x},${y}`;
      let v = hCache.get(k);
      if (v === undefined) hCache.set(k, (v = H(x, y)));
      return v;
    };
    const zFar = (x: number, y: number, r: number) => {
      let z = -1e9;
      for (let dx = -r; dx <= r; dx += G)
        for (let dy = -r; dy <= r; dy += G) {
          const rho2 = dx * dx + dy * dy;
          if (rho2 <= r * r) z = Math.max(z, hAt(x + dx, y + dy) + Math.sqrt(r * r - rho2));
        }
      return z;
    };
    let tested = 0;
    const bad: string[] = [];
    // (fuera de x = y = 0, donde las costillas de `sdRib` tienen una singularidad)
    for (let x = -49.5; x <= 76; x += 2)
      for (let y = -23.5; y <= 80; y += 2) {
        if (-torsoDepth([x, y, H(x, y)], scene.torso) - scene.wallThickness() < 3) continue;
        // 3 mm de margen: el suelo es la distancia al plano tangente, que en el pliegue entre las hemicúpulas (convexas)
        // se queda hasta 2,2 mm corta (la pared inferior del VI, algo más gruesa); antes, las cortinas llegaban a 27 mm
        const zf = WALL4.map((w) => zFar(x, y, w + HEART_WALLS.pericardium + 3));
        for (let z = Math.min(...zf); z < 80; z += 1) {
          const m: Vec3 = [x, y, z];
          const c = heartChambers(m);
          // dentro de la cavidad tallada i (sin el recorte) y a más de su pared + pericardio + 3 mm de la cúpula
          const i = [0, 1, 2, 3].find((k) => c[k] < 0 && z > zf[k]);
          if (i === undefined) continue;
          tested++;
          const q = cls(m);
          if (q.tissue !== Tissue.Blood) bad.push(`${JSON.stringify(m)} ${Tissue[q.tissue]}`);
        }
      }
    expect(tested).toBeGreaterThan(2000);
    expect(bad, bad.slice(0, 6).join(' · ')).toEqual([]);
    // la cortina de miocardio que partía el VD sobre el borde de la hemicúpula (revisión de la decisión 85)
    for (const m of [
      [4, 60.5, 45],
      [10, 53.5, 52],
    ] as Vec3[])
      expect(Tissue[cls(m).tissue], JSON.stringify(m)).toBe('Blood');
  });

  it('la mitral y la tricúspide son orificios abiertos: la AI se abre en el VI y la AD en el VD', () => {
    const p = HEART_WALLS.pericardium;
    let mitral = 0;
    let tricuspid = 0;
    const span = [
      [1e9, -1e9],
      [1e9, -1e9],
      [1e9, -1e9],
    ];
    for (let x = -40; x <= 50; x += 1)
      for (let y = -20; y <= 60; y += 1)
        for (let z = 40; z <= 100; z += 1) {
          const m: Vec3 = [x, y, z];
          const f = floorOf(m);
          if (dome(m) >= 0) continue;
          const c = heartChambers(m).map((v, k) => Math.max(v, f + p + WALL4[k]));
          if (cls(m).tissue !== Tissue.Blood) continue;
          if (c[0] < 0 && c[3] < 0) {
            mitral++;
            for (let k = 0; k < 3; k++) span[k] = [Math.min(span[k][0], m[k]), Math.max(span[k][1], m[k])];
          }
          if (c[1] < 0 && c[2] < 0) tricuspid++;
        }
    // mm³ de sangre compartida por las dos cavidades y la anchura del orificio mitral (el esquema: 14–20 mm)
    expect(mitral).toBeGreaterThan(500);
    expect(Math.max(span[0][1] - span[0][0], span[1][1] - span[1][0]), JSON.stringify(span)).toBeGreaterThanOrEqual(14);
    expect(tricuspid).toBeGreaterThan(500);
  });

  it('la geometría es la misma en todos los casos (un esquema estático)', () => {
    for (const c of CASES) {
      const s = new AnatomyScene(c);
      for (const m of [
        [-23, 3, 75],
        [39, 30, 50],
        [8, 9, 96],
      ] as Vec3[])
        expect(s.classify(m, BASELINE_CALIBER).tissue, `${c.id} ${JSON.stringify(m)}`).toBe(Tissue.Blood);
    }
  });

  it('el GLSL lleva las constantes del módulo y los tejidos y la cara nuevos', () => {
    for (const v of [HEART_CAVITIES.ra.c, HEART_CAVITIES.rv.r])
      expect(HEART_GLSL).toContain(`vec3(${v.map((x) => x.toFixed(4)).join(',')})`);
    expect(ANATOMY_GLSL).toContain(HEART_GLSL);
    for (const name of ['T_MYOCARDIUM', 'T_MEDIASTINUM', 'IF_PERICARDIUM'])
      expect(ANATOMY_GLSL).toMatch(new RegExp(`#define ${name} \\d+`));
    // classify: el tórax en vez del pulmón y la VCI que entra en la aurícula
    expect(ANATOMY_GLSL).toContain('c.tissue = thorax(m, dDome, c.bd, ifd, c.n);');
    expect(ANATOMY_GLSL).toContain('c.bd = min(c.bd, min(dSpine, -depth - wall));');
    // el suelo del corazón: la pendiente de la cúpula (−1/n.z) limitada a 2, en la VCI y en thorax (que la saca de n)
    expect(ANATOMY_GLSL).toContain('ivc = ivcAtrium(m, dDome * max(1.0, -0.5 / dn.z));');
    expect(HEART_GLSL).toContain('float hF = dDome * max(1.0, -0.5 / n.z);');
    // una sola llamada a epiNormal (se alinea en cada clasificación)
    expect(HEART_GLSL.split('epiNormal(').length - 1).toBe(2);
    expect(ANATOMY_GLSL).not.toContain('uRA');
  });
});
