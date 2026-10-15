import { describe, expect, it } from 'vitest';
import { specializeAbdominalShader, specializeSceneShaders } from './sceneShader';
import { FRAG_QUERY, FRAG_TRANS_HITS, FRAG_BLIT } from './shaders/passes.glsl';

describe('immutable anatomy compilation', () => {
  for (const enabled of [false, true])
    it(`all anatomy passes select the same model (${enabled})`, () => {
      const selected = specializeSceneShaders({ query: FRAG_QUERY, transmission: FRAG_TRANS_HITS, blit: FRAG_BLIT }, enabled);
      for (const fragment of [selected.query, selected.transmission]) {
        expect(fragment).not.toMatch(/uniform\s+int\s+uAbdominalAtlasEnabled\s*;/);
        expect(fragment).toContain(`const int uAbdominalAtlasEnabled=${enabled ? 1 : 0};`);
        expect(fragment.startsWith('#version 300 es')).toBe(true);
        expect(fragment).toContain('sampler3D uAbdominalAtlas');
      }
      expect(selected.blit).toBe(FRAG_BLIT);
      expect(specializeAbdominalShader(selected.query, enabled)).toBe(selected.query);
    });
});
