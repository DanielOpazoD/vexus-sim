import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { diaphragmHeight, kidneyLocal, kidneyOuterSdf, torsoDepth, type Kidney } from '../../anatomy/primitives';
import type { AnatomyScene } from '../../anatomy/scene';
import { DIAPHRAGM_THICKNESS_MM } from '../../anatomy/tissues';
import type { Vec3 } from '../../core/vec3';
import { CM } from './common';
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

/** Hígado por marching cubes sobre el MISMO SDF que corta el haz (con fisura umbilical y fosa vesicular). */
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
  return meshFromSdf(
    sdf,
    lo,
    hi,
    64,
    new THREE.MeshStandardMaterial({ color: 0x9a5a3c, roughness: 0.6, transparent: true, opacity: 0.88 }),
  );
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
  g.add(buildLiverMesh(a));
  // Diafragma: superficie paramétrica sobre toda la sección del tronco (misma
  // diaphragmHeight que el clasificador: dos hemicúpulas sobre la inserción costal)
  const nR = 20;
  const nA = 48;
  const pos: number[] = [];
  const idx: number[] = [];
  const wall = a.wallThickness();
  for (let j = 0; j <= nR; j++) {
    const rho = j / nR;
    for (let i = 0; i <= nA; i++) {
      const ang = (i / nA) * Math.PI * 2;
      const x = (a.torso.a - wall - 1) * rho * Math.cos(ang);
      const y = (a.torso.b - wall - 1) * rho * Math.sin(ang);
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
  const gb = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x3fb08f, roughness: 0.5, transparent: true, opacity: 0.85 }),
  );
  gb.scale.set(a.gallbladder.radii[0] * CM, a.gallbladder.radii[1] * CM, a.gallbladder.radii[2] * CM);
  gb.position.set(a.gallbladder.center[0] * CM, a.gallbladder.center[1] * CM, a.gallbladder.center[2] * CM);
  const ra = new THREE.Mesh(
    new THREE.SphereGeometry(a.rightAtrium.r * CM, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb04848, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  ra.position.set(a.rightAtrium.center[0] * CM, a.rightAtrium.center[1] * CM, a.rightAtrium.center[2] * CM);
  g.add(gb, ra);
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
