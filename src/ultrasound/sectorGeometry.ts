import type { Transducer } from '../probe/probe';

/**
 * Geometría de presentación del sector convexo: cómo se encaja el abanico
 * (radio de curvatura R + profundidad) en un lienzo de W × H píxeles con un
 * margen, y las conversiones píxel ↔ (θ, r). Es la ÚNICA definición: la usan el
 * renderizador (conversión de barrido, overlay) y el corte ecográfico, así que la
 * superposición corte ↔ imagen es geométricamente exacta. Módulo puro, sin WebGL.
 */
export interface SectorLayout {
  /** Vértice (centro de curvatura) en píxeles; puede quedar fuera del lienzo. */
  apexX: number;
  apexY: number;
  /** Píxeles por mm. */
  scale: number;
  width: number;
  height: number;
}

export function sectorLayout(width: number, height: number, tr: Transducer, depthMm: number, marginPx: number): SectorLayout {
  const R = tr.curvatureRadius;
  const halfW = (R + depthMm) * Math.sin(tr.halfSector);
  const totalH = R + depthMm - R * Math.cos(tr.halfSector);
  const scale = Math.min((width - 2 * marginPx) / (2 * halfW), (height - 2 * marginPx) / totalH);
  return { apexX: width / 2, apexY: marginPx - R * Math.cos(tr.halfSector) * scale, scale, width, height };
}

/** Píxel → (θ rad, r mm) o null fuera del sector. θ positivo hacia la izquierda de pantalla. */
export function pixelToBeam(l: SectorLayout, tr: Transducer, depthMm: number, px: number, py: number): { theta: number; r: number } | null {
  const dx = (px - l.apexX) / l.scale;
  const dy = (py - l.apexY) / l.scale;
  const rho = Math.hypot(dx, dy);
  const theta = -Math.atan2(dx, dy);
  const r = rho - tr.curvatureRadius;
  if (r < 0 || r > depthMm || Math.abs(theta) > tr.halfSector) return null;
  return { theta, r };
}

/** (θ, r) → píxel. */
export function beamToPixel(l: SectorLayout, tr: Transducer, theta: number, r: number): { x: number; y: number } {
  const rho = tr.curvatureRadius + r;
  return { x: l.apexX - Math.sin(theta) * rho * l.scale, y: l.apexY + Math.cos(theta) * rho * l.scale };
}
