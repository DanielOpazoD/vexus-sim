/** Diagnóstico de arranque; no participa en el reloj, la anatomía ni la adquisición. */
export const STARTUP_PREFIX = '[vexus:startup] ';
export const STARTUP_STAGES = [
  'bootstrap:begin',
  'simulation:begin',
  'simulation:ready',
  'controls:ready',
  'cut:import',
  'cut:ready',
  'navigator:import',
  'navigator:construct',
  'navigator:ready',
  'hooks:import',
  'hooks:ready',
  'loop:scheduled',
  'frame:begin',
  'advance:begin',
  'advance:ready',
  'ultrasound:begin',
  'ultrasound:ready',
  'ultrasound:gpu-submitted',
  'ultrasound:gpu-ready',
  'ultrasound:gpu-failed',
  'navigator:draw',
  'navigator:drawn',
  'frame:first',
  'frame:second',
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number];
export interface StartupEntry {
  stage: StartupStage;
  /** Milisegundos desde navigationStart, NO tiempo físico del paciente. */
  timeMs: number;
}

/** Cada etapa se registra una vez, incluso si el bucle vuelve a intentar un cuadro fallido. */
export function startupRecorder(enabled: boolean, emit: (message: string) => void, now: () => number): (stage: StartupStage) => void {
  const seen = new Set<StartupStage>();
  return (stage) => {
    if (!enabled || seen.has(stage)) return;
    seen.add(stage);
    emit(STARTUP_PREFIX + JSON.stringify({ stage, timeMs: now() }));
  };
}

export function startupEntry(message: string): StartupEntry | null {
  if (!message.startsWith(STARTUP_PREFIX)) return null;
  try {
    const entry = JSON.parse(message.slice(STARTUP_PREFIX.length)) as Partial<StartupEntry> | null;
    return entry &&
      STARTUP_STAGES.includes(entry.stage as StartupStage) &&
      typeof entry.timeMs === 'number' &&
      Number.isFinite(entry.timeMs) &&
      entry.timeMs >= 0
      ? (entry as StartupEntry)
      : null;
  } catch {
    return null;
  }
}

export const startupTraceEnabled =
  typeof location !== 'undefined' && ['e2e', 'startupTrace'].some((key) => new URLSearchParams(location.search).has(key));

export const markStartup = startupRecorder(
  startupTraceEnabled,
  (message) => console.debug(message),
  () => performance.now(),
);
