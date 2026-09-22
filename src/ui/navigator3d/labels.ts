import * as THREE from 'three';
import { START_POINTS } from '../../app/startPoints';
import type { AnatomyScene } from '../../anatomy/scene';
import type { Vec3 } from '../../core/vec3';
import { CM, surfaceAt } from './common';

/** Rótulos (sprites de lienzo) y anillos de los puntos de partida sobre la piel. */
export function buildWindowMarks(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const marks = START_POINTS;
  // Orientación del paciente: cabeza, pies, derecha e izquierda
  const orient: Array<[string, Vec3]> = [
    ['cabeza', [0, 12, 52]],
    ['pies', [0, 8, -52]],
    ['D', [-a.torso.a * CM - 6, 6, 10]],
    ['I', [a.torso.a * CM + 6, 6, 10]],
  ];
  for (const [label, at] of orient) {
    const sp = labelSprite(label, '#e6ebf2');
    sp.position.set(at[0], at[1], at[2]);
    sp.scale.multiplyScalar(1.5);
    g.add(sp);
  }
  for (const m of marks) {
    const p = surfaceAt(a, m.phi, m.z, 1.01);
    const n = new THREE.Vector3(Math.cos(m.phi) / a.torso.a, Math.sin(m.phi) / a.torso.b, 0).normalize();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: m.color }));
    ring.position.copy(p);
    ring.lookAt(p.clone().add(n));
    const sprite = labelSprite(m.label, m.color);
    sprite.position.copy(p.clone().add(n.multiplyScalar(2.8)));
    g.add(ring, sprite);
  }
  return g;
}

export function labelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(text).width + 24;
  ctx.fillRect(128 - w / 2, 8, w, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(6.4, 1.6, 1);
  return sprite;
}

/**
 * Sonda convexa: lente curva (huella 62 mm, radio 60 mm), cabezal, hombros,
 * mango con cintura, alivio de tracción y cable. Marco local: x lateral
 * (marcador), y elevación, z hacia el paciente (lente en z = 0, cuerpo en −z).
 */
