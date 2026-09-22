import { EQUIPMENT_LIMITS } from '../../app/equipment';
import { help, slider } from '../controls';
import type { PanelContext } from './context';

/**
 * Mandos básicos de imagen (profundidad, ganancia, foco): los mismos deslizadores
 * en «Adquirir» (para no cambiar de pestaña mientras se busca la ventana) y en
 * «Imagen» (con rango dinámico, persistencia y TGC). Una sola fuente de verdad.
 */
export function imageBasics(ctx: PanelContext, sec: HTMLElement): void {
  const s = ctx.sim;
  const ch = () => undefined;
  ctx.track(
    slider(
      sec,
      {
        label: 'Profundidad',
        ...EQUIPMENT_LIMITS.depthMm,
        get: () => s().bmode.depthMm,
        set: (v) => ctx.dispatch({ type: 'bmode', patch: { depthMm: v } }),
        format: (v) => `${(v / 10).toFixed(0)} cm`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      sec,
      {
        label: 'Ganancia',
        ...EQUIPMENT_LIMITS.gainDb,
        get: () => s().bmode.gainDb,
        set: (v) => ctx.dispatch({ type: 'bmode', patch: { gainDb: v } }),
        format: (v) => `${v} dB`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      sec,
      {
        label: 'Foco',
        min: 20,
        max: 200,
        step: 5,
        get: () => s().bmode.focusMm,
        set: (v) => ctx.dispatch({ type: 'bmode', patch: { focusMm: v } }),
        format: (v) => `${(v / 10).toFixed(1)} cm`,
      },
      ch,
    ),
  );
}

/** Pestaña Imagen: profundidad, ganancia, foco, rango dinámico, persistencia y TGC de 8 bandas. */
export function buildImageTab(ctx: PanelContext, p: HTMLElement): void {
  const s = ctx.sim;
  const sec = ctx.section(p, 'Imagen 2D');
  const ch = () => undefined;
  imageBasics(ctx, sec);
  ctx.track(
    slider(
      sec,
      {
        label: 'Rango dinámico',
        min: 40,
        max: 80,
        step: 2,
        get: () => s().bmode.dynamicRangeDb,
        set: (v) => ctx.dispatch({ type: 'bmode', patch: { dynamicRangeDb: v } }),
        format: (v) => `${v} dB`,
      },
      ch,
    ),
  );
  ctx.track(
    slider(
      sec,
      {
        label: 'Persistencia',
        min: 0,
        max: 0.8,
        step: 0.05,
        get: () => s().bmode.persistence,
        set: (v) => ctx.dispatch({ type: 'bmode', patch: { persistence: v } }),
        format: (v) => v.toFixed(2),
      },
      ch,
    ),
  );
  const tgcSec = ctx.section(p, 'TGC');
  const bank = document.createElement('div');
  bank.className = 'tgc';
  for (let i = 0; i < 8; i++) {
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = '-15';
    inp.max = '15';
    inp.step = '1';
    inp.title = `TGC banda ${i + 1} (${i < 4 ? 'superficial' : 'profunda'})`;
    inp.addEventListener('input', () => ctx.dispatch({ type: 'tgc', band: i, db: Number(inp.value) }));
    bank.appendChild(inp);
    ctx.track({ sync: () => (inp.value = String(s().bmode.tgcDb[i])) });
  }
  tgcSec.appendChild(bank);
  help(tgcSec, 'Superficial → profundo. Amplifica ecos y ruido por igual; no recupera lo que la atenuación extinguió.');
}
