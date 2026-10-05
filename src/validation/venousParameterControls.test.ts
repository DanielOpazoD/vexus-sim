import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorLog } from '../app/errorLog';
import { congestionParameters } from '../app/venousExperiment';
import { encodeVenousParameters } from '../app/venousParameterFile';
import { VenousExperimentControls } from '../ui/panel/venousExperimentControls';
import { fakeDocument, type FakeElement, findAll } from './support/fakeDom';

const report = vi.fn(() => ({ source: 'ui' as const, message: 'expected import error', firstAt: 0, lastAt: 0, count: 1 }));
beforeEach(() => {
  report.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('document', fakeDocument());
  vi.spyOn(errorLog, 'report').mockImplementation(report);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const changed = vi.fn();
  const controls = new VenousExperimentControls(changed);
  const root = controls.element as unknown as FakeElement;
  const input = findAll(root, (e) => e.type === 'file')[0];
  const select = (text: () => Promise<string>, size = 100) => {
    Object.assign(input, { files: [{ size, text }] });
    input.dispatch('change');
  };
  return { changed, controls, root, select };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe('importación de parámetros aislada y sin carreras', () => {
  it('exporta los parámetros y libera la URL sin activar otro escenario', async () => {
    const s = setup();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:venous-test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    findAll(s.root, (e) => e.tagName === 'BUTTON' && e.textContent === 'Guardar parámetros')[0].click();
    const blob = create.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(encodeVenousParameters(congestionParameters(0)));
    expect(s.changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:venous-test');
  });
  it('activa el experimento validado y muestra los controles importados', async () => {
    const s = setup();
    const p = { ...congestionParameters(0.4), heartRateBpm: 50, venousReservoirCompliance: 0.5 };
    s.select(() => Promise.resolve(encodeVenousParameters(p)));
    await settle();
    expect(s.changed).toHaveBeenLastCalledWith(p);
    expect(findAll(s.root, (e) => e.type === 'checkbox')[0].checked).toBe(true);
    expect(findAll(s.root, (e) => e.getAttribute('aria-label') === 'Frecuencia cardíaca sinusal')[0].value).toBe('50');
    expect(s.root.textContent).toContain('no guarda señales');
  });
  it('un archivo inválido o grande no sustituye el estado y deja error visible', async () => {
    const s = setup();
    const before = findAll(s.root, (e) => e.type === 'range').map((e) => e.value);
    s.select(() => Promise.resolve('{}'));
    await settle();
    expect(s.changed).not.toHaveBeenCalled();
    expect(s.controls.status.textContent).toContain('No se importó');
    const read = vi.fn(() => Promise.resolve(''));
    s.select(read, 8193);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(s.controls.status.textContent).toContain('8 KiB');
    expect(findAll(s.root, (e) => e.type === 'range').map((e) => e.value)).toEqual(before);
    expect(report).toHaveBeenCalledWith('ui', expect.any(Error));
  });
  it('cerrar o reiniciar impide que una lectura tardía reactive el experimento', async () => {
    const s = setup();
    let resolve!: (text: string) => void;
    s.select(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    s.controls.reset();
    resolve(encodeVenousParameters(congestionParameters(1)));
    await settle();
    expect(s.changed).not.toHaveBeenCalled();
    expect(findAll(s.root, (e) => e.type === 'checkbox')[0].checked).toBe(false);
  });
  it('un segundo archivo o un ajuste del usuario invalida la lectura anterior', async () => {
    const s = setup();
    let resolve!: (text: string) => void;
    s.select(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    s.select(() => Promise.resolve(encodeVenousParameters(congestionParameters(0.4))));
    await settle();
    resolve(encodeVenousParameters(congestionParameters(1)));
    await settle();
    expect(s.changed).toHaveBeenCalledTimes(1);
    expect(s.changed).toHaveBeenLastCalledWith(congestionParameters(0.4));
    s.select(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const input = findAll(s.root, (e) => e.getAttribute('aria-label') === 'Frecuencia cardíaca sinusal')[0];
    input.value = '50';
    input.dispatch('input');
    resolve(encodeVenousParameters(congestionParameters(1)));
    await settle();
    vi.advanceTimersByTime(150);
    expect(s.changed).toHaveBeenLastCalledWith({ ...congestionParameters(0.4), heartRateBpm: 50 });
  });
});
