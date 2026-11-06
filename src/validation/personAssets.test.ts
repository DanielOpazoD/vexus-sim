import { expect, it } from 'vitest';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import { installS0028Cpu } from '../anatomy/people/s0028/cpu';
import { installPersonAssets, type PersonAssetDescriptor } from '../anatomy/personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../anatomy/personAtlas';

function descriptor(): PersonAssetDescriptor {
  return {
    identity: { person: 'current', frameId: 'synthetic', revision: 'one', manifestSha256: 'a'.repeat(64), schemaVersion: 1 },
    abdominal: { textureDimensions: [2, 2, 2], rawBytes: 32, sha256Raw: 'b'.repeat(64) },
    fields: [{ originMm: [0, 0, 0], dimensions: [2, 2, 2], offset: [0, 0, 0], pitchMm: 1 }],
  };
}
it('prepara el layout CPU una vez: las consultas no releen los arrays congelados del descriptor público', () => {
  let reads = 0;
  const observed = (values: number[]) => {
    const array = [...values];
    values.forEach((value, i) => {
      Object.defineProperty(array, i, {
        get: () => {
          reads++;
          return value;
        },
        enumerable: true,
        configurable: true,
      });
    });
    return array;
  };
  const layout = descriptor();
  const field = {
    originMm: observed([0, 0, 0]),
    dimensions: observed([2, 2, 2]),
    offset: observed([0, 0, 0]),
    pitchMm: 1,
  };
  const data = new Uint16Array(16);
  for (let i = 0; i < 16; i += 2) {
    data[i] = 0x3c00;
    data[i + 1] = 0x4000;
  }
  const assets = installPersonAssets(
    { ...layout, fields: [field], thoracic: layout.abdominal, thoracicField: field },
    { abdominal: data, thoracic: data },
  );
  const abdominal = createAbdominalQueries(assets),
    thoracic = createThoracicQueries(assets);
  reads = 0;
  for (let i = 0; i < 10; i++) {
    const p: [number, number, number] = [0.4 + i / 100, 0.5, 0.6];
    expect(abdominal.abdominalAtlasValue(p, 0)).toEqual({ d: 1, label: 2 });
    expect(abdominal.abdominalAtlasGradient(p, 0)).toEqual([0, 0, 0]);
    expect(thoracic.thoracicValue(p)).toEqual({ d: 1, label: 2 });
    expect(thoracic.thoracicGradient(p)).toEqual([0, 0, 0]);
  }
  expect(reads).toBe(0);
  expect(Object.isFrozen(assets.descriptor.fields[0]!.originMm)).toBe(true);
  expect(assets.buffers.abdominal).toBe(data);
  expect(assets.buffers.thoracic).toBe(data);
});
it('dos contextos no se mezclan; congelar estructuras no congela ni copia sus buffers', () => {
  const one = new Uint16Array(16),
    two = new Uint16Array(16);
  for (let i = 0; i < 16; i += 2) {
    one[i] = 0x3c00;
    two[i] = 0x4000;
  }
  const a = installPersonAssets(descriptor(), { abdominal: one }),
    b = installPersonAssets(descriptor(), { abdominal: two });
  const qa = createAbdominalQueries(a),
    qb = createAbdominalQueries(b);
  expect([qa.abdominalAtlasSdf([0.5, 0.5, 0.5], 0), qb.abdominalAtlasSdf([0.5, 0.5, 0.5], 0)]).toEqual([1, 2]);
  expect(a.buffers.abdominal).toBe(one);
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.descriptor.fields[0])).toBe(true);
  expect(Object.isFrozen(one)).toBe(false);
  expect(() => installPersonAssets(descriptor(), { abdominal: new Uint16Array(15) })).toThrow();
  expect(qa.abdominalAtlasSdf([0.5, 0.5, 0.5], 0)).toBe(1);
  const copied = structuredClone(a.buffers);
  expect(copied.abdominal).not.toBe(one);
  expect(copied.abdominal).toEqual(one);
  expect(one.byteLength).toBe(32);
});
it('instaladores de página/Worker rechazan un paquete parcial y una identidad distinta cambia la clave', () => {
  expect(() => installDefaultCpu({})).toThrow();
  expect(() => installS0028Cpu({})).toThrow();
  const bad = { ...descriptor(), abdominal: { ...descriptor().abdominal!, textureDimensions: [-2, -2, 2] as const } };
  expect(() => installPersonAssets(bad, { abdominal: new Uint16Array(16) })).toThrow('Activo abdominal incompatible');
  const a = descriptor(),
    b = { ...descriptor(), identity: { ...descriptor().identity, manifestSha256: 'c'.repeat(64) } };
  expect(installPersonAssets(a, { abdominal: new Uint16Array(16) }).assetKey).not.toBe(
    installPersonAssets(b, { abdominal: new Uint16Array(16) }).assetKey,
  );
});
