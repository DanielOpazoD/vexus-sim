import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { torsoDepth, torsoDepthGradient, torsoSkinPoint } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, type ProbePose } from '../probe/probe';
import { startPointsFor } from '../app/startPoints';
import {
  s0028ContactFace,
  s0028ContactInside,
  s0028InsideWall,
  s0028SkinPoint,
  s0028WallAt,
  s0028WallUploads,
  setS0028Wall,
} from '../anatomy/s0028Wall';
import { setS0028Solids } from '../anatomy/s0028Solids';
import { HALF } from '../anatomy/halfFloat';
import { CONTACT, probeContact, type ProbeContact } from '../probe/contact';
import { nodeSin, warpAt, warpBound } from '../anatomy/compression';
import { respiratoryWeightGradient } from '../anatomy/respiratoryNormals';
import { smoothstep, type Vec3 } from '../core/vec3';
import { indexedSurfaces } from '../anatomy/s0028Surface';

// Ronda r2b-U (decisiones del propietario 04-11-2026): la sonda acopla por la piel en todo el dominio; un nodo U comprime
// contra la cara interna E del nodo conocido más cercano a ≤12 mm (rotulada) o, sin él, sólo por la piel; la respiración de
// una celda U es una rampa por profundidad con p10/p90 de la cara interna conocida de su fila.
const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
const TILE_WORDS = 65 * 91 * 2 * 2;
const E_OFFSET = 4096 + B.wall.payloadBytes;
let scene: AnatomyScene, capacity: ArrayBuffer, skin: ArrayBuffer;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  capacity = raw('annotation-capacity');
  skin = raw('skin-polar');
  setS0028Wall(capacity, skin);
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
});

const nodeWord = (tiles: Uint16Array, row: number, col: number, k: number) => {
  const band = row < 90 ? 0 : 1;
  return tiles[(band * 8 + (col >> 6)) * TILE_WORDS + ((91 + row - 90 * band) * 65 + (col & 63)) * 2 + k];
};
const knownCode = (code: number) => [8, 32, 128].every((f) => Math.floor(code / f) % 4 !== 0);
const chartPhi = (col: number) => (col * 2 * Math.PI) / 512;
const chartZ = (row: number) => row * 1.5 - 210;
const poseOf = (p: ProbePose | (Omit<ProbePose, 'rock' | 'tilt' | 'lift'> & Partial<ProbePose>)): ProbePose => ({
  ...p,
  rock: p.rock ?? 0,
  tilt: p.tilt ?? 0,
  lift: p.lift ?? 0,
});
/** El punto a r mm de la cara a lo largo de la línea del nodo k (marco efectivo del contacto). */
const lineAt = (k: ProbeContact, n: number) => {
  const s = nodeSin(n, CONVEX_C35.halfSector),
    c = Math.sqrt(1 - s * s),
    f = k.frame;
  const dir: Vec3 = [f.axial[0] * c + f.lateral[0] * s, f.axial[1] * c + f.lateral[1] * s, f.axial[2] * c + f.lateral[2] * s];
  return (r: number): Vec3 => [
    f.curvatureCenter[0] + dir[0] * (CONVEX_C35.curvatureRadius + r),
    f.curvatureCenter[1] + dir[1] * (CONVEX_C35.curvatureRadius + r),
    f.curvatureCenter[2] + dir[2] * (CONVEX_C35.curvatureRadius + r),
  ];
};
/** Rampa independiente de la del runtime: fila de la proyección EDT p − τ∇τ/max(|∇τ|², 1e-6), recortada a [0, 180]. */
const rampFor = (p: Vec3) => {
  const ramps = new Uint16Array(capacity, B.wallDerived.ramps.offsetBytes + 4096, 362);
  const tau = torsoDepth(p, scene.torso),
    g = torsoDepthGradient(p, scene.torso),
    gg = Math.max(g[0] * g[0] + g[1] * g[1] + g[2] * g[2], 0.000001);
  const row = Math.min(180, Math.max(0, (p[2] - (tau * g[2]) / gg + 210) / 1.5)),
    lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  return {
    tau,
    d0: HALF[ramps[2 * lo]] * (1 - t) + HALF[ramps[2 * hi]] * t,
    d1: HALF[ramps[2 * lo + 1]] * (1 - t) + HALF[ramps[2 * hi + 1]] * t,
  };
};
const spineWeight = (m: Vec3) =>
  smoothstep(scene.spine.r + 5, scene.spine.r + 35, Math.hypot(m[0] - scene.spine.x0, m[1] - scene.spine.y0));

