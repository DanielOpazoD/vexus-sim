import * as THREE from 'three';
import { torsoSkinPoint } from '../../anatomy/primitives';
import type { AnatomyScene } from '../../anatomy/scene';

/** Unidades de la escena three.js: cm (anatomía en mm / 10). */
export const CM = 0.1;

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh | THREE.Sprite;
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    const mat = 'material' in mesh ? mesh.material : null;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const sm = m as THREE.SpriteMaterial;
      if (sm.map) sm.map.dispose();
      m.dispose();
    }
  });
}

/** Escala del contorno del tronco a lo largo de z (hombros, cintura y pelvis, solo estética). */
export function torsoScale(zMm: number): number {
  if (zMm < -170) return 1 - 0.1 * Math.min(1, (-170 - zMm) / 80);
  if (zMm > 150) return 1 - 0.14 * Math.min(1, (zMm - 150) / 100);
  return 1;
}

/** Punto de la superficie del tronco (cm) a escala `scale`, ángulo φ y altura z (mm). */
export function surfaceAt(a: AnatomyScene, phi: number, zMm: number, scale: number): THREE.Vector3 {
  const t = a.torso;
  const p = torsoSkinPoint(phi, zMm, t);
  return new THREE.Vector3(p[0] * scale * CM, ((t.y0 ?? 0) + (p[1] - (t.y0 ?? 0)) * scale) * CM, zMm * CM);
}
