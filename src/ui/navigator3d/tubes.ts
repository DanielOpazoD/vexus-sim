import * as THREE from 'three';
import type { Tube } from '../../anatomy/primitives';
import type { AnatomyScene } from '../../anatomy/scene';
import type { Vec3 } from '../../core/vec3';
import { CM } from './common';

/** Tubos con radio variable (Catmull-Rom) para vasos y conductos. */
export function variableTube(tube: Tube, color: number, opacity = 1): THREE.Mesh {
  const pts = tube.nodes.map((n) => new THREE.Vector3(n.p[0] * CM, n.p[1] * CM, n.p[2] * CM));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const segs = Math.max(12, pts.length * 12);
  const ringN = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, false);
  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const p = curve.getPointAt(u);
    const fl = u * (tube.nodes.length - 1);
    const i0 = Math.min(tube.nodes.length - 2, Math.floor(fl));
    const f = fl - i0;
    const r = (tube.nodes[i0].r + (tube.nodes[i0 + 1].r - tube.nodes[i0].r) * f) * CM;
    const N = frames.normals[s];
    const B = frames.binormals[s];
    for (let k = 0; k < ringN; k++) {
      const ang = (k / ringN) * Math.PI * 2;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang) * tube.apScale;
      pos.push(p.x + (N.x * nx + B.x * ny) * r, p.y + (N.y * nx + B.y * ny) * r, p.z + (N.z * nx + B.z * ny) * r);
    }
  }
  for (let s = 0; s < segs; s++)
    for (let k = 0; k < ringN; k++) {
      const a0 = s * ringN + k;
      const a1 = s * ringN + ((k + 1) % ringN);
      idx.push(a0, a0 + ringN, a1, a1, a0 + ringN, a1 + ringN);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, transparent: opacity < 1, opacity, side: THREE.DoubleSide }),
  );
}

export function buildVessels(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const colorOf = (id: string): number =>
    id.startsWith('ivc')
      ? 0x3b6fd8
      : id.startsWith('hv')
        ? 0x79b4ff
        : id.startsWith('pv')
          ? 0xd86ad8
          : id === 'aorta'
            ? 0xe04848
            : id.includes('Artery')
              ? 0xf0704d
              : id.includes('Vein')
                ? 0x5a8cdc
                : 0xf0a04d;
  for (const v of a.vessels) {
    const tube: Tube = { ...v.tube, nodes: v.tube.nodes.map((n) => ({ p: [n.p[0], n.p[1], Math.max(-240, n.p[2])] as Vec3, r: n.r })) };
    g.add(variableTube(tube, colorOf(v.id), v.id === 'aorta' ? 0.7 : 1));
  }
  return g;
}

/** Anillos y rótulos de puntos de partida sobre la piel (posiciones, no vistas). */
