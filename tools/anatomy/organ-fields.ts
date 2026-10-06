import type { Vec3 } from '../../src/core/vec3';
import type { AnatomyScene } from '../../src/anatomy/scene';
import { heartChambers, HEART_WALLS } from '../../src/anatomy/organs/heart';
import { kidneyLocal, kidneyOuterSdf } from '../../src/anatomy/organs/kidney';

/** Campos individuales en coordenadas materiales del tronco; negativo significa interior. */
export function organSignedFields(scene: AnatomyScene) {
  const walls = [HEART_WALLS.lv, HEART_WALLS.rv, HEART_WALLS.ra, HEART_WALLS.la];
  return {
    liverBeforeWallAndDiaphragmClip: (p: Vec3) => scene.liverSdf(p),
    liverAfterWallAndDiaphragmClip: (p: Vec3) => -scene.liverInteriorMargin(p),
    kidneyRight: (p: Vec3) => kidneyOuterSdf(kidneyLocal(p, scene.kidneyRight), scene.kidneyRight),
    kidneyLeft: (p: Vec3) => kidneyOuterSdf(kidneyLocal(p, scene.kidneyLeft), scene.kidneyLeft),
    heartBeforeDiaphragmClip: (p: Vec3) => Math.min(...heartChambers(p).map((x, i) => x - walls[i])),
  };
}
