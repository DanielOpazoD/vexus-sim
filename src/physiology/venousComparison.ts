import { mmsToCms } from '../core/units';
import type { PhysiologySample } from './engine';
import type { VesselId } from './vessels';

/** Orden docente fijo; el signo describe flujo anatómico, no la orientación de la pantalla PW. */
export const VENOUS_COMPARISON_CHANNELS = Object.freeze([
  Object.freeze({ id: 'hepatic', vessel: 'hvRight', label: 'Suprahepática derecha', forward: 'hacia la aurícula derecha' }),
  Object.freeze({ id: 'portal', vessel: 'pvTrunk', label: 'Porta', forward: 'hacia el hígado' }),
  Object.freeze({ id: 'renal', vessel: 'interlobarVein1', label: 'Vena interlobar derecha', forward: 'hacia el hilio renal' }),
] as const satisfies readonly { id: string; vessel: VesselId; label: string; forward: string }[]);

export interface VenousComparisonPoint {
  readonly t: number;
  readonly ecgMv: number;
  readonly beatIndex: number;
  readonly cardiacPhase: number;
  readonly respiratoryPhase: number;
  readonly inspiredFraction: number;
  readonly respiratoryCycling: boolean;
  /** Presiones instantáneas, no PAD media estimada ni presión transmural. */
  readonly rightAtrialMmHg: number;
  readonly abdominalMmHg: number;
  /** cm/s, media espacial Q/A de cada vaso; no pico de la envolvente espectral. */
  readonly meanVelocityCmS: readonly [number, number, number];
}

export interface VenousComparisonTrace {
  readonly kind: 'physiology-reference';
  readonly velocityUnit: 'cm/s';
  readonly channels: typeof VENOUS_COMPARISON_CHANNELS;
  readonly points: readonly VenousComparisonPoint[];
}

/** Observador puro: no integra, no genera ondas, no clasifica VExUS y no consume aleatoriedad. */
export function venousComparisonTrace(samples: readonly PhysiologySample[]): VenousComparisonTrace {
  let previous = -Infinity;
  const points = samples.map((s): VenousComparisonPoint => {
    const velocity = VENOUS_COMPARISON_CHANNELS.map((c) => mmsToCms(s.velocities[c.vessel])) as [number, number, number];
    const values = [s.t, s.ecgMv, s.beatIndex, s.cardiacPhase, s.resp.phase, s.resp.volume, s.pRa, s.pAbd, ...velocity];
    if (values.some((v) => !Number.isFinite(v))) throw new Error('Comparación venosa: muestra no finita');
    if (s.t <= previous) throw new Error('Comparación venosa: tiempos duplicados o desordenados');
    previous = s.t;
    return {
      t: s.t,
      ecgMv: s.ecgMv,
      beatIndex: s.beatIndex,
      cardiacPhase: s.cardiacPhase,
      respiratoryPhase: s.resp.phase,
      inspiredFraction: s.resp.volume,
      respiratoryCycling: s.resp.cycling,
      rightAtrialMmHg: s.pRa,
      abdominalMmHg: s.pAbd,
      meanVelocityCmS: velocity,
    };
  });
  return { kind: 'physiology-reference', velocityUnit: 'cm/s', channels: VENOUS_COMPARISON_CHANNELS, points };
}

/** Capacidad del motor actual, no garantía de calibración de todo el dominio numérico. */
export const VENOUS_CONTROL_CAPABILITIES = Object.freeze({
  rightAtrialPressure: 'preset-only',
  abdominalPressure: 'preset-only',
  rvSystolicFunction: 'preset-only',
  tricuspidRegurgitation: 'preset-only',
  raCompliance: 'preset-only',
  systemicVenousCompliance: 'not-exposed',
  rvCompliance: 'not-modeled',
  tamponade: 'not-modeled',
} as const);
