import { EQUIPMENT_LIMITS } from '../../app/equipment';
import { nyquistVelocityCms, velocityFromShiftMmS } from '../../core/units';
import { dopplerScaleCommand } from '../../app/dopplerScale';
import { button, controlId, note, row, slider } from '../controls';
import type { PanelContext } from './context';

/** Subpaneles de Doppler; el panel muestra el que corresponde al modo activo (los dos en tríplex). */
export interface DopplerPanels {
  empty: HTMLElement;
  color: HTMLElement;
  pw: HTMLElement;
}

/**
 * Barrido de las franjas (25/50/100 mm/s): rótulo, botonera y unidad en una fila. Uno solo para el espectro, el
 * ECG y el modo M (decisión 80), que comparten el eje de tiempo.
 */
export function sweepRow(ctx: PanelContext, parent: HTMLElement): void {
  const r = document.createElement('div');
  r.className = 'field-row';
  const sl = document.createElement('span');
  sl.className = 'grow';
  sl.id = controlId('barrido');
  sl.textContent = 'Barrido';
  r.appendChild(sl);
  ctx
    .segmented<'25' | '50' | '100'>(
      r,
      [
        ['25', '25'],
        ['50', '50'],
        ['100', '100'],
      ],
      () => String(ctx.sim().pw.sweepMmS) as '25' | '50' | '100',
      (v) => ctx.dispatch({ type: 'pw', patch: { sweepMmS: Number(v) } }),
    )
    .setAttribute('aria-labelledby', sl.id);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'mm/s';
  r.appendChild(unit);
  parent.appendChild(r);
}

