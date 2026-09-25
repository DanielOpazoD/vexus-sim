import type { BModeSettings, ColorSettings } from '../ultrasound/renderer';
import type { EquipmentSettings, PwSettings } from './simulator';

/**
 * Estado del ecógrafo como modelo de dominio (Fase 1): inmutable, cambiado solo por comandos y
 * siempre normalizado con las invariantes físicas del equipo. Antes la UI, el teclado y el clic
 * sobre la imagen mutaban `sim.bmode/color/pw` directamente y cada uno aplicaba (o no) sus
 * propios límites: al reducir la profundidad la puerta PW o la caja de color quedaban fuera de
 * la imagen, y la PRF podía superar lo que permite la profundidad.
 */
export type ImagingMode = 'B' | 'color' | 'pw';

export type EquipmentCommand =
  | { type: 'bmode'; patch: Partial<BModeSettings> }
  | { type: 'color'; patch: Partial<ColorSettings> }
  | { type: 'pw'; patch: Partial<PwSettings> }
  | { type: 'mode'; mode: ImagingMode }
  | { type: 'stepDepth'; deltaMm: number }
  | { type: 'stepGain'; deltaDb: number }
  | { type: 'tgc'; band: number; db: number }
  /**
   * Composición espacial (decisión 58): el conmutador del equipo. Solo se forma con el color apagado
   * (`compoundActive`); el conmutador se conserva al abrir y cerrar el color.
   */
  | { type: 'compound'; enabled: boolean }
  /** Centra la caja de color en (θ, r) conservando su tamaño. */
  | { type: 'centerColorBox'; theta: number; r: number }
  /** Escala la caja de color alrededor de su centro. */
  | { type: 'scaleColorBox'; factor: number }
  /** Coloca el centro de la puerta PW en (θ, r). */
  | { type: 'placeGate'; theta: number; r: number };

/** Contexto físico que fija los límites: semiángulo del sector y velocidad de reconstrucción. */
export interface EquipmentContext {
  halfSectorRad: number;
  cMmS: number;
}

