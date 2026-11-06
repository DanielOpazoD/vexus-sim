import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import type { InstalledCpuPerson } from '../anatomy/person';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import type { CutMapInit, CutMapReply, CutMapRequest } from '../ui/cutMapProtocol';
import type { createCutMapWorker } from '../ui/cutMapWorker';

let createWorker: typeof createCutMapWorker;
beforeAll(async () => {
  vi.stubGlobal('self', {});
  createWorker = (await import('../ui/cutMapWorker')).createCutMapWorker;
});
afterAll(() => vi.unstubAllGlobals());
// La carga de la máquina no decide si una fila emite progreso: se prueban ambos recorridos.
beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
});
afterEach(() => vi.restoreAllMocks());
const person = installDefaultCpu({}, true);
const scene = new AnatomyScene(NORMAL_ADULT, undefined, person);
const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
const init = (epoch: number): CutMapInit => ({
  type: 'init',
  id: epoch * 10,
  epoch,
  assetKey: person.assetKey,
  identity: person.identity,
  patient: NORMAL_ADULT,
  buffers: {},
});
const map = (epoch: number, id: number): CutMapRequest => ({
  type: 'map',
  epoch,
  assetKey: person.assetKey,
  id,
  frame: probeFrame({ phi: Math.PI / 2, z: -90, lift: 0, yaw: 0, tilt: 0, rock: 0 }, scene.torso, CONVEX_C35),
  transducer: CONVEX_C35,
  compression: null,
  depthMm: 80,
  sample,
  width: 2,
  height: 2,
});
function deferred() {
  let resolve!: (person: InstalledCpuPerson) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<InstalledCpuPerson>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('instala CPU una vez por assetKey y reutiliza el contexto entre cortes y casos', async () => {
  const posted: CutMapReply[] = [];
  const install = vi.fn(() => Promise.resolve(person));
  const receive = createWorker((m) => posted.push(m), install);
  await receive(init(1));
  for (const [i, patient] of [NORMAL_ADULT, SEVERE_CONGESTION, NORMAL_ADULT].entries()) {
    const epoch = i + 1;
    if (i) await receive({ ...init(epoch), type: 'patient', patient, buffers: undefined });
    await receive(map(epoch, epoch * 10 + 1));
    await receive(map(epoch, epoch * 10 + 2));
  }
  expect(install).toHaveBeenCalledExactlyOnceWith(init(1));
  expect(posted.filter((m) => m.type === 'map')).toHaveLength(6);
  expect(posted.filter((m) => m.type === 'ready').map((m) => m.epoch)).toEqual([1, 2, 3]);
  expect(posted.some((m) => m.type === 'error')).toBe(false);
});

it.each([false, true])('espera CPU, publica ready y conserva sólo el mapa pendiente más reciente (progreso=%s)', async (progress) => {
  let now = 0;
  if (progress) vi.spyOn(performance, 'now').mockImplementation(() => (now += 17));
  const loading = deferred(),
    posted: CutMapReply[] = [];
  const receive = createWorker(
    (m) => posted.push(m),
    () => loading.promise,
  );
  const installing = receive(init(1));
  await receive(map(1, 11));
  await receive(map(1, 12));
  expect(posted).toEqual([]);
  loading.resolve(person);
  await installing;
  expect(posted.map((m) => [m.type, m.id, m.epoch, m.assetKey])).toEqual([
    ['ready', 10, 1, person.assetKey],
    ...(progress ? [['progress', 12, 1, person.assetKey]] : []),
    ['map', 12, 1, person.assetKey],
  ]);
  if (progress) expect(posted[1]).toEqual({ type: 'progress', id: 12, epoch: 1, assetKey: person.assetKey, rows: 1 });
});

it.each(['resolve', 'reject'] as const)(
  'un import antiguo que termina con %s no publica ni borra el contexto nuevo',
  async (completion) => {
    const old = deferred(),
      fresh = deferred(),
      posted: CutMapReply[] = [];
    const receive = createWorker(
      (m) => posted.push(m),
      (m) => (m.epoch === 1 ? old.promise : fresh.promise),
    );
    const one = receive(init(1)),
      two = receive(init(2));
    fresh.resolve(person);
    await two;
    if (completion === 'resolve') old.resolve(person);
    else old.reject(new Error('old import failed'));
    await one;
    await receive(map(1, 13));
    await receive(map(2, 23));
    expect(posted.map((m) => [m.type, m.epoch])).toEqual([
      ['ready', 2],
      ['map', 2],
    ]);
  },
);

it('fallo de chunk y cambio de identidad fallan de forma visible sin mapa anterior', async () => {
  const posted: CutMapReply[] = [];
  const install = vi.fn(() => Promise.resolve(person));
  const receive = createWorker((m) => posted.push(m), install);
  await receive(init(1));
  await receive({ ...init(2), type: 'patient', identity: { ...person.identity, manifestSha256: 'foreign' } });
  await receive(map(2, 23));
  expect(posted.map((m) => m.type)).toEqual(['ready', 'error', 'error']);
  expect(install).toHaveBeenCalledOnce();
  install.mockRejectedValueOnce(new Error('chunk HTTP 404'));
  await receive(init(3));
  expect(posted.at(-1)).toMatchObject({ type: 'error', epoch: 3, message: 'chunk HTTP 404' });
  expect(posted.filter((m) => m.type === 'map')).toHaveLength(0);
});