/** Pestaña Doppler (contextual): color o PW según el modo; vacía en modo B. Lo avanzado del PW, plegado. */
export function buildDopplerTab(ctx: PanelContext, p: HTMLElement): DopplerPanels {
  const s = ctx.sim;
  const empty = document.createElement('div');
  empty.className = 'empty';
  note(empty, 'Doppler apagado: activa Color o PW en la barra inferior (teclas C y P).');
  const r0 = row(empty);
  button(r0, 'Color', () => ctx.store.set({ mode: 'color', tab: 'doppler' }));
  button(r0, 'PW', () => ctx.store.set({ mode: 'pw', tab: 'doppler' }));
  p.appendChild(empty);

  const color = document.createElement('div');
  p.appendChild(color);
  const c = ctx.section(color, 'Doppler color', {
    info: 'Arrastra en la imagen para mover la caja; en tríplex acompaña a PW. Una escala baja puede plegar rojo a azul sin inversión real del flujo: aumenta la escala para comprobarlo. El filtro atenúa señales lentas; si el flujo supera su banda, el cambio puede ser poco visible. La escala avanza por los valores alcanzables y puede limitarse en tríplex o a mayor profundidad. El color depende del ángulo del haz.',
  });
  ctx.track(
    slider(c, {
      label: 'Escala',
      min: 4,
      max: 60,
      step: 1,
      get: () => Math.round(nyquistVelocityCms(s().color.prfHz, s().transducer.f0Doppler)),
      set: (v) => ctx.dispatch(dopplerScaleCommand(s().equipment, s().profile, 'color', v)),
      format: (v) => `±${v} cm/s`,
    }),
  );
  ctx.track(
    slider(c, {
      label: 'Filtro de pared',
      min: 20,
      max: 400,
      step: 10,
      get: () => s().color.wallFilterHz,
      set: (v) => ctx.dispatch({ type: 'color', patch: { wallFilterHz: v } }),
      format: (v) => `${Math.round(v)} Hz`,
    }),
  );
  ctx.track(
    slider(c, {
      label: 'Ganancia',
      ...EQUIPMENT_LIMITS.colorGainDb,
      get: () => s().color.gainDb,
      set: (v) => ctx.dispatch({ type: 'color', patch: { gainDb: v } }),
      format: (v) => `${v} dB`,
    }),
  );
  const cutoff = note(c);
  ctx.track({
    sync: () => {
      const hz = s().color.wallFilterHz;
      const velocity = velocityFromShiftMmS(hz, s().transducer.f0Doppler, 0) / 10;
      cutoff.textContent = `Filtro ${Math.round(hz)} Hz ≈ ${velocity.toFixed(1)} cm/s axiales. Atenuación gradual; no es un límite de velocidad absoluta.`;
    },
  });
  const cr = document.createElement('div');
  cr.className = 'field-row';
  c.appendChild(cr);
  ctx.track(
    button(
      cr,
      'Invertir mapa',
      () => ctx.dispatch({ type: 'color', patch: { invert: !s().color.invert } }),
      () => s().color.invert,
    ),
  );
  const box = document.createElement('div');
  box.className = 'stepper grow';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Tamaño de la caja de color');
  const boxLabel = document.createElement('span');
  boxLabel.textContent = 'Caja';
  box.appendChild(boxLabel);
  button(box, '−', () => ctx.dispatch({ type: 'scaleColorBox', factor: 1 / 1.15 })).el.setAttribute('aria-label', 'Achicar la caja');
  button(box, '+', () => ctx.dispatch({ type: 'scaleColorBox', factor: 1.15 })).el.setAttribute('aria-label', 'Agrandar la caja');
  cr.appendChild(box);

  const pw = document.createElement('div');
  p.appendChild(pw);
  const w = ctx.section(pw, 'Doppler pulsado', {
    info: 'Arrastra en la imagen para mover la puerta. La línea de base desplaza la presentación sin cambiar la señal. El filtro de pared elimina frecuencias bajas.',
  });
  ctx.track(
    slider(w, {
      label: 'Escala',
      min: 5,
      max: 120,
      step: 1,
      get: () => Math.round(nyquistVelocityCms(s().pw.prfHz, s().transducer.f0Doppler)),
      set: (v) => ctx.dispatch(dopplerScaleCommand(s().equipment, s().profile, 'pw', v)),
      format: (v) => `±${v} cm/s`,
    }),
  );
  ctx.track(
    slider(w, {
      label: 'Línea de base',
      min: -0.45,
      max: 0.45,
      step: 0.05,
      get: () => s().pw.baselineShift,
      set: (v) => ctx.dispatch({ type: 'pw', patch: { baselineShift: v } }),
      format: (v) => `${(v * 100).toFixed(0)} %`,
    }),
  );
  ctx.track(
    slider(w, {
      label: 'Puerta',
      min: 1,
      max: 10,
      step: 0.5,
      get: () => s().pw.gateMm,
      set: (v) => ctx.dispatch({ type: 'pw', patch: { gateMm: v } }),
      format: (v) => `${v.toFixed(1)} mm`,
    }),
  );
  ctx.track(
    slider(w, {
      label: 'Filtro de pared',
      min: 10,
      max: 300,
      step: 5,
      get: () => s().pw.wallFilterHz,
      set: (v) => ctx.dispatch({ type: 'pw', patch: { wallFilterHz: v } }),
      format: (v) => `${Math.round(v)} Hz`,
    }),
  );
  ctx.track(
    slider(w, {
      label: 'Ganancia',
      ...EQUIPMENT_LIMITS.gainDb,
      get: () => s().pw.gainDb,
      set: (v) => ctx.dispatch({ type: 'pw', patch: { gainDb: v } }),
      format: (v) => `${v} dB`,
    }),
  );
  sweepRow(ctx, w);
  ctx.track(
    button(
      row(w),
      'Invertir espectro',
      () => ctx.dispatch({ type: 'pw', patch: { invert: !s().pw.invert } }),
      () => s().pw.invert,
    ),
  );

  const adv = ctx.section(pw, 'Avanzado', {
    collapsed: true,
    info: 'La corrección angular solo cambia la velocidad rotulada; no modifica la señal adquirida.',
  });
  ctx.track(
    slider(adv, {
      label: 'Corrección angular',
      min: -80,
      max: 80,
      step: 1,
      get: () => (s().pw.angleCorrection * 180) / Math.PI,
      set: (v) => ctx.dispatch({ type: 'pw', patch: { angleCorrection: (v * Math.PI) / 180 } }),
      format: (v) => `${v.toFixed(0)}°`,
    }),
  );
  ctx.track(
    slider(adv, {
      label: 'Volumen del audio',
      min: 0,
      max: 1,
      step: 0.05,
      get: () => s().audio.volume,
      set: (v) => s().audio.setVolume(v),
      format: (v) => `${(v * 100).toFixed(0)} %`,
    }),
  );
  return { empty, color, pw };
}
