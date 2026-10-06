import { referenceCartilage } from '../../anatomy/referenceCartilage';
import { sternumSd, STERNUM } from '../../anatomy/organs/sternum';
import { meshFromSdf } from './organs';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AnatomyScene } from '../../anatomy/scene';
import { ribAnteriorEndX, ribCentre, ribShape, torsoSkinPoint, sdRib, SPINE_SHAPE, type Rib } from '../../anatomy/primitives';
import { CM, surfaceAt } from './common';

/** Piel superelíptica del tronco (misma elipse que `torsoDepth`) y esqueleto procedural. */
export function buildSkin(a: AnatomyScene): THREE.Mesh {
  const t = a.torso;
  const nT = 72;
  const nZ = 40;
  const z0 = -260;
  const z1 = 270;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nZ; j++) {
    const z = z0 + ((z1 - z0) * j) / nZ;
    for (let i = 0; i <= nT; i++) {
      const th = (i / nT) * Math.PI * 2;
      // La piel usa la misma elipse que el modelo acústico (torsoDepth): así la
      // sonda apoya exactamente donde la ve el haz.
      pos.push(...torsoSkinPoint(th, z, t).map((v) => v * CM));
    }
  }
  for (let j = 0; j < nZ; j++)
    for (let i = 0; i < nT; i++) {
      const p = j * (nT + 1) + i;
      idx.push(p, p + nT + 1, p + 1, p + 1, p + nT + 1, p + nT + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9b59a,
    roughness: 0.75,
    metalness: 0.02,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 3;
  const flesh = new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 8, 24), flesh);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, 1.5, 31);
  const head = new THREE.Mesh(new THREE.SphereGeometry(8.5, 28, 20), flesh);
  head.scale.set(0.9, 1, 1.1);
  head.position.set(0, 2.5, 42);
  mesh.add(neck, head);
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), flesh);
    sh.scale.set(1.35, 0.9, 1);
    sh.position.set(side * 17.5, -1, 25);
    // Brazos abducidos (mano tras la cabeza), como se explora el flanco: no tapan la ventana
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.0, 30, 20), flesh);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = side * 0.35;
    arm.position.set(side * 24, 2, 40);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 26, 24), flesh);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(side * 8, -1, -38);
    mesh.add(sh, arm, thigh);
  }
  return mesh;
}

