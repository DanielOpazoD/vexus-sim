import { EQUIPMENT_LIMITS, type Simulator } from '../../app/simulator';
import { nyquistVelocityCms, prfFromNyquistCms } from '../../core/units';
import { button, help, row, slider } from '../controls';
import type { PanelContext } from './context';

/** Subpaneles de Doppler; el panel muestra el que corresponde al modo activo. */
export interface DopplerPanels {
  empty: HTMLElement;
  color: HTMLElement;
  pw: HTMLElement;
}

/** Pestaña Doppler (contextual): color o PW según el modo; vacía en modo B. */
export function buildDopplerTab(ctx: PanelContext, p: HTMLElement): DopplerPanels {
  const s = ctx.sim;
  const ch = () => undefined;
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'Activa Color o PW en la barra inferior para ver sus controles.';
  const r0 = row(empty);
  button(r0, 'Color', () => ctx.store.set({ mode: 'color', tab: 'doppler' }));
  button(r0, 'PW', () => ctx.store.set({ mode: 'pw', tab: 'doppler' }));
  p.appendChild(empty);

  const color = document.createElement('div');
  p.appendChild(color);
  const c = ctx.section(color, 'Doppler color');
  ctx.track(
    slider(
      c,
      {
        label: 'Escala',
        min: 4,
        max: 60,
        step: 1,
        get: () => Math.round(nyquistVelocityCms(s().color.prfHz, s().transducer.f0Doppler)),
        set: (v) => (s().color.prfHz = Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler))),
        format: (v) => `±${v} cm/s`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      c,
      {
        label: 'Filtro pared',
        min: 20,
        max: 400,
        step: 10,
        get: () => s().color.wallFilterHz,
        set: (v) => (s().color.wallFilterHz = v),
        format: (v) => `${v} Hz`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      c,
      {
        label: 'Ganancia',
        min: 0.2,
        max: 4,
        step: 0.1,
        get: () => s().color.gain,
        set: (v) => (s().color.gain = v),
        format: (v) => v.toFixed(1),
      },
      ch,
    ),
  );
  const cr = row(c);
  ctx.track(
    button(
      cr,
      'Invertir mapa',
      () => (s().color.invert = !s().color.invert),
      () => s().color.invert,
    ),
  );
  ctx.track(button(cr, 'Caja +', () => sizeBox(s(), 1.15)));
  ctx.track(button(cr, 'Caja −', () => sizeBox(s(), 1 / 1.15)));
  help(
    c,
    'Clic en la imagen centra la caja. Escala baja → aliasing; filtro alto → desaparece flujo lento; el color depende de la orientación del haz.',
  );

  const pw = document.createElement('div');
  p.appendChild(pw);
  const w = ctx.section(pw, 'Doppler pulsado');
  ctx.track(
    slider(
      w,
      {
        label: 'Escala',
        min: 5,
        max: 120,
        step: 1,
        get: () => Math.round(nyquistVelocityCms(s().pw.prfHz, s().transducer.f0Doppler)),
        set: (v) => (s().pw.prfHz = Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler))),
        format: (v) => `±${v} cm/s`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Puerta',
        min: 1,
        max: 10,
        step: 0.5,
        get: () => s().pw.gateMm,
        set: (v) => (s().pw.gateMm = v),
        format: (v) => `${v.toFixed(1)} mm`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Filtro pared',
        min: 10,
        max: 300,
        step: 5,
        get: () => s().pw.wallFilterHz,
        set: (v) => (s().pw.wallFilterHz = v),
        format: (v) => `${v} Hz`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Línea base',
        min: -0.45,
        max: 0.45,
        step: 0.05,
        get: () => s().pw.baselineShift,
        set: (v) => (s().pw.baselineShift = v),
        format: (v) => `${(v * 100).toFixed(0)} %`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Ganancia',
        ...EQUIPMENT_LIMITS.gainDb,
        get: () => s().pw.gainDb,
        set: (v) => (s().pw.gainDb = v),
        format: (v) => `${v} dB`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Corr. angular',
        min: -80,
        max: 80,
        step: 1,
        get: () => (s().pw.angleCorrection * 180) / Math.PI,
        set: (v) => (s().pw.angleCorrection = (v * Math.PI) / 180),
        format: (v) => `${v.toFixed(0)}°`,
      },
      ch,
    ),
  );
  const sweepRow = document.createElement('div');
  sweepRow.className = 'control';
  const sl = document.createElement('label');
  sl.textContent = 'Barrido';
  sweepRow.appendChild(sl);
  const segHost = document.createElement('div');
  sweepRow.appendChild(segHost);
  ctx.segmented<'25' | '50' | '100'>(
    segHost,
    [
      ['25', '25'],
      ['50', '50'],
      ['100', '100'],
    ],
    () => String(s().pw.sweepMmS) as '25' | '50' | '100',
    (v) => (s().pw.sweepMmS = Number(v)),
  );
  const so = document.createElement('output');
  so.textContent = 'mm/s';
  sweepRow.appendChild(so);
  w.appendChild(sweepRow);
  const pr = row(w);
  ctx.track(
    button(
      pr,
      'Invertir espectro',
      () => (s().pw.invert = !s().pw.invert),
      () => s().pw.invert,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Volumen',
        min: 0,
        max: 1,
        step: 0.05,
        get: () => s().audio.volume,
        set: (v) => s().audio.setVolume(v),
        format: (v) => `${(v * 100).toFixed(0)} %`,
      },
      ch,
    ),
  );
  help(
    w,
    'Clic en la imagen coloca la puerta. La corrección angular solo cambia la velocidad rotulada; la línea de base solo la presentación; el filtro de pared elimina frecuencias bajas de la señal.',
  );
  return { empty, color, pw };
}

/** Agranda o encoge la caja de color alrededor de su centro. */
function sizeBox(sim: Simulator, f: number): void {
  const c = sim.color;
  const cm = (c.theta0 + c.theta1) / 2;
  const hw = ((c.theta1 - c.theta0) / 2) * f;
  c.theta0 = cm - hw;
  c.theta1 = cm + hw;
  const rm = (c.r0 + c.r1) / 2;
  const hr = ((c.r1 - c.r0) / 2) * f;
  c.r0 = Math.max(5, rm - hr);
  c.r1 = Math.min(sim.bmode.depthMm, rm + hr);
}
