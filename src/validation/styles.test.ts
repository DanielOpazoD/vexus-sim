import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
