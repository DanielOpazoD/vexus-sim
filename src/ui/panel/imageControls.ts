import { EQUIPMENT_LIMITS } from '../../app/equipment';
import { COMPOUND } from '../../ultrasound/compound';
import { button, controlId, note, row, slider } from '../controls';
import type { PanelContext } from './context';

/** Mandos básicos de la imagen 2D (profundidad, ganancia, foco), a mano mientras se busca la ventana. */
export function buildImageBasics(ctx: PanelContext, sec: HTMLElement): void {
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

/** Explicación de los mandos avanzados (el ⓘ de su sección). */
export const IMAGE_ADVANCED_INFO =
  `Composición espacial: tres miradas intercaladas (0° y ±${COMPOUND.steerDeg}°) promediadas; el moteado pierde contraste ` +
  'con el mismo grano y las sombras se acortan; se apaga con el color. Armónica (THI): emite a 1,75 MHz y forma la imagen con ' +
  'el armónico de 3,5 MHz que genera el propio tejido; menos neblina junto a las paredes y menos reverberación y transitorio ' +
  'en el campo cercano, a cambio de algo más de ruido en profundidad; el color y el PW siguen en fundamental. TGC, de ' +
  'superficial a profundo: amplifica ecos y ruido por igual; no recupera lo que la atenuación extinguió.';

/** Mandos avanzados de la imagen 2D: rango dinámico, persistencia, composición espacial, armónica y TGC de 8 bandas. */
export function buildImageAdvanced(ctx: PanelContext, sec: HTMLElement): void {
  const s = ctx.sim;
  const ch = () => undefined;
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
  // Composición espacial (decisión 58): el conmutador; con el color encendido no se forma
  ctx.track(
    button(
      row(sec),
      'Composición espacial',
      () => ctx.dispatch({ type: 'compound', enabled: !s().bmode.compound }),
      () => s().bmode.compound,
    ),
  );
  // Armónica tisular (decisión 77): el conmutador; solo cambia el modo B
  ctx.track(
    button(
      row(sec),
      'Armónica (THI)',
      () => ctx.dispatch({ type: 'harmonic', enabled: !s().bmode.harmonic }),
      () => s().bmode.harmonic,
    ),
  );
  note(sec, 'TGC · superficial → profundo');
  const bank = document.createElement('div');
  bank.className = 'tgc';
  // cada banda con su número debajo (`<label for>`); el nombre accesible dice cuál es y a qué profundidad
  for (let i = 0; i < 8; i++) {
    const band = document.createElement('div');
    band.className = 'tgc-band';
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.id = controlId(`tgc-${i + 1}`);
    inp.min = '-15';
    inp.max = '15';
    inp.step = '1';
    inp.title = `TGC banda ${i + 1} (${i < 4 ? 'superficial' : 'profunda'})`;
    inp.setAttribute('aria-label', inp.title);
    inp.addEventListener('input', () => ctx.dispatch({ type: 'tgc', band: i, db: Number(inp.value) }));
    const l = document.createElement('label');
    l.htmlFor = inp.id;
    l.textContent = String(i + 1);
    band.append(inp, l);
    bank.appendChild(band);
    ctx.track({ sync: () => (inp.value = String(s().bmode.tgcDb[i])) });
  }
  sec.appendChild(bank);
}
