import { EQUIPMENT_LIMITS } from '../../app/equipment';
import { nyquistVelocityCms, prfFromNyquistCms } from '../../core/units';
import { button, controlId, note, row, slider } from '../controls';
import type { PanelContext } from './context';

/** Subpaneles de Doppler; el panel muestra el que corresponde al modo activo (los dos en tríplex). */
export interface DopplerPanels {
  empty: HTMLElement;
  color: HTMLElement;
  pw: HTMLElement;
}

/** Pestaña Doppler (contextual): color o PW según el modo; vacía en modo B. Lo avanzado del PW, plegado. */
export function buildDopplerTab(ctx: PanelContext, p: HTMLElement): DopplerPanels {
  const s = ctx.sim;
  const ch = () => undefined;
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
    info: 'Clic en la imagen: centra la caja (con PW, en tríplex, coloca la puerta y la caja la acompaña). Escala baja → aliasing; filtro alto → desaparece el flujo lento; el color depende de la orientación del haz.',
  });
  ctx.track(
    slider(
      c,
      {
        label: 'Escala',
        min: 4,
        max: 60,
        step: 1,
        get: () => Math.round(nyquistVelocityCms(s().color.prfHz, s().transducer.f0Doppler)),
        set: (v) => ctx.dispatch({ type: 'color', patch: { prfHz: Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler)) } }),
        format: (v) => `±${v} cm/s`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      c,
      {
        label: 'Filtro de pared',
        min: 20,
        max: 400,
        step: 10,
        get: () => s().color.wallFilterHz,
        set: (v) => ctx.dispatch({ type: 'color', patch: { wallFilterHz: v } }),
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
        ...EQUIPMENT_LIMITS.colorGainDb,
        get: () => s().color.gainDb,
        set: (v) => ctx.dispatch({ type: 'color', patch: { gainDb: v } }),
        format: (v) => `${v} dB`,
      },
      ch,
    ),
  );
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
    info: 'Clic en la imagen coloca la puerta. El filtro de pared elimina las frecuencias bajas de la señal.',
  });
  ctx.track(
    slider(
      w,
      {
        label: 'Escala',
        min: 5,
        max: 120,
        step: 1,
        get: () => Math.round(nyquistVelocityCms(s().pw.prfHz, s().transducer.f0Doppler)),
        set: (v) => ctx.dispatch({ type: 'pw', patch: { prfHz: Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler)) } }),
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
        set: (v) => ctx.dispatch({ type: 'pw', patch: { gateMm: v } }),
        format: (v) => `${v.toFixed(1)} mm`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      w,
      {
        label: 'Filtro de pared',
        min: 10,
        max: 300,
        step: 5,
        get: () => s().pw.wallFilterHz,
        set: (v) => ctx.dispatch({ type: 'pw', patch: { wallFilterHz: v } }),
        format: (v) => `${v} Hz`,
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
        set: (v) => ctx.dispatch({ type: 'pw', patch: { gainDb: v } }),
        format: (v) => `${v} dB`,
      },
      ch,
    ),
  );
  // Barrido: rótulo, botonera y unidad en una fila
  const sweepRow = document.createElement('div');
  sweepRow.className = 'field-row';
  const sl = document.createElement('span');
  sl.className = 'grow';
  sl.id = controlId('barrido');
  sl.textContent = 'Barrido';
  sweepRow.appendChild(sl);
  ctx
    .segmented<'25' | '50' | '100'>(
      sweepRow,
      [
        ['25', '25'],
        ['50', '50'],
        ['100', '100'],
      ],
      () => String(s().pw.sweepMmS) as '25' | '50' | '100',
      (v) => ctx.dispatch({ type: 'pw', patch: { sweepMmS: Number(v) } }),
    )
    .setAttribute('aria-labelledby', sl.id);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'mm/s';
  sweepRow.appendChild(unit);
  w.appendChild(sweepRow);
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
    info: 'La corrección angular solo cambia la velocidad rotulada y la línea de base solo la presentación; ninguna de las dos toca la señal.',
  });
  ctx.track(
    slider(
      adv,
      {
        label: 'Línea de base',
        min: -0.45,
        max: 0.45,
        step: 0.05,
        get: () => s().pw.baselineShift,
        set: (v) => ctx.dispatch({ type: 'pw', patch: { baselineShift: v } }),
        format: (v) => `${(v * 100).toFixed(0)} %`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      adv,
      {
        label: 'Corrección angular',
        min: -80,
        max: 80,
        step: 1,
        get: () => (s().pw.angleCorrection * 180) / Math.PI,
        set: (v) => ctx.dispatch({ type: 'pw', patch: { angleCorrection: (v * Math.PI) / 180 } }),
        format: (v) => `${v.toFixed(0)}°`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      adv,
      {
        label: 'Volumen del audio',
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
  return { empty, color, pw };
}
