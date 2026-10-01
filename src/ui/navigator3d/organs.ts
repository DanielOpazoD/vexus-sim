import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { kidneyLocal, kidneyOuterSdf, type Kidney } from '../../anatomy/organs/kidney';
import { gallbladderSdf } from '../../anatomy/organs/gallbladder';
import { domeFloor, heartOuterSdf } from '../../anatomy/organs/heart';
import { diaphragmHeight, torsoDepth } from '../../anatomy/primitives';
import { diaphragmRim } from '../../anatomy/diaphragmRim';
import { COUINAUD_LABEL, couinaudPlanes, couinaudSegment, type CouinaudSegment } from '../../anatomy/couinaud';
import type { AnatomyScene } from '../../anatomy/scene';
import { DIAPHRAGM_THICKNESS_MM } from '../../anatomy/tissues';
import type { Vec3 } from '../../core/vec3';
import { CM } from './common';
import { labelSprite } from './labels';
import { variableTube } from './tubes';

/**
 * Malla por marching cubes de un campo implícito (mm, marco anatómico) dentro de una
 * caja: la MISMA función que corta el haz, así el 3D no puede divergir del corte.
 */
export function meshFromSdf(sdf: (p: Vec3) => number, lo: Vec3, hi: Vec3, res: number, material: THREE.Material): THREE.Mesh {
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const mc = new MarchingCubes(res, material, false, false, 300000);
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const p: Vec3 = [lo[0] + (size * (i + 0.5)) / res, lo[1] + (size * (j + 0.5)) / res, lo[2] + (size * (k + 0.5)) / res];
        mc.field[i + j * res + k * res * res] = -sdf(p) / 10; // positivo dentro; suavizado por escala
      }
  mc.isolation = 0;
  mc.update();
  // MarchingCubes genera en [−1, 1]³ sobre un búfer de tamaño fijo: se compacta
  // a los triángulos realmente emitidos (drawRange) y se reescala a la caja.
  const count = mc.geometry.drawRange.count;
  const src = mc.geometry.getAttribute('position') as THREE.BufferAttribute;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute((src.array as Float32Array).slice(0, count * 3), 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, material);
  mesh.scale.setScalar((size / 2) * CM);
  mesh.position.set((lo[0] + size / 2) * CM, (lo[1] + size / 2) * CM, (lo[2] + size / 2) * CM);
  return mesh;
}

/** Colores de los segmentos de Couinaud en el 3D (I–VIII). */
export const COUINAUD_COLORS: Record<CouinaudSegment, number> = {
  1: 0x8a6d5a,
  2: 0xc97d5d,
  3: 0xd9a066,
  4: 0xb85c4a,
  5: 0x9b4f3f,
  6: 0x7f4a3a,
  7: 0x6b3f36,
  8: 0xa8604e,
};

/**
 * Hígado por marching cubes sobre el MISMO SDF que corta el haz (con fisura umbilical y
 * fosa vesicular), coloreado por segmento de Couinaud (vértice a vértice, misma
 * partición que `couinaudSegment`) y translúcido para ver los vasos dentro.
 */
export function buildLiverMesh(a: AnatomyScene): THREE.Mesh {
  const lobes = [a.liver, a.liverLeft];
  const lo = [0, 1, 2].map((i) => Math.min(...lobes.map((l) => l.center[i] - l.radii[i])) - 8) as Vec3;
  const hi = [0, 1, 2].map((i) => Math.max(...lobes.map((l) => l.center[i] + l.radii[i])) + 8) as Vec3;
  const wall = a.wallThickness();
  // recortes idénticos a scene.classify: diafragma (lámina 2,5 mm) y pared del tronco
  const sdf = (p: Vec3) =>
    Math.max(
      a.liverSdf(p),
      -(diaphragmHeight(p[0], p[1], a.diaphragm, a.torso) - p[2]) + DIAPHRAGM_THICKNESS_MM,
      torsoDepth(p, a.torso) + wall,
    );
  const mesh = meshFromSdf(
    sdf,
    lo,
    hi,
    64,
    new THREE.MeshStandardMaterial({ roughness: 0.55, transparent: true, opacity: 0.62, vertexColors: true, depthWrite: false }),
  );
  const pos = mesh.geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const planes = couinaudPlanes(a);
  const sc = mesh.scale.x;
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const p: Vec3 = [
      (pos.getX(i) * sc + mesh.position.x) / CM,
      (pos.getY(i) * sc + mesh.position.y) / CM,
      (pos.getZ(i) * sc + mesh.position.z) / CM,
    ];
    col.setHex(COUINAUD_COLORS[couinaudSegment(p, planes)]);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh.renderOrder = 2;
  return mesh;
}

