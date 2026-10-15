import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { exportAcquiredFrame } from '../../tools/fidelity/registeredAcquisition';
import { acquisitionJson } from '../../tools/fidelity/acquisitionJson';
import { CONVEX_C35 } from '../probe/probe';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { probeContact } from '../probe/contact';

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
    numberEncoding: 'finite-numbers-or-acquisition-sentinels-v2',
  });
  for (const value of [NaN, -Infinity]) expect(() => acquisitionJson({ curvatureRadius: value })).toThrow('Non-finite');
  expect(() => acquisitionJson({ seed: Infinity })).toThrow('Non-finite');
});

it('exporta el contacto real de la ventana portal legacy sin convertir la ausencia de apoyo en null', () => {
  const torso = new AnatomyScene(NORMAL_ADULT).torso;
  const pose = { phi: 3.5, z: -90, lift: 0, yaw: 0.7, rock: 0.2, tilt: -0.4 };
  const contact = probeContact(pose, CONVEX_C35, torso);
  expect(contact.summary.neededMm).toBe(Infinity);
  const result: unknown = JSON.parse(acquisitionJson({ compression: contact, frame: { anatomy: { compression: contact } } }));
  expect(result).toMatchObject({
    compression: { summary: { neededMm: 'unreachable' } },
    frame: { anatomy: { compression: { summary: { neededMm: 'unreachable' } } } },
  });
  expect(contact.summary.neededMm).toBe(Infinity);
});

it('distingue los rayos sin intersección y el radio plano de compresión, sin aceptar otros NaN o infinitos', () => {
  const compression = { radiusMm: Infinity, summary: { neededMm: Infinity, skinAlongMm: [NaN, 2], wallAlongMm: [Infinity, 4] } };
  const result: unknown = JSON.parse(acquisitionJson({ compression }));
  expect(result).toMatchObject({
    compression: {
      radiusMm: 'planar',
      summary: { neededMm: 'unreachable', skinAlongMm: ['no-skin-intersection', 2], wallAlongMm: ['no-wall-intersection', 4] },
    },
  });
  for (const value of [NaN, -Infinity]) {
    expect(() => acquisitionJson({ compression: { summary: { neededMm: value } } })).toThrow('Non-finite');
  }
  expect(() => acquisitionJson({ compression: { summary: { skinAlongMm: [Infinity] } } })).toThrow('Non-finite');
  expect(() => acquisitionJson({ compression: { summary: { wallAlongMm: [NaN] } } })).toThrow('Non-finite');
  expect(() => acquisitionJson({ unrelated: { summary: { neededMm: Infinity } } })).toThrow('Non-finite');
});

it('rechaza claves con puntos y objetos que imitan las rutas de los centinelas', () => {
  for (const value of [
    { 'compression.summary': { neededMm: Infinity } },
    { compression: { 'summary.neededMm': Infinity } },
    { compression: { summary: { skinAlongMm: { 0: NaN } } } },
    { compression: { summary: { wallAlongMm: { 0: Infinity } } } },
  ])
    expect(() => acquisitionJson(value)).toThrow('Non-finite');
});