it('el bloque derivado sale del payload fijado: cada nodo conocido lleva su cara y cada U con E la de un conocido a ≤12 mm', () => {
  const tiles = new Uint16Array(capacity, 4096, B.wall.payloadBytes / 2),
    e = new Uint16Array(capacity, E_OFFSET, 512 * 181 * 2);
  let withE = 0,
    without = 0,
    farthest = 0;
  for (let row = 0; row < 181; row++)
    for (let col = 0; col < 512; col++) {
      const value = e[(row * 512 + col) * 2],
        code = HALF[e[(row * 512 + col) * 2 + 1]];
      if (knownCode(HALF[nodeWord(tiles, row, col, 1)])) {
        expect(value).toBe(nodeWord(tiles, row, col, 0));
        expect(code).toBe(272);
        continue;
      }
      if (Number.isNaN(code)) {
        expect(Number.isNaN(HALF[value])).toBe(true);
        without++;
        continue;
      }
      const r = row + Math.floor(code / 32) - 8,
        c = (col + (code % 32) - 16 + 512) % 512;
      expect(knownCode(HALF[nodeWord(tiles, r, c, 1)])).toBe(true);
      expect(value).toBe(nodeWord(tiles, r, c, 0));
      // La métrica offline usa las semillas de piel; el punto de piel corregido sólo difiere en el radio.
      const a = s0028SkinPoint(chartPhi(col), chartZ(row))!,
        b = s0028SkinPoint(chartPhi(c), chartZ(r))!;
      farthest = Math.max(farthest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      withE++;
    }
  expect(withE).toBe(B.wallDerived.eMap.nodesWithE);
  expect(withE + without).toBe(57664);
  expect(farthest).toBeLessThan(12.5);
  expect(farthest).toBeGreaterThan(11);
});

it('la carga rechaza un mapa E con cara sin fuente, con fuente U o con otra cara, y una rampa cruzada', () => {
  const tiles = new Uint16Array(capacity, 4096, B.wall.payloadBytes / 2),
    e = new Uint16Array(capacity, E_OFFSET, 512 * 181 * 2);
  // Un nodo U sin E, otro U con E y su fuente; posterior U/P3 en la fila 100 no tiene conocido a 12 mm.
  const uNoE = (100 * 512 + 384) * 2;
  expect(Number.isNaN(HALF[e[uNoE + 1]])).toBe(true);
  let withE = -1;
  for (let i = 0; i < 512 * 181 && withE < 0; i++) if (!Number.isNaN(HALF[e[2 * i + 1]]) && HALF[e[2 * i + 1]] !== 272) withE = 2 * i;
  const ramp = B.wallDerived.ramps.offsetBytes + 4096;
  const cases: [(words: Uint16Array, all: ArrayBuffer) => void, RegExp][] = [
    [(w) => (w[uNoE] = 0x4f80), /cara sin fuente/],
    // Un nodo U con el código del propio nodo (272) se haría pasar por conocido.
    [(w) => (w[withE + 1] = 0x5c40), /nodo U/],
    [(w) => (w[withE] ^= 1), /otra cara/],
    [(w) => (w[(50 * 512 + 128) * 2] ^= 1), /su nodo conocido/],
    [(_, all) => (new Uint16Array(all, ramp, 362)[2 * 60 + 1] = new Uint16Array(all, ramp, 362)[2 * 60]), /Rampa/],
  ];
  expect(knownCode(HALF[nodeWord(tiles, 50, 128, 1)])).toBe(true);
  try {
    for (const [mutate, message] of cases) {
      const bad = capacity.slice(0);
      mutate(new Uint16Array(bad, E_OFFSET, 512 * 181 * 2), bad);
      expect(() => setS0028Wall(bad, skin), String(message)).toThrow(message);
    }
  } finally {
    setS0028Wall(capacity, skin);
  }
});

it('E no se trata como D: una celda U con E sigue U para la clasificación, la cara y la respiración regional', () => {
  const e = new Uint16Array(capacity, E_OFFSET, 512 * 181 * 2);
  const hasE = (row: number, col: number) => !Number.isNaN(HALF[e[(row * 512 + (col % 512)) * 2]]);
  const tiles = new Uint16Array(capacity, 4096, B.wall.payloadBytes / 2);
  let checked = 0;
  for (let row = 21; row < 140 && checked < 40; row += 3)
    for (let col = 0; col < 512 && checked < 40; col += 2) {
      const corners = [
        [row, col],
        [row, col + 1],
        [row + 1, col],
        [row + 1, col + 1],
      ];
      if (!corners.every(([r, c]) => hasE(r, c))) continue;
      if (corners.every(([r, c]) => knownCode(HALF[nodeWord(tiles, r, c % 512, 1)]))) continue;
      const surface = s0028SkinPoint(chartPhi(col + 0.5), chartZ(row + 0.5))!,
        g = torsoDepthGradient(surface, scene.torso),
        n = Math.hypot(...g);
      for (const d of [4, 15]) {
        const p: Vec3 = [surface[0] - (d * g[0]) / n, surface[1] - (d * g[1]) / n, surface[2] - (d * g[2]) / n];
        const q = s0028WallAt(p);
        if (q?.kind !== 'unknown' || q.reason !== 'coverage') continue;
        const face = s0028ContactFace(p);
        if (face === null) continue;
        expect(face.source).toBe('E');
        expect(s0028InsideWall(p)).toBeNull();
        expect(s0028ContactInside(p)).toBe(face.insideMm);
        expect(String(scene.classify(p, BASELINE_CALIBER).wall)).not.toMatch(/D\/E/);
        checked++;
      }
    }
  expect(checked).toBeGreaterThanOrEqual(20);
  // En una celda D/E la cara del contacto es la de la carta, bit a bit.
  for (const p of [[-115, 44, -108] as Vec3]) {
    expect(s0028ContactFace(p)?.source).toBe('D/E');
    expect(Object.is(s0028ContactInside(p), s0028InsideWall(p))).toBe(true);
  }
});

it('la sonda acopla por la piel sobre celdas U: cada nodo con piel tiene cara D/E, E o sólo piel', () => {
  let uEntry = 0,
    eNodes = 0;
  for (const sp of startPointsFor(scene.torso, B)) {
    const k = probeContact(poseOf(sp), CONVEX_C35, scene.torso);
    const sources = k.summary.wallSourceByNode;
    expect(sources, sp.id).toHaveLength(k.nodes.length);
    k.summary.skinAlongMm.forEach((rs, n) => {
      const source = sources![n];
      if (Number.isNaN(rs)) return void expect(source).toBe('none');
      expect(['D/E', 'E', 'skin']).toContain(source);
      const entry = s0028WallAt(lineAt(k, n)(rs));
      if (entry?.kind === 'known') return void expect(source, `${sp.id} ${n}`).not.toBe('E');
      uEntry++;
      expect(source, `${sp.id} ${n}`).not.toBe('D/E');
      if (source === 'E') eNodes++;
    });
  }
  expect(uEntry).toBeGreaterThan(30);
  expect(eNodes).toBeGreaterThan(30);
});

it('un nodo U con vecino conocido a ≤12 mm comprime contra su cara E: D* = E + tolerancia', () => {
  let checked = 0;
  for (const sp of startPointsFor(scene.torso, B)) {
    const k = probeContact(poseOf(sp), CONVEX_C35, scene.torso);
    k.summary.wallSourceByNode!.forEach((source, n) => {
      if (source !== 'E') return;
      const rs = k.summary.skinAlongMm[n],
        rW = k.summary.wallAlongMm[n];
      const face = s0028ContactFace(lineAt(k, n)(rs))!;
      expect(face.source).toBe('E');
      const target = face.interfaceMm + CONTACT.wallTolMm;
      const D = Math.min(Math.max(rW, Math.min(target, rW - rs)), target + 20);
      expect(k.nodes[n][0]).toBe(Math.min(0, rs));
      expect(k.nodes[n][2]).toBeCloseTo(D, 9);
      expect(k.nodes[n][1]).toBeCloseTo(Math.min(0, rW - D), 9);
      // El cruce informado es la cara E del contacto: profundidad bajo ella cero.
      expect(Math.abs(s0028ContactInside(lineAt(k, n)(rW))!)).toBeLessThan(0.001);
      checked++;
    });
  }
  expect(checked).toBeGreaterThan(30);
});

it('sin nodo conocido a ≤12 mm: sólo piel, sin resistencia de pared, y la cara acopla', () => {
  // Espalda (posterior U/P3): ningún nodo conocido a 12 mm de la huella.
  const k = probeContact(poseOf({ phi: 4.7, z: -110, yaw: 0 }), CONVEX_C35, scene.torso);
  const sources = k.summary.wallSourceByNode!;
  const skinNodes = sources.filter((s) => s === 'skin').length;
  expect(skinNodes).toBeGreaterThan(40);
  expect(sources.every((s) => s === 'skin' || s === 'none')).toBe(true);
  sources.forEach((s, n) => {
    if (s !== 'skin') return;
    const skin = Math.min(0, k.summary.skinAlongMm[n]);
    expect(k.nodes[n]).toEqual([skin, skin, 1.5]);
  });
  // Sin cara no hay presión que conseguir: la sonda no se hunde y acopla lo que toca la piel.
  expect(k.summary.indentMm).toBe(0);
  const coupled = k.contact.filter((c) => c >= 0.5).length;
  expect(coupled).toBeGreaterThan(8);
});

it('sólo piel bajo presión: la piel y el tejido de debajo se trasladan juntos, sin salto en la cara ni cota desbocada', () => {
  // Revisión de la PR #330: con D = 0 la piel bajaba −8 mm y el tejido a 0,01 mm por debajo no se movía (cota 32).
  const start = (id: string): ProbePose => poseOf(startPointsFor(scene.torso, B).find((sp) => sp.id === id)!);
  const poses: ProbePose[] = [
    poseOf({ phi: 4.7, z: -110, yaw: 0, lift: -3 }),
    poseOf({ phi: 4.7, z: -110, yaw: 0, lift: -8 }),
    { ...start('renal'), lift: 0 },
    { ...start('portal'), lift: -6 },
  ];
  for (const pose of poses) {
    const k = probeContact(pose, CONVEX_C35, scene.torso);
    let pressed = 0;
    for (let i = 0; i < 64; i++) {
      const sigma = -k.halfAngle + (2 * k.halfAngle * i) / 63;
      const ca = Math.cos(sigma),
        sa = Math.sin(sigma);
      const dir: Vec3 = [k.axial[0] * ca + k.lateral[0] * sa, k.axial[1] * ca + k.lateral[1] * sa, k.axial[2] * ca + k.lateral[2] * sa];
      const at = (d: number): Vec3 => [
        k.center[0] + dir[0] * (k.radiusMm + d),
        k.center[1] + dir[1] * (k.radiusMm + d),
        k.center[2] + dir[2] * (k.radiusMm + d),
      ];
      const above = warpAt(at(-0.01), k).shift,
        below = warpAt(at(0.01), k).shift;
      expect(Math.abs(above - below), `pose ${JSON.stringify(pose)} línea ${i}`).toBeLessThan(0.05);
      if (above < -0.5) pressed++;
      for (let d = 0; d <= 40; d += 0.5) {
        const w = warpAt(at(d), k);
        expect(warpBound(w), `pose ${JSON.stringify(pose)} línea ${i} d ${d}`).toBeLessThanOrEqual(4.5);
        expect(w.shift).toBeLessThanOrEqual(1e-9);
      }
    }
    if (pose.lift < 0) expect(pressed, JSON.stringify(pose)).toBeGreaterThan(8);
  }
});

it('celda U: el peso respiratorio es la rampa por profundidad de su fila; celda D/E, como siempre', () => {
  let ramps = 0;
  for (const [phi, z] of [
    [0, -200],
    [3.926991, -200],
    [4.7, -110],
    [4.2, -60],
  ])
    for (const d of [10, 25, 35, 45, 60, 90]) {
      const s = torsoSkinPoint(phi, z, scene.torso),
        g = torsoDepthGradient(s, scene.torso),
        n = Math.hypot(...g);
      const p: Vec3 = [s[0] - (d * g[0]) / n, s[1] - (d * g[1]) / n, s[2] - (d * g[2]) / n];
      if (s0028InsideWall(p) !== null) continue;
      const r = rampFor(p);
      expect(r.d1 - r.d0).toBeGreaterThan(1);
      expect(scene.respiratoryWeight(p)).toBe(smoothstep(r.d0, r.d1, -r.tau) * spineWeight(p));
      // Gradiente: la rampa con ∇(−τ) y el factor de columna.
      const u = (-r.tau - r.d0) / (r.d1 - r.d0),
        slope = u > 0 && u < 1 ? (6 * u * (1 - u)) / (r.d1 - r.d0) : 0;
      const gt = torsoDepthGradient(p, scene.torso),
        dx = p[0] - scene.spine.x0,
        dy = p[1] - scene.spine.y0,
        rr = Math.hypot(dx, dy),
        sl = (a: number, b: number, x: number) => {
          const v = (x - a) / (b - a);
          return v > 0 && v < 1 ? (6 * v * (1 - v)) / (b - a) : 0;
        };
      const ka = -spineWeight(p) * slope,
        kb = (smoothstep(r.d0, r.d1, -r.tau) * sl(scene.spine.r + 5, scene.spine.r + 35, rr)) / rr;
      const w = respiratoryWeightGradient(scene, p);
      expect(w[0]).toBeCloseTo(ka * gt[0] + kb * dx, 12);
      expect(w[1]).toBeCloseTo(ka * gt[1] + kb * dy, 12);
      expect(w[2]).toBeCloseTo(ka * gt[2], 12);
      ramps++;
    }
  expect(ramps).toBeGreaterThan(15);
  // Una celda D/E conserva smoothstep(0, 25, profundidad bajo su cara interna), bit a bit.
  for (const p of [[-115, 44, -108] as Vec3, [-115, 44, -140] as Vec3]) {
    const inside = s0028InsideWall(p)!;
    expect(scene.respiratoryWeight(p)).toBe(smoothstep(0, 25, inside) * spineWeight(p));
  }
});

it('los órganos respiran: ≥95 % de vértices móviles en hígado, bazo, riñones y VCI; ninguno quieto a >40 mm por U', () => {
  const fields = indexedSurfaces(raw('surfaces'));
  const target = ['liver', 'spleen', 'kidneyRight', 'kidneyLeft', 'inferior_vena_cava'];
  const organs = [
    'liver',
    'spleen',
    'pancreas',
    'kidneyRight',
    'kidneyLeft',
    'gallbladder',
    'inferior_vena_cava',
    'portal_vein_and_splenic_vein',
  ];
  let banded = 0;
  for (const f of fields) {
    if (!organs.includes(f.name)) continue;
    let sampled = 0,
      moving = 0;
    for (let i = 0; i < f.positions.length; i += 3) {
      const p: Vec3 = [f.positions[i], f.positions[i + 1], f.positions[i + 2]];
      const w = scene.respiratoryWeight(p);
      sampled++;
      if (w > 0) {
        moving++;
        continue;
      }
      if (torsoDepth(p, scene.torso) >= -40 || spineWeight(p) === 0) continue;
      // La única excepción es la regla D/E de siempre: el vértice queda dentro de la banda anotada (bajo cero de su cara
      // interna, a ≤4 mm). Nunca una celda U ni una profundidad sin cara.
      const inside = s0028InsideWall(p);
      expect(inside, `${f.name} quieto a >40 mm en U: ${JSON.stringify(p)}`).not.toBeNull();
      expect(inside!).toBeLessThanOrEqual(0);
      expect(inside!).toBeGreaterThan(-4);
      banded++;
    }
    if (target.includes(f.name)) expect(moving / sampled, f.name).toBeGreaterThanOrEqual(0.95);
  }
  // Medido en r2b-U: 7 vértices de hígado y 1 de bazo, dentro de la banda D/E 0,4–3,7 mm (cara interna a 48–52 mm).
  expect(banded).toBeLessThanOrEqual(8);
});

it('sube la rampa por fila a su hueco con halo finito, como vista de la reserva', () => {
  const ups = s0028WallUploads();
  const r = ups.at(-1)!;
  expect(r.offset).toEqual([0, 0, 653]);
  expect(r.size).toEqual([181, 1, 1]);
  expect(r.data.buffer).toBe(capacity);
  expect(r.data.byteOffset).toBe(B.wallDerived.ramps.offsetBytes + 4096);
  expect(r.data.length).toBe(362);
  // Halo [0,0,652] + [182,2,3]: relleno finito del atlas, sin campos ni teselas (NaN·0 del filtro lineal).
  const atlas = new Uint16Array(raw('abdominal-direct'));
  const [X, Y] = B.abdominal.textureDimensions;
  for (let z = 652; z <= 654; z++)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 182; x++) expect(Number.isFinite(HALF[atlas[((z * Y + y) * X + x) * 2]])).toBe(true);
  // El mapa E del contacto vive sólo en la CPU: ninguna subida de 512×181 nodos.
  expect(ups.some((u) => u.size[0] * u.size[1] * u.size[2] === 512 * 181)).toBe(false);
  for (const u of ups.slice(0, -1)) {
    const [ox, oy, oz] = u.offset,
      [sx, sy, sz] = u.size;
    const overlap = ox < 182 && 0 < ox + sx && oy < 2 && 0 < oy + sy && oz < 655 && 652 < oz + sz;
    expect(overlap, JSON.stringify(u.offset)).toBe(false);
  }
});