/** Rótulos I–VIII en el centroide de la superficie de cada segmento. */
export function buildCouinaudLabels(a: AnatomyScene, liver: THREE.Mesh): THREE.Group {
  const g = new THREE.Group();
  const pos = liver.geometry.getAttribute('position');
  const planes = couinaudPlanes(a);
  const sc = liver.scale.x;
  const acc = new Map<CouinaudSegment, { x: number; y: number; z: number; n: number }>();
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) * sc + liver.position.x;
    const wy = pos.getY(i) * sc + liver.position.y;
    const wz = pos.getZ(i) * sc + liver.position.z;
    const seg = couinaudSegment([wx / CM, wy / CM, wz / CM], planes);
    const e = acc.get(seg) ?? { x: 0, y: 0, z: 0, n: 0 };
    e.x += wx;
    e.y += wy;
    e.z += wz;
    e.n++;
    acc.set(seg, e);
  }
  for (const [seg, e] of acc) {
    const sp = labelSprite(COUINAUD_LABEL[seg], '#ffe9c8');
    sp.scale.set(3.6, 0.9, 1);
    sp.position.set(e.x / e.n, e.y / e.n, e.z / e.n);
    g.add(sp);
  }
  return g;
}

/** Riñón en judía con escotadura hiliar: marching cubes sobre `kidneyOuterSdf` (decisión 37). */
export function buildKidneyMesh(k: Kidney): THREE.Mesh {
  const rMax = Math.max(...k.radii) + 6;
  const lo: Vec3 = [k.center[0] - rMax, k.center[1] - rMax, k.center[2] - rMax];
  const hi: Vec3 = [k.center[0] + rMax, k.center[1] + rMax, k.center[2] + rMax];
  const sdf = (p: Vec3) => kidneyOuterSdf(kidneyLocal(p, k), k);
  return meshFromSdf(
    sdf,
    lo,
    hi,
    40,
    new THREE.MeshStandardMaterial({ color: 0x9a5a52, roughness: 0.55, transparent: true, opacity: 0.8 }),
  );
}

export function buildOrgans(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const liver = buildLiverMesh(a);
  g.add(liver, buildCouinaudLabels(a, liver));
  // Diafragma: superficie paramétrica sobre toda la sección del tronco (misma
  // diaphragmHeight que el clasificador: dos hemicúpulas sobre la inserción costal)
  const nR = 20;
  const nA = 48;
  const pos: number[] = [];
  const idx: number[] = [];
  const wall = a.wallThickness();
  const cy = a.torso.y0 ?? 0;
  const rim = Array.from({ length: nA + 1 }, (_, i) => diaphragmRim((i / nA) * Math.PI * 2, a.diaphragm, a.torso, wall));
  for (let j = 0; j <= nR; j++) {
    const rho = j / nR;
    for (let i = 0; i <= nA; i++) {
      const x = rim[i][0] * rho;
      const y = cy + (rim[i][1] - cy) * rho;
      pos.push(x * CM, y * CM, diaphragmHeight(x, y, a.diaphragm, a.torso) * CM);
    }
  }
  for (let j = 0; j < nR; j++)
    for (let i = 0; i < nA; i++) {
      const p = j * (nA + 1) + i;
      idx.push(p, p + 1, p + nA + 1, p + 1, p + nA + 2, p + nA + 1);
    }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dg.setIndex(idx);
  dg.computeVertexNormals();
  g.add(
    new THREE.Mesh(
      dg,
      new THREE.MeshStandardMaterial({
        color: 0xc9cfd8,
        roughness: 0.6,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  // Vesícula en pera curvada: marching cubes sobre la MISMA distancia que la imagen (fondo, cuerpo, cuello en «S»)
  const gbN = a.gallbladder.nodes;
  const gbLo = [0, 1, 2].map((k) => Math.min(...gbN.map((n) => n.p[k] - n.r)) - 4) as [number, number, number];
  const gbHi = [0, 1, 2].map((k) => Math.max(...gbN.map((n) => n.p[k] + n.r)) + 4) as [number, number, number];
  const gb = meshFromSdf(
    (p) => gallbladderSdf(p, a.gallbladder),
    gbLo,
    gbHi,
    40,
    new THREE.MeshStandardMaterial({ color: 0x3fb08f, roughness: 0.5, transparent: true, opacity: 0.85 }),
  );
  // Corazón (decisión 85): el epicardio recortado por la cúpula, con la MISMA distancia que la imagen
  const heart = meshFromSdf(
    (p) => heartOuterSdf(p, domeFloor(p, a.diaphragm, a.torso)),
    [-50, -20, 5],
    [80, 80, 122],
    44,
    new THREE.MeshStandardMaterial({ color: 0xb04848, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  g.add(gb, heart);
  // Riñones: judía con hilio por marching cubes sobre el MISMO SDF; seno como elipsoide interior
  for (const k of [a.kidneyRight, a.kidneyLeft]) {
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...k.u), new THREE.Vector3(...k.v), new THREE.Vector3(...k.w));
    g.add(buildKidneyMesh(k));
    const sinus = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({ color: 0xe0c27a, roughness: 0.6 }));
    sinus.scale.set(k.sinusRadii[0] * CM, k.sinusRadii[1] * CM, k.sinusRadii[2] * CM);
    sinus.position.set(0, k.sinusOffset * CM, 0);
    const kg = new THREE.Group();
    kg.add(sinus);
    kg.setRotationFromMatrix(basis);
    kg.position.set(k.center[0] * CM, k.center[1] * CM, k.center[2] * CM);
    g.add(kg);
  }
  // Vía biliar (verde), fina
  for (const d of a.ducts) g.add(variableTube(d.tube, 0x5fc86a, 0.95));
  return g;
}

/** Tubo con radio variable a lo largo de una polilínea (anillos por segmento, Catmull-Rom). */