/** Límites del equipo (deslizadores, atajos y normalización comparten estos valores). */
export const EQUIPMENT_LIMITS = {
  depthMm: { min: 60, max: 240, step: 5 },
  gainDb: { min: -20, max: 20, step: 1 },
  focusMm: { min: 20, max: 240 },
  dynamicRangeDb: { min: 40, max: 80 },
  persistence: { min: 0, max: 0.8 },
  tgcDb: { min: -15, max: 15 },
  prfHz: { min: 250, max: 12_000 },
  gateMm: { min: 1, max: 20 },
  colorGainDb: { min: -20, max: 24, step: 1 },
  colorBox: { minWidthRad: 0.06, minDepthMm: 10, minR0Mm: 5 },
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * PRF máxima sin ambigüedad de profundidad para un reflector a `depthMm`: el eco debe volver
 * antes del siguiente pulso (PRF ≤ c / 2d). Sin PRF alta (HPRF), como el equipo de referencia.
 */
export function maxPrfForDepth(depthMm: number, cMmS: number): number {
  return Math.min(EQUIPMENT_LIMITS.prfHz.max, cMmS / (2 * Math.max(1, depthMm)));
}

/** Aplica todas las invariantes. Idempotente: normalizar dos veces no cambia nada. */
export function normalizeEquipment(e: EquipmentSettings, ctx: EquipmentContext): EquipmentSettings {
  const L = EQUIPMENT_LIMITS;
  const hs = ctx.halfSectorRad;
  const depth = clamp(e.bmode.depthMm, L.depthMm.min, L.depthMm.max);
  const bmode: BModeSettings = {
    ...e.bmode,
    depthMm: depth,
    focusMm: clamp(e.bmode.focusMm, L.focusMm.min, depth),
    gainDb: clamp(e.bmode.gainDb, L.gainDb.min, L.gainDb.max),
    dynamicRangeDb: clamp(e.bmode.dynamicRangeDb, L.dynamicRangeDb.min, L.dynamicRangeDb.max),
    persistence: clamp(e.bmode.persistence, L.persistence.min, L.persistence.max),
    tgcDb: e.bmode.tgcDb.map((v) => clamp(v, L.tgcDb.min, L.tgcDb.max)),
  };
  // Caja de color: dentro del sector y de la profundidad, con un tamaño mínimo
  const c = e.color;
  const width = clamp(Math.abs(c.theta1 - c.theta0), L.colorBox.minWidthRad, 2 * hs);
  const thetaMid = clamp((c.theta0 + c.theta1) / 2, -hs + width / 2, hs - width / 2);
  const span = clamp(Math.abs(c.r1 - c.r0), L.colorBox.minDepthMm, depth - L.colorBox.minR0Mm);
  const rMid = clamp((c.r0 + c.r1) / 2, L.colorBox.minR0Mm + span / 2, depth - span / 2);
  const r1 = rMid + span / 2;
  const color: ColorSettings = {
    ...c,
    theta0: thetaMid - width / 2,
    theta1: thetaMid + width / 2,
    r0: rMid - span / 2,
    r1,
    prfHz: clamp(c.prfHz, L.prfHz.min, maxPrfForDepth(r1, ctx.cMmS)),
    wallFilterHz: Math.max(0, c.wallFilterHz),
    gainDb: clamp(c.gainDb, L.colorGainDb.min, L.colorGainDb.max),
  };
  // Puerta PW: dentro del sector y de la imagen; PRF limitada por su profundidad
  const p = e.pw;
  const gateMm = clamp(p.gateMm, L.gateMm.min, L.gateMm.max);
  const gateDepth = clamp(p.depthMm, 5 + gateMm / 2, depth - gateMm / 2);
  const pw: PwSettings = {
    ...p,
    gateMm,
    theta: clamp(p.theta, -hs, hs),
    depthMm: gateDepth,
    prfHz: clamp(p.prfHz, L.prfHz.min, maxPrfForDepth(gateDepth + gateMm / 2, ctx.cMmS)),
    baselineShift: clamp(p.baselineShift, -0.5, 0.5),
    wallFilterHz: Math.max(0, p.wallFilterHz),
  };
  return { bmode, color, pw };
}

/** Reductor puro: estado + comando → estado normalizado. */
export function reduceEquipment(e: EquipmentSettings, cmd: EquipmentCommand, ctx: EquipmentContext): EquipmentSettings {
  let next: EquipmentSettings;
  switch (cmd.type) {
    case 'bmode':
      next = { ...e, bmode: { ...e.bmode, ...cmd.patch } };
      break;
    case 'color':
      next = { ...e, color: { ...e.color, ...cmd.patch } };
      break;
    case 'pw':
      next = { ...e, pw: { ...e.pw, ...cmd.patch } };
      break;
    case 'mode':
      next = { ...e, color: { ...e.color, enabled: cmd.mode === 'color' }, pw: { ...e.pw, enabled: cmd.mode === 'pw' } };
      break;
    case 'stepDepth':
      next = { ...e, bmode: { ...e.bmode, depthMm: e.bmode.depthMm + cmd.deltaMm } };
      break;
    case 'stepGain':
      next = { ...e, bmode: { ...e.bmode, gainDb: e.bmode.gainDb + cmd.deltaDb } };
      break;
    case 'compound':
      next = { ...e, bmode: { ...e.bmode, compound: cmd.enabled } };
      break;
    case 'tgc': {
      const tgcDb = [...e.bmode.tgcDb];
      if (cmd.band >= 0 && cmd.band < tgcDb.length) tgcDb[cmd.band] = cmd.db;
      next = { ...e, bmode: { ...e.bmode, tgcDb } };
      break;
    }
    case 'centerColorBox': {
      const hw = (e.color.theta1 - e.color.theta0) / 2;
      const hr = (e.color.r1 - e.color.r0) / 2;
      next = { ...e, color: { ...e.color, theta0: cmd.theta - hw, theta1: cmd.theta + hw, r0: cmd.r - hr, r1: cmd.r + hr } };
      break;
    }
    case 'scaleColorBox': {
      const c = e.color;
      const tm = (c.theta0 + c.theta1) / 2;
      const hw = ((c.theta1 - c.theta0) / 2) * cmd.factor;
      const rm = (c.r0 + c.r1) / 2;
      const hr = ((c.r1 - c.r0) / 2) * cmd.factor;
      next = { ...e, color: { ...c, theta0: tm - hw, theta1: tm + hw, r0: rm - hr, r1: rm + hr } };
      break;
    }
    case 'placeGate':
      next = { ...e, pw: { ...e.pw, theta: cmd.theta, depthMm: cmd.r } };
      break;
  }
  return normalizeEquipment(next, ctx);
}

type Listener = (next: EquipmentSettings, prev: EquipmentSettings) => void;

/**
 * Dueño del estado del equipo: sobrevive a los cambios de caso (el simulador nuevo recibe el
 * mismo estado) y avisa a las vistas en cada cambio, sin sondeo.
 */
export class EquipmentController {
  private listeners = new Set<Listener>();

  constructor(
    private current: EquipmentSettings,
    private readonly ctx: EquipmentContext,
  ) {
    this.current = normalizeEquipment(current, ctx);
  }

  get state(): EquipmentSettings {
    return this.current;
  }

  dispatch(cmd: EquipmentCommand): void {
    const prev = this.current;
    this.current = reduceEquipment(prev, cmd, this.ctx);
    for (const l of this.listeners) l(this.current, prev);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
