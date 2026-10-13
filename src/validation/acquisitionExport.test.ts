import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { exportAcquiredFrame } from '../../tools/fidelity/registeredAcquisition';
import { acquisitionJson } from '../../tools/fidelity/acquisitionJson';
import { CONVEX_C35 } from '../probe/probe';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('el sidecar distingue un transductor plano y su hash conserva esa procedencia', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vexus-acquisition-'));
  dirs.push(dir);
  for (const radius of [60, Infinity]) {
    const prefix = join(dir, String(radius));
    const page = {
      evaluate: () =>
        Promise.resolve({
          schemaVersion: 2,
          sequence: null,
          sequenceLoopFrames: 0,
          errors: [],
          frame: { n: 3, t: 2, anatomy: { transducer: { ...CONVEX_C35, curvatureRadius: radius } } },
          image: { width: 1, height: 1, grayBase64: Buffer.from([128]).toString('base64') },
        }),
    } as unknown as Page;
    const result = await exportAcquiredFrame(page, prefix, 'a'.repeat(40));
    const json = readFileSync(prefix + '.json', 'utf8');
    const metadata: unknown = JSON.parse(json);
    expect(metadata).toMatchObject({ frame: { anatomy: { transducer: { curvatureRadius: radius === Infinity ? 'planar' : radius } } } });
    expect(result.metadataSha256).toBe(createHash('sha256').update(json).digest('hex'));
  }
});

it('el JSON del auditor conserva ambos perfiles planos y rechaza otros números no finitos', () => {
  const result: unknown = JSON.parse(
    acquisitionJson({ transducer: { curvatureRadius: Infinity }, liveTransducer: { curvatureRadius: Infinity } }),
  );
  expect(result).toMatchObject({
    transducer: { curvatureRadius: 'planar' },
    liveTransducer: { curvatureRadius: 'planar' },
    numberEncoding: 'finite-numbers-or-planar-curvature-v1',
  });
  for (const value of [NaN, -Infinity]) expect(() => acquisitionJson({ curvatureRadius: value })).toThrow('Non-finite');
  expect(() => acquisitionJson({ seed: Infinity })).toThrow('Non-finite');
});
