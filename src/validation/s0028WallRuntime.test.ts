import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { abdominalAtlas, setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { sourceDistance } from '../anatomy/sourceVolume';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { abdominalBody, setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { torsoDepth, torsoDepthGradient, torsoSkinPoint } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { startPointsFor } from '../app/startPoints';
import {
  setS0028Wall,
  s0028InsideWall,
  s0028WallAt,
  s0028WallFaceGradient,
  s0028WallSurface,
  s0028WallUploads,
} from '../anatomy/s0028Wall';
import { setS0028Solids } from '../anatomy/s0028Solids';
import { HALF } from '../anatomy/halfFloat';
import { wallFaceGradient, wallFaceSd } from '../anatomy/organs/wall';
import { respiratoryWeightGradient } from '../anatomy/respiratoryNormals';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { firstRegionalWallCrossing, probeContact } from '../probe/contact';
import { dot, cross, normalize, smoothstep, sub, type Vec3 } from '../core/vec3';
import { s0028SourceValue } from '../anatomy/s0028Source';
import { nodeSin } from '../anatomy/compression';
import chartFixtures from './fixtures/s0028-wall-chart.json';

let scene: AnatomyScene;
beforeAll(() => {
  installAnatomyBundle(B);
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  const capacity = raw('annotation-capacity');
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
});

it('el apoyo de las diez poses sin editar usa el cero EDT común', () => {
  for (const pose of startPointsFor(scene.torso, B)) {
    const p = torsoSkinPoint(pose.phi, pose.z, scene.torso);
    expect(Math.abs(torsoDepth(p, scene.torso)), pose.id).toBeLessThan(0.00001);
    const frame = probeFrame({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 }, scene.torso, CONVEX_C35);
    expect(frame.skinPoint).toEqual(p);
  }
});

it('s0028 desactiva hepaticCostalBody y la piel E mide 1,5 mm', () => {
  expect(scene.torso.profile).toBe(abdominalBody);
  expect(scene.torso.skinMm).toBe(1.5);
});

it('proyecta por EDT y lee la carta bilineal v2 con fixtures directos', () => {
  // Valores regenerados con proyección directa; row/col/depth/bounds originales conservan la inversa offline S−dN.
  for (const f of chartFixtures) {
    const p: Vec3 = [f.point[0], f.point[1], f.point[2]],
      q = s0028WallAt(p);
    expect(q?.kind).toBe('known');
    if (q?.kind !== 'known') throw new Error('Carta sin soporte directo');
    expect(Math.abs(q.z - (f.direct.row * 1.5 - 210))).toBeLessThan(0.005);
    expect(Math.abs(q.phi - (f.direct.col * 2 * Math.PI) / 512)).toBeLessThan(0.0001);
    expect(Math.abs(q.depthMm - f.direct.depth)).toBeLessThan(0.005);
    expect(Math.abs(q.outerMm - f.direct.bounds[0])).toBeLessThan(0.005);
    expect(Math.abs(q.innerMm - f.direct.bounds[1])).toBeLessThan(0.005);
  }
});

it('la banda propia y sus caras sustituyen W global sin llamar músculo a una identidad U', () => {
  // Perfil propio v2: límites y profundidad directos; la inversa offline se conserva en el fixture.
  const f = chartFixtures[0];
  const fat: Vec3 = [f.skin[0] - 20 * f.normal[0], f.skin[1] - 20 * f.normal[1], f.skin[2] - 20 * f.normal[2]];
  const band: Vec3 = [f.point[0], f.point[1], f.point[2]];
  const q = s0028WallAt(band);
  expect(q?.kind).toBe('known');
  if (q?.kind !== 'known') throw new Error('Falta el perfil propio');
  expect(Math.abs(q.outerMm - f.direct.bounds[0])).toBeLessThan(0.005);
  expect(Math.abs(q.innerMm - f.direct.bounds[1])).toBeLessThan(0.005);
  expect(q.provenance[3]).toBe('U');
  expect(scene.classify(fat, BASELINE_CALIBER)).toMatchObject({ tissue: Tissue.Fat, wall: 'fat-D/E' });
  expect(scene.classify(band, BASELINE_CALIBER)).toMatchObject({ tissue: Tissue.UnsegmentedSoftTissue, wall: 'band-D/E' });
  expect(Math.abs(scene.insideWallMm(band) - (f.direct.depth - f.direct.bounds[1]))).toBeLessThan(0.005);
  const before = [
    scene.classify(band, BASELINE_CALIBER),
    scene.respiratoryWeight(band),
    scene.insideWallMm(band),
    wallFaceSd(band, Interface.Peritoneum, scene.torso),
  ];
  const { fatMm, muscleMm } = scene.torso;
  try {
    scene.torso.fatMm += 55;
    scene.torso.muscleMm += 30;
    expect([
      scene.classify(band, BASELINE_CALIBER),
      scene.respiratoryWeight(band),
      scene.insideWallMm(band),
      wallFaceSd(band, Interface.Peritoneum, scene.torso),
    ]).toEqual(before);
  } finally {
    Object.assign(scene.torso, { fatMm, muscleMm });
  }
});

it('una celda D/E vale a cualquier profundidad y una celda U no vale a ninguna', () => {
  // Más allá de la cara interna, inside > 0 es interior del cuerpo: contacto, respiración y cruce lo necesitan.
  for (const f of chartFixtures)
    for (const d of [0, 20, 60]) {
      const p: Vec3 = [f.skin[0] - d * f.normal[0], f.skin[1] - d * f.normal[1], f.skin[2] - d * f.normal[2]];
      const q = s0028WallAt(p);
      expect(q?.kind, `fila ${f.row}, columna ${f.col}, ${d} mm`).toBe('known');
      if (q?.kind !== 'known') continue;
      expect(q.depthMm).toBe(-torsoDepth(p, scene.torso));
      expect(Math.sign(s0028InsideWall(p)!)).toBe(d === 60 ? 1 : -1);
      expect(Number.isFinite(wallFaceSd(p, Interface.Peritoneum, scene.torso))).toBe(true);
    }
  // Posterior U/P3 a lo largo de su normal EDT: la celda U decide aunque cambie la profundidad. Sin cara interna; su peso
  // respiratorio es la rampa por profundidad de su fila (r2b-U, s0028UContact.test.ts), nulo cerca de la piel.
  for (const phi of [0, 3.926991])
    for (const d of [0, 20, 60]) {
      const skin = torsoSkinPoint(phi, -200, scene.torso),
        g = torsoDepthGradient(skin, scene.torso),
        n = Math.hypot(...g);
      const p: Vec3 = [skin[0] - (d * g[0]) / n, skin[1] - (d * g[1]) / n, skin[2] - (d * g[2]) / n];
      expect(s0028WallAt(p), `φ ${phi}, ${d} mm`).toMatchObject({ kind: 'unknown', reason: 'coverage' });
      expect(s0028InsideWall(p)).toBeNull();
      if (d < 20) expect(scene.respiratoryWeight(p)).toBe(0);
      expect(Number.isNaN(wallFaceSd(p, Interface.Peritoneum, scene.torso))).toBe(true);
      expect(wallFaceGradient(p, Interface.Peritoneum, scene.torso).every(Number.isNaN)).toBe(true);
    }
});

it('cada cara y el peso respiratorio usan el gradiente analítico regional: una consulta y la pendiente de su celda', () => {
  // Fórmula independiente: −∇τ − P(∂B/∂c·∇c + ∂B/∂f·∇f), P = I − ∇τ∇τᵀ/|∇τ|², centro de fila constante en z.
  const centers = s0028WallUploads().find((u) => u.offset === B.wall.centerOffset)!.data;
  const points: Vec3[] = [[-115, 44, -108], ...chartFixtures.map((f) => [f.point[0], f.point[1], f.point[2]] as Vec3)];
  for (const m of points) {
    const q = s0028WallAt(m);
    if (q?.kind !== 'known') throw new Error('Punto de banda sin carta');
    const g = torsoDepthGradient(m, scene.torso),
      gg = dot(g, g),
      tau = torsoDepth(m, scene.torso);
    const s: Vec3 = [m[0] - (tau * g[0]) / gg, m[1] - (tau * g[1]) / gg, m[2] - (tau * g[2]) / gg];
    const row = (s[2] + 210) / 1.5,
      lo = Math.floor(row);
    const cy = HALF[centers[2 * lo + 1]] * (1 - (row - lo)) + HALF[centers[2 * Math.min(180, lo + 1) + 1]] * (row - lo);
    const X = s[0],
      Y = s[1] - cy;
    expect(Math.atan2(Y, X)).toBeCloseTo(q.phi, 12);
    const col = ((((q.phi / (2 * Math.PI)) % 1) + 1) % 1) * 512;
    const e = 1e-4,
      sc = col - Math.floor(col) < 0.5 ? e : -e,
      sr = row - Math.min(179, lo) < 0.5 ? e : -e;
    const at = (dc: number, dr: number) => s0028WallSurface(((col + dc) * 2 * Math.PI) / 512, (row + dr) * 1.5 - 210);
    for (const [face, key, boundary] of [
      [Interface.DeepFascia, 'outerMm', 0],
      [Interface.Peritoneum, 'interfaceMm', 2],
    ] as const) {
      const c1 = at(sc, 0),
        r1 = at(0, sr);
      if (c1.kind !== 'known' || r1.kind !== 'known') throw new Error('Pendiente fuera de la celda');
      const a = ((512 / (2 * Math.PI)) * ((c1[key] - q[key]) / sc)) / (X * X + Y * Y);
      const v: Vec3 = [-Y * a, X * a, (r1[key] - q[key]) / sr / 1.5];
      const t = dot(g, v) / gg;
      const expected: Vec3 = [-g[0] - v[0] + g[0] * t, -g[1] - v[1] + g[1] * t, -g[2] - v[2] + g[2] * t];
      const got = wallFaceGradient(m, face, scene.torso);
      for (const axis of [0, 1, 2]) expect(got[axis]).toBeCloseTo(expected[axis], 6);
      expect(s0028WallFaceGradient(m, boundary)!.sd).toBe(q.depthMm - q[key]);
      // La pendiente regional cambia la normal respecto de la cutánea donde la carta no es plana.
      if (Math.hypot(...v) > 0.01) expect(Math.hypot(got[0] + g[0], got[1] + g[1], got[2] + g[2])).toBeGreaterThan(0.005);
    }
    const ip = wallFaceGradient(m, Interface.Peritoneum, scene.torso),
      inside = scene.insideWallMm(m);
    const dx = m[0] - scene.spine.x0,
      dy = m[1] - scene.spine.y0,
      rs = Math.hypot(dx, dy);
    const slope = (lo: number, hi: number, x: number) => {
      const u = (x - lo) / (hi - lo);
      return u > 0 && u < 1 ? (6 * u * (1 - u)) / (hi - lo) : 0;
    };
    const ka = smoothstep(scene.spine.r + 5, scene.spine.r + 35, rs) * slope(0, 25, inside),
      kb = (smoothstep(0, 25, inside) * slope(scene.spine.r + 5, scene.spine.r + 35, rs)) / rs;
    const w = respiratoryWeightGradient(scene, m);
    expect(w[0]).toBeCloseTo(ka * ip[0] + kb * dx, 12);
    expect(w[1]).toBeCloseTo(ka * ip[1] + kb * dy, 12);
    expect(w[2]).toBeCloseTo(ka * ip[2], 12);
  }
  // La piel E sólo tiene el gradiente EDT.
  const m: Vec3 = [-115, 44, -108],
    g = torsoDepthGradient(m, scene.torso);
  expect(wallFaceGradient(m, Interface.SkinFat, scene.torso)).toEqual([-g[0], -g[1], -g[2]]);
});

it('la vía directa de inside y la EDT sin reservas son bit a bit las de la consulta general', () => {
  // Referencia: la EDT con su gradiente central tal como estaban antes de quitar las reservas de memoria.
  const reference = (p: Vec3): number => {
    const f = B.depth;
    const at: Vec3 = [0, 0, 0];
    let outside = 0;
    for (let i = 0; i < 3; i++) {
      const q = (p[i] - f.originMm[i]) / 3;
      const a = Math.max(0, Math.min(f.dimensions[i] - 1, q));
      at[i] = f.originMm[i] + a * 3;
      outside += (q - a) ** 2;
    }
    return sourceDistance(abdominalAtlas!, at, f, B.abdominal.textureDimensions) + Math.sqrt(outside) * 3;
  };
  let known = 0,
    unknown = 0;
  for (let z = -230; z <= 75; z += 9.7)
    for (let y = -140; y <= 150; y += 13.3)
      for (let x = -170; x <= 170; x += 12.1) {
        const p: Vec3 = [x, y, z];
        expect(Object.is(torsoDepth(p, scene.torso), reference(p))).toBe(true);
        const g = torsoDepthGradient(p, scene.torso);
        for (let axis = 0; axis < 3; axis++) {
          const a: Vec3 = [...p],
            b: Vec3 = [...p];
          a[axis] += 1.5;
          b[axis] -= 1.5;
          expect(Object.is(g[axis], (reference(a) - reference(b)) / 3)).toBe(true);
        }
        const q = s0028WallAt(p);
        const expected = q?.kind === 'known' ? q.depthMm - q.interfaceMm : null;
        expect(Object.is(s0028InsideWall(p), expected), JSON.stringify(p)).toBe(true);
        if (expected === null) unknown++;
        else known++;
      }
  expect(known).toBeGreaterThan(1000);
  expect(unknown).toBeGreaterThan(1000);
});

it('el marco usa cinco puntos del mismo cero y huella rígida de 13 mm, con normal exterior', () => {
  for (const p of startPointsFor(scene.torso, B)) {
    const pose = { ...p, rock: p.rock ?? 0, tilt: p.tilt ?? 0, lift: 0 };
    const f = probeFrame(pose, scene.torso, CONVEX_C35);
    const h = 6.5,
      dp = h / Math.max(40, Math.hypot(f.skinPoint[0], f.skinPoint[1] - (scene.torso.y0 ?? 0)));
    const n = normalize(
      cross(
        sub(torsoSkinPoint(p.phi + dp, p.z, scene.torso), torsoSkinPoint(p.phi - dp, p.z, scene.torso)),
        sub(torsoSkinPoint(p.phi, p.z + h, scene.torso), torsoSkinPoint(p.phi, p.z - h, scene.torso)),
      ),
    );
    expect(f.skinNormal).toEqual(n);
    expect(dot(n, [Math.cos(p.phi), Math.sin(p.phi), 0])).toBeGreaterThan(0);
  }
});

it('posterior U no es aire, órgano ni anillo muscular; sus interfaces finas están ausentes', () => {
  expect(s0028WallSurface(1.5 * Math.PI, -130)).toMatchObject({ kind: 'unknown' });
  const m: Vec3 = [105, -75, -160];
  expect(s0028WallAt(m)).toMatchObject({ kind: 'unknown' });
  const c = scene.classify(m, BASELINE_CALIBER);
  expect(c).toMatchObject({ tissue: Tissue.UnsegmentedSoftTissue, wall: 'U' });
  expect(Number.isNaN(wallFaceSd(m, Interface.Peritoneum, scene.torso))).toBe(true);
  expect(s0028InsideWall(m)).toBeNull();
});

it('un paquete enteramente U mantiene el fondo rotulado y nunca produce una banda NaN', () => {
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const capacity = raw('annotation-capacity'),
    skin = raw('skin-polar');
  const unknown = capacity.slice(0),
    words = new Uint16Array(unknown, 4096);
  const page = 65 * 91 * 2;
  for (let tile = 0; tile < 16; tile++)
    for (let cell = 0; cell < 65 * 91; cell++) {
      const k = tile * page * 2 + cell * 2;
      words[k] = words[k + 1] = words[k + page] = 0x7e00;
      words[k + page + 1] = 0;
    }
  // Su bloque derivado coherente: sin nodo conocido no hay E en ningún nodo (la rampa por fila se conserva).
  new Uint16Array(unknown, 4096 + B.wall.payloadBytes, 512 * 181 * 2).fill(0x7e00);
  try {
    setS0028Wall(unknown, skin);
    const p: Vec3 = [0, 109.03521552681923, -90];
    expect(s0028WallAt(p)).toMatchObject({ kind: 'unknown', reason: 'coverage' });
    expect(scene.classify(p, BASELINE_CALIBER)).toMatchObject({ tissue: Tissue.UnsegmentedSoftTissue, wall: 'U', boundaryDistance: 0 });
    expect(s0028InsideWall(p)).toBeNull();
    expect(scene.respiratoryWeight(p)).toBe(0);
  } finally {
    setS0028Wall(capacity, skin);
  }
});

it('el contacto no usa W del hábito y un haz exterior nunca acopla', () => {
  const pose = { phi: Math.PI / 2, z: -90, yaw: 0, rock: 0, tilt: 0, lift: 25 };
  const a = probeContact(pose, CONVEX_C35, scene.torso);
  const { fatMm, muscleMm } = scene.torso;
  try {
    scene.torso.fatMm += 55;
    scene.torso.muscleMm += 30;
    expect(probeContact(pose, CONVEX_C35, scene.torso)).toEqual(a);
  } finally {
    Object.assign(scene.torso, { fatMm, muscleMm });
  }
  expect(Math.max(...probeContact({ ...pose, lift: 0, rock: Math.PI }, CONVEX_C35, scene.torso).contact)).toBe(0);
});

it('el cruce aborta en U y no encuentra detrás una cara inventada', () => {
  expect(firstRegionalWallCrossing((r) => (r > 2 && r < 4 ? null : r - 6), 0, 10)).toBeNull();
  expect(firstRegionalWallCrossing((r) => r - 6.25, 0, 6.25)).toBeCloseTo(6.25, 5);
});

it('el cruce informado coincide con la cara interna regional física de cada nodo válido', () => {
  const contact = probeContact({ phi: Math.PI / 2, z: -90, yaw: 0, rock: 0, tilt: 0, lift: 25 }, CONVEX_C35, scene.torso);
  let checked = 0;
  const center = Math.floor(contact.nodes.length / 2);
  for (let k = center - 1; k <= center + 1; k++) {
    const r = contact.summary.wallAlongMm[k],
      rs = contact.summary.skinAlongMm[k];
    if (!Number.isFinite(r) || !Number.isFinite(rs)) continue;
    const s = nodeSin(k, CONVEX_C35.halfSector),
      c = Math.sqrt(1 - s * s),
      f = contact.frame;
    const direction: Vec3 = [f.axial[0] * c + f.lateral[0] * s, f.axial[1] * c + f.lateral[1] * s, f.axial[2] * c + f.lateral[2] * s];
    const at = (depth: number): Vec3 => [
      f.curvatureCenter[0] + direction[0] * (60 + depth),
      f.curvatureCenter[1] + direction[1] * (60 + depth),
      f.curvatureCenter[2] + direction[2] * (60 + depth),
    ];
    expect(Math.abs(s0028InsideWall(at(r))!)).toBeLessThan(0.001);
    // Barrido fino independiente: antes del cruce no puede aparecer otra entrada conocida.
    for (let d = rs; d < r - 0.05; d += 0.05) {
      const inside = s0028InsideWall(at(d));
      expect(inside).not.toBeNull();
      expect(inside!).toBeLessThan(0);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

it('rechaza NaN convertido a cero y halos corruptos; un hueco válido queda U sin interpolación', () => {
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const capacity = raw('annotation-capacity'),
    skin = raw('skin-polar');
  const words = new Uint16Array(capacity, 4096);
  const stride = 65 * 91 * 2 * 2;
  const k = 2 * stride + (80 * 65 + 1) * 2;
  // Una celda interior vecina al perfil propio, sin cambiar ningún halo.
  const unknown = capacity.slice(0),
    u = new Uint16Array(unknown, 4096);
  u[k] = u[k + 1] = u[k + 65 * 91 * 2] = 0x7e00;
  u[k + 65 * 91 * 2 + 1] = 0;
  // El mismo nodo (fila 80, columna 129) en el mapa E: un U sin E, sin fuente inventada.
  new Uint16Array(unknown, 4096 + B.wall.payloadBytes, 512 * 181 * 2).fill(0x7e00, (80 * 512 + 129) * 2, (80 * 512 + 129) * 2 + 2);
  try {
    setS0028Wall(unknown, skin);
    expect(s0028WallSurface((128.5 * 2 * Math.PI) / 512, -90)).toMatchObject({ kind: 'unknown', reason: 'coverage' });
    u[k] = 0;
    expect(() => setS0028Wall(unknown, skin)).toThrow(/U.*cero/);
    const corrupt = capacity.slice(0);
    new Uint16Array(corrupt, 4096)[2 * 64] ^= 1;
    expect(() => setS0028Wall(corrupt, skin)).toThrow(/Halo/);
  } finally {
    setS0028Wall(capacity, skin);
  }
  expect(words[k]).not.toBe(0);
});

it('el signo renal histórico es interior: −25,5 mm no significa una cara exterior', () => {
  // Misma cara vieja de main, guardada por la auditoría de la persona; EDT negativa = dentro.
  const oldFace: Vec3 = [-121.00717820618311, 52.83236439756767, -142.6];
  expect(torsoDepth(oldFace, scene.torso)).toBeLessThan(0);
  // main 8ee9fbd: −17,1296 mm EDT. Los −25,5 históricos eran otra base/métrica radial.
  expect(torsoDepth(oldFace, scene.torso)).toBeCloseTo(-17.12959867970365, 6);
});

it('el hígado fuente no se recorta con la W ni la cúpula procedurales de otra anatomía', () => {
  for (const p of [
    [-80, 40, -50],
    [0, 126, -60],
  ] satisfies Vec3[]) {
    expect(scene.liverInteriorMargin(p)).toBe(-scene.liverSdf(p));
    expect(scene.faceSdf(p, BASELINE_CALIBER, 'liverSurface')).toBe(scene.liverSdf(p));
    expect(Number.isFinite(scene.faceSdf(p, BASELINE_CALIBER, 'dome'))).toBe(true);
  }
});

it('conserva la cúpula E/P7 donde no invade las estructuras fuente', () => {
  const p: Vec3 = [-11.533855575900514, 71.59107619779334, 9.750919952095462];
  expect(scene.classify(p, BASELINE_CALIBER)).toMatchObject({ tissue: Tissue.Diaphragm, approximation: 'diaphragm-P7' });
  const before = scene.faceSdf(p, BASELINE_CALIBER, 'dome'),
    { fatMm, muscleMm } = scene.torso;
  try {
    scene.torso.fatMm += 55;
    scene.torso.muscleMm += 30;
    expect(scene.faceSdf(p, BASELINE_CALIBER, 'dome')).toBe(before);
  } finally {
    Object.assign(scene.torso, { fatMm, muscleMm });
  }
});

it('conserva los campos fuente sin convertir autóctonos en QL ni rellenar músculo alrededor del riñón', () => {
  // El test barre nodos físicos y exige músculo sólo donde la máscara propia lo contiene.
  let psoas = 0,
    autochthon = 0,
    lung = 0,
    cartilage = 0;
  for (let z = -180; z <= 30; z += 15)
    for (let y = -100; y <= 100; y += 15)
      for (let x = -120; x <= 120; x += 15) {
        const p: Vec3 = [x, y, z],
          c = scene.classify(p, BASELINE_CALIBER);
        if (c.tissue === Tissue.Psoas) {
          expect(s0028SourceValue(p, 'posteriorMuscle').d).toBeLessThan(0);
          psoas++;
        }
        if (c.tissue === Tissue.Muscle) {
          expect(s0028SourceValue(p, 'posteriorMuscle').d).toBeLessThan(0);
          autochthon++;
        }
        if (c.tissue === Tissue.Lung) lung++;
        if (c.tissue === Tissue.Cartilage) cartilage++;
        expect(c.tissue).not.toBe(Tissue.QuadratusLumborum);
      }
  expect(psoas).toBeGreaterThan(0);
  expect(autochthon).toBeGreaterThan(0);
  expect(lung).toBeGreaterThan(0);
  expect(cartilage).toBeGreaterThan(0);
});