/** Superficie elíptica del mismo campo costal que consulta el haz. No extiende arcos decorativos. */
export function costalGeometry(a: AnatomyScene, rib: Rib, side: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const materials: number[] = [];
  const rings = 64,
    segments = 12;
  const [aX, , y0] = ribShape(rib, a.torso);
  const front = rib.frontPhi ?? Math.acos(Math.max(-1, Math.min(1, (ribAnteriorEndX(rib) - rib.halfThickness - 0.01) / aX)));
  for (let i = 0; i <= rings; i++) {
    const phi = front + ((Math.PI * 1.5 - front) * i) / rings;
    const [x, y, z] = ribCentre(phi, rib, a.torso);
    if (y < a.spine.y0 && Math.abs(x - a.spine.x0) < a.spine.archHalfWidth + 6 + rib.halfThickness) break;
    const radius = Math.hypot(x, y - y0);
    for (let j = 0; j <= segments; j++) {
      const angle = (2 * Math.PI * j) / segments;
      const radial = 1 + (rib.halfThickness * Math.cos(angle)) / radius;
      positions.push(-side * x * radial * CM, (y0 + (y - y0) * radial) * CM, (z + rib.halfWidth * Math.sin(angle)) * CM);
    }
    materials.push(sdRib([x, y, z], rib, a.torso, a.spine).cartilage ? 1 : 0);
    if (i === 0) continue;
    for (let j = 0; j < segments; j++) {
      const k = i * (segments + 1) + j,
        prev = k - segments - 1;
      if (side < 0) indices.push(prev, k, prev + 1, prev + 1, k, k + 1);
      else indices.push(prev, prev + 1, k, prev + 1, k + 1, k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  for (let i = 1; i < materials.length; i++) geometry.addGroup((i - 1) * segments * 6, segments * 6, materials[i]);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildSkeleton(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.55 });
  const cartilage = new THREE.MeshStandardMaterial({ color: 0xcfd9e6, roughness: 0.5, transparent: true, opacity: 0.85 });
  // Solo costillas que existen en la anatomía acústica; unidades mm → cm, sin escala estética del torso.
  for (const rib of a.ribs)
    for (const side of rib.rightOnly ? [-1] : [-1, 1]) {
      const geometry = costalGeometry(a, rib, side);
      g.add(new THREE.Mesh(geometry, [bone, cartilage]));
    }
  if (a.ribs.some((r) => r.sourceCartilage))
    g.add(meshFromSdf((p) => referenceCartilage(p).d, [-115, 45, -70], [115, 105, 30], 96, cartilage));
  // Esternón y xifoides del mismo campo acústico, sin la caja decorativa anterior.
  const y0 = a.torso.y0 ?? 0;
  g.add(
    // Extensión unilateral antes de cortar cada material: evita interpolar el salto de anchura de la unión.
    meshFromSdf(
      (p) => Math.max(sternumSd([p[0], p[1], Math.max(STERNUM.zJunctionMm, p[2])], a.torso), STERNUM.zJunctionMm - p[2]),
      [-30, y0 + 40, STERNUM.zJunctionMm - 1],
      [30, y0 + a.torso.b, STERNUM.zTopMm + 1],
      224,
      bone,
    ),
    meshFromSdf(
      (p) => Math.max(sternumSd([p[0], p[1], Math.min(STERNUM.zJunctionMm - 1e-8, p[2])], a.torso), p[2] - STERNUM.zJunctionMm),
      [-10, y0 + 40, STERNUM.zTipMm - 1],
      [10, y0 + a.torso.b, STERNUM.zJunctionMm + 1],
      128,
      cartilage,
    ),
  );
  // los cuerpos vertebrales de la imagen (PR119; recuperación provisional de la decisión 103): sección elíptica, uno cada `levelMm` con el disco entre ellos
  const { aspect, levelMm, bodyMm, z0Mm } = SPINE_SHAPE;
  for (let z = z0Mm - levelMm * Math.floor((z0Mm + 240) / levelMm); z <= 280; z += levelMm) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(a.spine.r * CM, a.spine.r * CM, bodyMm * CM, 20), bone);
    body.scale.set(aspect, 1, 1 / aspect);
    body.rotation.x = Math.PI / 2;
    body.position.set(a.spine.x0 * CM, a.spine.y0 * CM, z * CM);
    // arco posterior con apófisis transversas (misma caja que el SDF)
    const archW = a.spine.archHalfWidth * 2 * CM;
    const archD = (a.spine.archY1 - a.spine.archY0) * CM;
    const arch = new THREE.Mesh(new RoundedBoxGeometry(archW, archD, 1.4, 2, 0.3), bone);
    arch.position.set(a.spine.x0 * CM, 0.5 * (a.spine.archY0 + a.spine.archY1) * CM, z * CM);
    const spinous = new THREE.Mesh(new RoundedBoxGeometry(1.2, 2.4, 1.6, 2, 0.3), bone);
    spinous.position.set(a.spine.x0 * CM, (a.spine.archY0 - 8) * CM, z * CM);
    g.add(body, arch, spinous);
  }
  for (const side of [-1, 1]) {
    const ph = (x: number) => (side < 0 ? Math.PI * x : Math.PI * (1 - x));
    const pts = [surfaceAt(a, ph(0.95), -205, 0.9), surfaceAt(a, ph(1.12), -222, 0.88), surfaceAt(a, ph(1.28), -235, 0.86)];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.7, 8, false), bone));
  }
  return g;
}

/** Malla del hígado extraída del mismo campo implícito que corta el haz (marching cubes). */
