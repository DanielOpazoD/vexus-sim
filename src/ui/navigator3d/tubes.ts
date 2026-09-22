import * as THREE from 'three';
import type { Tube } from '../../anatomy/primitives';
import type { AnatomyScene, VesselCaliber } from '../../anatomy/scene';
import type { Vec3 } from '../../core/vec3';
import { VESSEL_META, type VesselSystem } from '../../physiology/vessels';
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

/**
 * Vasos con el calibre DEL CASO: radios × `radiusScale` y sección elíptica de la
 * cava según la fisiología en régimen, así el avatar de una congestión grave
 * muestra la plétora (VCI 30 mm, suprahepáticas 12–15 mm) y el sano no.
 */
/** Color de cada sistema vascular en el navegador 3D. */
const SYSTEM_COLOR_3D: Record<VesselSystem, number> = {
  ivc: 0x3b6fd8,
  hepaticVein: 0x79b4ff,
  portal: 0xd86ad8,
  hepaticArtery: 0xf0704d,
  aorta: 0xe04848,
  renalArtery: 0xf0704d,
  renalVein: 0x5a8cdc,
  interlobarArtery: 0xf0704d,
  interlobarVein: 0x5a8cdc,
};

export function buildVessels(a: AnatomyScene, caliber: VesselCaliber): THREE.Group {
  const g = new THREE.Group();
  for (const v of a.vessels) {
    const scale = caliber.radiusScale(v.id);
    const apScale = VESSEL_META[v.id].system === 'ivc' ? caliber.ivcApScale : v.tube.apScale;
    const tube: Tube = {
      ...v.tube,
      apScale,
      nodes: v.tube.nodes.map((n) => ({ p: [n.p[0], n.p[1], Math.max(-240, n.p[2])] as Vec3, r: n.r * scale })),
    };
    const system = VESSEL_META[v.id].system;
    g.add(variableTube(tube, SYSTEM_COLOR_3D[system], system === 'aorta' ? 0.7 : 1));
  }
  return g;
}

/** Anillos y rótulos de puntos de partida sobre la piel (posiciones, no vistas). */
