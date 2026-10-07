import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ProbeFrame, Transducer } from '../../probe/probe';
import { CM } from './common';

/** Sonda convexa procedural (lente, cabezal, mango, marcador) y abanico del plano de imagen. */
export function buildProbe(tr: Transducer): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.5, metalness: 0.05 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.25, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8 });
  const collar = new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.55, metalness: 0.1 });
  const R = tr.curvatureRadius * CM;
  const half = (tr.footprintMm / 2) * CM;
  const el = (tr.elevationMm / 2) * CM;
  const halfAng = Math.asin(Math.min(1, half / R));
  // Lente: arco de cilindro de radio R (eje = elevación) centrado en z = −R, abierto hacia +z
  const lensGeo = new THREE.CylinderGeometry(R, R, el * 2, 40, 1, true, -halfAng, 2 * halfAng);
  const lensMesh = new THREE.Mesh(lensGeo, lens);
  lensMesh.position.z = -R;
  const sag = R - Math.sqrt(R * R - half * half);
  const head = new THREE.Mesh(new RoundedBoxGeometry(half * 2 + 0.3, el * 2 + 0.4, 2.0, 4, 0.3), shell);
  head.position.z = -sag - 1.1;
  const shoulder = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(2.4, 0), new THREE.Vector2(2.3, 0.4), new THREE.Vector2(1.7, 1.0), new THREE.Vector2(1.2, 1.6)],
      28,
    ),
    shell,
  );
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.scale.set(1, 1, 0.7);
  shoulder.position.z = -sag - 2.1;
  const rs = [1.2, 1.25, 1.2, 1.1, 1.0, 1.0, 1.08, 1.12, 1.06, 0.9];
  const profile = rs.map((r, i) => new THREE.Vector2(r, (i / (rs.length - 1)) * 7.4));
  profile.push(new THREE.Vector2(0.6, 7.5), new THREE.Vector2(0, 7.56));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  handle.rotation.x = -Math.PI / 2;
  handle.scale.set(1, 1, 0.74);
  handle.position.z = -sag - 3.6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.9, 0.32, 24), collar);
  band.rotation.x = Math.PI / 2;
  band.position.z = -sag - 11.0;
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.7, 1.4, 20), rubber);
  relief.rotation.x = -Math.PI / 2;
  relief.position.z = -sag - 11.9;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -sag - 12.5),
        new THREE.Vector3(0.2, 0.6, -sag - 14.5),
        new THREE.Vector3(0.8, 2.4, -sag - 16.8),
      ]),
      14,
      0.3,
      10,
      false,
    ),
    rubber,
  );
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(
    new RoundedBoxGeometry(0.3, 0.7, 1.2, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.45 }),
  );
  ridge.position.set(half + 0.3, 0, -sag - 1.3);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  dot.position.set(half + 0.15, 0, -sag - 2.9);
  // Same marked end, also visible on the outward housing face toward the operator.
  // Rigid local geometry: never billboard it or change the acoustic frame.
  const topMark = new THREE.Mesh(
    new RoundedBoxGeometry(0.65, 0.9, 0.16, 2, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  topMark.position.set(half * 0.78, 0, -sag - 2.18);
  marker.add(ridge, dot, topMark);
  probe.add(lensMesh, head, shoulder, handle, band, relief, cable, marker);
  return { probe, marker };
}

export function buildFan(): { fan: THREE.Mesh; edges: THREE.LineSegments } {
  const fan = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x3fb6a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  fan.renderOrder = 4;
  const edges = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.7 }),
  );
  edges.renderOrder = 5;
  return { fan, edges };
}

export function updateFan(fan: THREE.Mesh, edges: THREE.LineSegments, fr: ProbeFrame, tr: Transducer, depthMm: number): void {
  const n = 20;
  const C = new THREE.Vector3(fr.curvatureCenter[0] * CM, fr.curvatureCenter[1] * CM, fr.curvatureCenter[2] * CM);
  const at = (theta: number, r: number): THREE.Vector3 => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const d = new THREE.Vector3(
      fr.axial[0] * c + fr.lateral[0] * s,
      fr.axial[1] * c + fr.lateral[1] * s,
      fr.axial[2] * c + fr.lateral[2] * s,
    );
    return C.clone().add(d.multiplyScalar((tr.curvatureRadius + r) * CM));
  };
  const verts: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = -tr.halfSector + (2 * tr.halfSector * i) / n;
    const t1 = -tr.halfSector + (2 * tr.halfSector * (i + 1)) / n;
    const a0 = at(t0, 0);
    const a1 = at(t1, 0);
    const b0 = at(t0, depthMm);
    const b1 = at(t1, depthMm);
    verts.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
    e.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
  }
  const l0 = at(-tr.halfSector, 0);
  const l1 = at(-tr.halfSector, depthMm);
  const r0 = at(tr.halfSector, 0);
  const r1 = at(tr.halfSector, depthMm);
  e.push(l0.x, l0.y, l0.z, l1.x, l1.y, l1.z, r0.x, r0.y, r0.z, r1.x, r1.y, r1.z);
  fan.geometry.dispose();
  fan.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  edges.geometry.dispose();
  edges.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(e, 3));
}
