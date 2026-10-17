import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { START_POINTS } from '../app/startPoints';
import { WINDOW_GROUPS } from '../app/windowGroups';

/**
 * Invariantes de la disposición (rejilla de tres columnas) que un e2e con
 * SwiftShader no puede medir con fiabilidad: al ocultar el torso, el carril
 * debe seguir ocupando su columna (0 px) o el centro y la consola se corren.
 */
const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');
const rule = (selector: string): string => {
  const m = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`regla ${selector} no encontrada`);
  return m[2];
};

describe('Disposición: rejilla de tres columnas', () => {
  it('cada columna tiene su posición explícita en la rejilla', () => {
    expect(rule('.left')).toMatch(/grid-column:\s*1;/);
    expect(rule('.center')).toMatch(/grid-column:\s*2;/);
    expect(rule('.right')).toMatch(/grid-column:\s*3;/);
  });

  it('ocultar el torso no saca el carril de la rejilla (display:none corría el centro y la consola)', () => {
    const hidden = rule('.app.no-torso .left');
    expect(hidden).not.toMatch(/display:\s*none/);
    expect(hidden).toMatch(/visibility:\s*hidden/);
    expect(rule('.app.no-torso')).toMatch(/grid-template-columns:\s*0 /);
  });
});

/** Declaraciones de una regla dentro de una consulta de medios (sangradas dos espacios). */
function mediaRule(query: string, selector: string): string {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) throw new Error(`consulta ${query} no encontrada`);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = css.slice(start, end);
  const m = new RegExp(`\\n  ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(block);
  if (!m) throw new Error(`regla ${selector} no encontrada en ${query}`);
  return m[1];
}
/** Declaraciones de la regla de primer nivel cuyo selector es exactamente `selector` (no una lista que lo contiene). */
function ownRule(selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let head = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '{') {
      if (depth === 0 && flat.slice(head, i).trim().replace(/\s+/g, ' ') === selector) return flat.slice(i + 1, flat.indexOf('}', i));
      depth++;
    } else if (flat[i] === '}') {
      depth--;
      if (depth === 0) head = i + 1;
    }
  }
  throw new Error(`regla ${selector} no encontrada`);
}
/** Primer valor en px de una propiedad (0 sin unidad); en `padding`, el vertical. */
function px(decls: string, prop: string): number {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)(px)?[\\s;]`).exec(decls);
  if (!m) throw new Error(`${prop} no encontrado`);
  return Number(m[1]);
}

describe('Carril: las tarjetas de las ventanas (decisiones 75 y 83)', () => {
  it('los cuatro grupos y sus ocho accesos caben en el carril bajo sin reducir texto, foco ni área de pulsación', () => {
    expect(WINDOW_GROUPS).toHaveLength(4);
    expect(WINDOW_GROUPS.reduce((n, group) => n + group.windows.length, 0)).toBe(8);
    expect(ownRule('.win-options')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    const buttonHeight = px(ownRule('.win-card'), 'min-height');
    expect(buttonHeight).toBeGreaterThanOrEqual(32);
    expect(px(ownRule('.win-name'), 'font-size')).toBeGreaterThanOrEqual(12);
    expect(px(ownRule('.win-group-title'), 'font-size')).toBeGreaterThanOrEqual(12);
    // Cada grupo: título (14 px) + margen (2 px) + una fila de botones (32 px).
    const groupHeight = px(ownRule('.win-group-title'), 'line-height') + 2 + buttonHeight;
    const contentHeight = 4 * groupHeight + 3 * px(rule('.windows'), 'gap') + 8;
    expect(contentHeight).toBeLessThanOrEqual(px(mediaRule('(max-height: 860px)', '.windows'), 'max-height'));
    expect(rule('.windows')).toMatch(/overflow-y:\s*auto/);
    expect(px(rule('.windows'), 'max-height')).toBeLessThanOrEqual(290);
    expect(px(mediaRule('(max-height: 860px)', '.windows'), 'max-height')).toBeLessThanOrEqual(230);
    expect(ownRule('.win-card:focus-visible')).toMatch(/z-index:\s*[1-9]/);
    expect(ownRule('.win-card:focus-visible')).toMatch(/position:\s*relative/);
  });

  it('el texto de la tarjeta actual, sobre el tinte del color de su ventana, llega a 4,5:1 con todas las ventanas', () => {
    const root = ownRule(':root');
    const token = (name: string): string => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(root);
      if (!m) throw new Error(`--${name} no encontrado`);
      return m[1];
    };
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (c: number[]) =>
      c
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((l, v, i) => l + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // color-mix(in srgb, var(--win) N %, transparent) sobre el panel del carril
    const mix = /color-mix\(in srgb, var\(--win\) ([\d.]+)%, transparent\)/.exec(ownRule('.win-card.current'));
    expect(mix).not.toBeNull();
    const f = Number(mix![1]) / 100;
    const panel = rgb(token('panel'));
    const text = rgb(token('text'));
    expect(contrast(rgb(token('muted')), panel), 'títulos de territorio').toBeGreaterThanOrEqual(4.5);
    for (const sp of START_POINTS) {
      const bg = rgb(sp.color).map((c, i) => f * c + (1 - f) * panel[i]);
      expect(contrast(text, bg), `${sp.id}: nombre`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
