import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AnatomyScene } from '../../anatomy/scene';
import { CM, surfaceAt, torsoScale } from './common';

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
    const sc = torsoScale(z);
    for (let i = 0; i <= nT; i++) {
      const th = (i / nT) * Math.PI * 2;
      // La piel usa la misma elipse que el modelo acústico (torsoDepth): así la
      // sonda apoya exactamente donde la ve el haz.
      pos.push(t.a * sc * Math.cos(th) * CM, t.b * sc * Math.sin(th) * (Math.sin(th) < 0 ? 0.95 : 1) * CM, z * CM);
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

export function buildSkeleton(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.55 });
  const cartilage = new THREE.MeshStandardMaterial({ color: 0xcfd9e6, roughness: 0.5, transparent: true, opacity: 0.85 });
  // Costillas 3–11 de ambos lados. Las derechas 5–10 siguen exactamente la ley de
  // scene.ribs (zAnterior + 60·(0,5 − 0,5·sen φ), escala 0,85); el resto la extiende.
  const anterior = [80, 60, 40, 20, 0, -25, -50, -75, -100];
  anterior.forEach((zAnt, k) => {
    const ribNo = k + 3;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const cart: THREE.Vector3[] = [];
      const phiFront = ribNo <= 7 ? 0.5 * Math.PI + 0.1 : 0.5 * Math.PI + 0.25 + (ribNo - 7) * 0.12;
      for (let i = 0; i <= 44; i++) {
        const phR = phiFront + ((1.5 * Math.PI - 0.12 - phiFront) * i) / 44; // anterior → posterior, lado derecho
        const ph = side < 0 ? phR : Math.PI - phR;
        const zr = zAnt + 60 * (0.5 - 0.5 * Math.sin(phR));
        const p = surfaceAt(a, ph, zr, 0.85);
        // el arco termina en la apófisis transversa (mismo criterio que el SDF)
        if (p.y / CM < a.spine.y0 && Math.abs(p.x / CM - a.spine.x0) < a.spine.archHalfWidth + 6) break;
        pts.push(p);
        if (ribNo <= 7 && phR < 0.5 * Math.PI + 0.45) cart.push(p);
      }
      const r = ribNo >= 11 ? 0.35 : 0.5;
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 8, false), bone));
      if (cart.length >= 3)
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cart), 12, r * 1.05, 8, false), cartilage));
    }
  });
  const yFront = a.torso.b * 0.85 * CM;
  const sternum = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.9, 11, 3, 0.4), bone);
  sternum.position.set(0, yFront - 0.2, 8.5);
  const xiphoid = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.5, 3, 3, 0.3), cartilage);
  xiphoid.position.set(0, yFront - 0.4, 1.5);
  g.add(sternum, xiphoid);
  for (let z = -240; z <= 280; z += 28) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(a.spine.r * CM, a.spine.r * CM, 2.2, 20), bone);
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
