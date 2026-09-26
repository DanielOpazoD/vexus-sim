import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { minifyGlslBody, minifyGlslTemplates } from '../../tools/build/glslMinify';

/** Quita los comentarios GLSL de un texto sin interpolaciones (referencia sencilla, carácter a carácter). */
const tokens = (glsl: string): string[] =>
  glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

describe('Minificado del GLSL en el build (tools/build/glslMinify.ts)', () => {
  it('quita comentarios y sangría, conserva saltos de línea, directivas e interpolaciones', () => {
    const src = [
      'const X = 3;',
      'export const G = /* glsl */ `',
      '  // cabecera',
      '  #define N ${X}',
      '  float f(float a) { // en línea',
      '    return a * 2.0; /* bloque */',
      '  }',
      '`;',
    ].join('\n');
    const out = minifyGlslTemplates(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).toContain('\n#define N ${X}\n');
    expect(out).toContain('float f(float a) {\nreturn a * 2.0;\n}');
    expect(out).not.toMatch(/cabecera|en línea|bloque/);
    expect(out.startsWith('const X = 3;\nexport const G = /* glsl */ `')).toBe(true);
  });

  it('una interpolación dentro de un comentario desaparece con él (y la línea siguiente sigue siendo código)', () => {
    expect(minifyGlslBody(['\n  // radio ', ' mm\n  float r = ', ';\n'], ['R', 'R2'])).toBe('\n\nfloat r = ${R2};\n');
    expect(minifyGlslBody(['\n  /* a ', ' b */ x = ', ';\n'], ['A', 'B'])).toBe('\nx = ${B};\n');
  });

  it('un comentario de bloque entre dos tokens los separa como un espacio (GLSL: `a/* x */b` es `a b`)', () => {
    expect(minifyGlslBody(['float/* escala */gain = 1.0;'], [])).toBe('float gain = 1.0;');
    expect(minifyGlslBody(['x = a /* x */ + b;'], [])).toBe('x = a  + b;');
    // junto a una interpolación no se sabe qué hay: se separa por si acaso
    expect(minifyGlslBody(['float ', '/* x */name;'], ['T'])).toBe('float ${T} name;');
  });

  it('en los shaders reales el minificado conserva cada símbolo y cada interpolación', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    walk(fileURLToPath(new URL('..', import.meta.url)));
    let templates = 0;
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      if (!code.includes('/* glsl */')) continue;
      const out = minifyGlslTemplates(code);
      expect(out.split('\n').length, f).toBe(code.split('\n').length);
      // fuera de las plantillas nada cambia, y dentro los símbolos (sin comentarios) son los mismos
      const re = /\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g;
      const a = [...code.matchAll(re)].map((m) => m[1]);
      const b = [...out.matchAll(re)].map((m) => m[1]);
      expect(b.length, f).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        // sin interpolaciones dentro de comentarios en el fuente, los símbolos coinciden uno a uno
        if (/\/\/[^\n]*\$\{|\/\*[^*]*\$\{/.test(a[i])) continue;
        expect(tokens(b[i]), `${f} #${i}`).toEqual(tokens(a[i]));
        templates++;
      }
    }
    expect(templates).toBeGreaterThan(30);
  });
});
