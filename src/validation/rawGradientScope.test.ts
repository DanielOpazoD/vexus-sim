import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as PASSES from '../ultrasound/shaders/passes.glsl';

// Generated from clean d3bdfceca20f61bfc7a57068170a9e429430bf19 before decision 240.
// This fixes the scope of the edit, not GPU equivalence or performance.
const ORIGINAL_GRADIENTS = {
  FRAG_RAWFIELD_GRADIENT: '1686bf7f17acfb3c9d40b1b199f9878a73edc655e77556eb39720f1893d44220',
  FRAG_RAWFIELD_GRADIENT_STEERED: '2713cae97b7dd6968ea5a701b9f5cd42b9998341be985d81bc80fd3e9f36c951',
} as const;
const ORIGINAL_BODY = `

    oGradient = faceGradient(rawClass(), toMaterial(p));
    spec = 0.0;
    return vec2(0.0);`;
const GUARDED_BODY = `
    Cls c = rawClass();
    bool split = c.iface == IF_VERTEBRAL_CORTEX || c.tissue == T_CAPSULE ||
      (c.tissue == T_DIAPHRAGM && c.iface != IF_PERIRENAL &&
       c.iface != IF_RENAL_FASCIA && c.iface != IF_RENAL_CAPSULE);
    oGradient = vec4(0.0);
    spec = 0.0;
    if (uGradientAxis != 0 && !split) return vec2(0.0);
    oGradient = faceGradient(c, toMaterial(p));
    return vec2(0.0);
`;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const compact = (value: string): string =>
  value
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('alcance del guard de gradiente por tile (240)', () => {
  for (const [name, originalHash] of Object.entries(ORIGINAL_GRADIENTS))
    it(`${name}: solo cambia el cuerpo de medio y conserva la prioridad de las ramas`, () => {
      let restored = PASSES[name as keyof typeof ORIGINAL_GRADIENTS];
      const signatures = ['vec2 mediumField(vec3 p, vec3 dir, float r, float se, bool withCurtain, out float spec) {'];
      // The steered generator also inserts the same body in its phase-aware function.
      if (name.endsWith('_STEERED'))
        signatures.push('vec2 mediumFieldPh(vec3 p, vec3 dir, float r, float se, bool withCurtain, float ph0, vec3 g, out float spec) {');
      for (const signature of signatures) {
        expect(restored.split(signature)).toHaveLength(2);
        const start = restored.indexOf(signature) + signature.length;
        const end = restored.indexOf('\n}', start);
        expect(end).toBeGreaterThan(start);
        expect(compact(restored.slice(start, end))).toBe(compact(GUARDED_BODY));
        restored = restored.slice(0, start) + ORIGINAL_BODY + restored.slice(end);
      }
      // Restoring only those bodies reconstructs the original complete shader byte for byte:
      // geometry, main, faceGradient, marker/fallback and all numerical operations outside it.
      expect(sha256(restored)).toBe(originalHash);
    });

  it('conserva los trece programas de campo, clasificación, elevación, eco y consulta', () => {
    const retained = Object.entries(PASSES)
      .filter(([name]) => name.startsWith('FRAG_RAWFIELD') || ['FRAG_QUERY', 'FRAG_QUERY_CLASS', 'FRAG_QUERY_GRADIENT'].includes(name))
      .filter(([name]) => !name.startsWith('FRAG_RAWFIELD_GRADIENT'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(retained).toHaveLength(13);
    expect(sha256(JSON.stringify(retained))).toBe('44eba2a7438d143b86347f8e3e290b9ebf81019bde84bf390a38920b00a03eb7');
  });
});
