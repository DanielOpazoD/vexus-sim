import { describe, expect, it } from 'vitest';
import { findCase } from '../cases';
import { AnatomyScene } from '../anatomy/scene';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35, lineAngle } from '../probe/probe';
import { ecgT, ecgX, traceRight } from '../ui/sweep';
import { CINE_FRAMES, CINE_RATE_HZ, CineRing, persistenceReplay } from '../ultrasound/cine';
import { M_MAX_GAP_S, MColumnRing, mLineU } from '../ultrasound/mmode';
import { collapsibilityIndex, ivcFromCalipers, ivcTruth } from '../vexus/ivcCollapse';

/**
 * Cine y modo M (decisión 80): la lógica pura que la e2e no puede recorrer caso a caso — el anillo del cine y su
 * cadencia de guardado, cuántos cuadros repite la persistencia, el eje de las franjas con el cursor, la columna de
 * la línea M, la franja del modo M y la colapsabilidad de la VCI con su verdad.
 */
describe('Cine: anillo de cuadros', () => {
  it('guarda en orden y, lleno, sobrescribe el más viejo; la ranura de cada cuadro es la de su capa', () => {
    const ring = new CineRing<number>(4, 1000);
    const slots = [0, 1, 2, 3, 4, 5].map((k) => ring.push(k, k));
    expect(slots).toEqual([0, 1, 2, 3, 0, 1]);
    expect(ring.count).toBe(4);
    // el 0 es el más viejo que queda (el 2) y el último, el 5; sus ranuras son aquellas donde se escribieron
    expect([0, 1, 2, 3].map((i) => ring.at(i))).toEqual([2, 3, 4, 5]);
    expect([0, 1, 2, 3].map((i) => ring.slot(i))).toEqual([2, 3, 0, 1]);
    expect(() => ring.at(4)).toThrow(RangeError);
    expect(() => ring.at(-1)).toThrow(RangeError);
    expect(() => ring.at(0.5)).toThrow(RangeError);
    ring.clear();
    expect(ring.count).toBe(0);
    expect(() => ring.at(0)).toThrow(RangeError);
    expect(ring.push(10, 10)).toBe(0);
  });

  it('el instante del cuadro mostrado es el de su cuadro, también tras dar la vuelta al anillo', () => {
    const ring = new CineRing<{ t: number }>(CINE_FRAMES);
    for (let k = 0; k < 3 * CINE_FRAMES + 7; k++) {
      const t = k / CINE_RATE_HZ;
      if (ring.due(t)) ring.push(t, { t });
    }
    const n = ring.count;
    expect(n).toBe(CINE_FRAMES);
    for (let i = 1; i < n; i++) expect(ring.at(i).t - ring.at(i - 1).t).toBeCloseTo(1 / CINE_RATE_HZ, 9);
    expect(ring.at(n - 1).t).toBeCloseTo((3 * CINE_FRAMES + 6) / CINE_RATE_HZ, 9);
    // 120 cuadros a 20 Hz: los últimos 6 s (el pedido del dueño: «~6 s»)
    expect(ring.at(n - 1).t - ring.at(0).t).toBeCloseTo((CINE_FRAMES - 1) / CINE_RATE_HZ, 9);
  });

  it('guarda como mucho 20 cuadros por segundo de simulación, todos si llegan menos y uno por instante', () => {
    const stored = (hz: number, seconds: number, jitter = 0) => {
      const ring = new CineRing<number>(10_000);
      let seed = 7;
      for (let t = 0; t < seconds;) {
        if (ring.due(t)) ring.push(t, t);
        seed = (seed * 16807) % 2147483647;
        t += (1 / hz) * (1 + jitter * (seed / 2147483647 - 0.5));
      }
      return ring.count / seconds;
    };
    expect(stored(60, 30)).toBeCloseTo(CINE_RATE_HZ, 0);
    expect(stored(120, 30)).toBeCloseTo(CINE_RATE_HZ, 0);
    expect(stored(60, 30, 0.8)).toBeCloseTo(CINE_RATE_HZ, 0);
    // entre 20 y 40 Hz (el color con una caja pequeña) nunca más de 20, pero no uno de cada dos (12,5 a 25 Hz): el
    // anillo cubre 6–7,5 s
    for (const hz of [21, 25, 30, 39]) {
      expect(stored(hz, 30)).toBeLessThanOrEqual(CINE_RATE_HZ + 0.05);
      expect(stored(hz, 30)).toBeGreaterThanOrEqual(16);
    }
    // por debajo de la cadencia (color lento, SwiftShader a 4 Hz) se guardan todos
    expect(stored(8, 30)).toBeCloseTo(8, 1);
    expect(stored(4, 30)).toBeCloseTo(4, 1);
    // el reloj quieto (varios cuadros en el mismo instante) guarda uno
    const ring = new CineRing<number>(10);
    for (let k = 0; k < 5; k++) if (ring.due(1)) ring.push(1, k);
    expect(ring.count).toBe(1);
    // tras una pausa larga no hay ráfaga: el siguiente cuadro vence medio periodo después del guardado
    ring.push(100, 0);
    expect(ring.due(100 + 0.4 / CINE_RATE_HZ)).toBe(false);
    expect(ring.due(100 + 0.5 / CINE_RATE_HZ)).toBe(true);
  });

  it('la persistencia repite los cuadros que aún pesan medio nivel de gris', () => {
    expect(persistenceReplay(0)).toBe(0);
    expect(persistenceReplay(Number.NaN)).toBe(0);
    for (const p of [0.1, 0.35, 0.5, 0.8]) {
      const k = persistenceReplay(p);
      // el cuadro k+1 atrás pesa menos de medio nivel; el k, todavía no
      expect(p ** k * 255).toBeLessThan(0.5);
      expect(p ** (k - 1) * 255).toBeGreaterThanOrEqual(0.5);
    }
    expect(persistenceReplay(0.35)).toBe(6);
    expect(persistenceReplay(0.8)).toBe(28);
    expect(persistenceReplay(1)).toBeLessThan(CINE_FRAMES);
  });
});

describe('Cine: franjas y cursor', () => {
  it('en vivo el borde derecho es el ahora; con un cuadro viejo las franjas lo siguen y el cursor queda a la vista', () => {
    const sv = 5;
    const W = 1000;
    expect(traceRight(20, null, sv)).toBe(20);
    // un cuadro reciente: no se desplaza
    expect(traceRight(20, 19, sv)).toBe(20);
    for (const cursor of [19, 16, 15.4, 14, 12]) {
      const right = traceRight(20, cursor, sv);
      const x = ecgX(cursor, right, sv, W);
      expect(right).toBeLessThanOrEqual(20);
      expect(x).toBeGreaterThanOrEqual(0.1 * W - 1e-9);
      expect(x).toBeLessThanOrEqual(W);
    }
    // x → t → x
    for (const x of [0, 137.5, 999]) expect(ecgX(ecgT(x, 20, sv, W), 20, sv, W)).toBeCloseTo(x, 9);
  });
});

describe('Modo M: línea y columna', () => {
  it('la línea M cae en la coordenada u de la conversión de barrido', () => {
    const tr = CONVEX_C35;
    expect(mLineU(-tr.halfSector, tr.halfSector)).toBe(0);
    expect(mLineU(tr.halfSector, tr.halfSector)).toBe(1);
    expect(mLineU(0, tr.halfSector)).toBe(0.5);
    for (const i of [0, 17, 96, 191]) expect(mLineU(lineAngle(i, tr), tr.halfSector)).toBeCloseTo(i / (tr.lines - 1), 12);
  });

  it('el anillo de columnas guarda en orden, reescribe la del mismo instante y empieza otra franja con otra profundidad', () => {
    const ring = new MColumnRing(4);
    const slots = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => ring.push(t, 180));
    expect(slots).toEqual([0, 1, 2, 3, 0, 1]);
    expect(ring.count).toBe(4);
    expect([0, 1, 2, 3].map((i) => ring.time(i))).toEqual([1, 1.5, 2, 2.5]);
    // el reloj quieto reescribe la última columna (la misma ranura)
    const v = ring.version;
    expect(ring.push(2.5, 180)).toBe(1);
    expect(ring.count).toBe(4);
    expect(ring.version).toBe(v + 1);
    // otra profundidad o un reloj que vuelve atrás: franja nueva
    ring.push(3, 140);
    expect([ring.count, ring.depthMm]).toEqual([1, 140]);
    ring.push(1, 140);
    expect([ring.count, ring.time(0)]).toEqual([1, 1]);
    ring.clear();
    expect(ring.count).toBe(0);
  });

  it('cada píxel de la franja toma la columna que cubre su instante (t de la anterior, t]; sin columna, −1', () => {
    const ring = new MColumnRing(8);
    // columnas cada 0,25 s de t = 1 a 2,75 (irregular en la última)
    for (const t of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.7]) ring.push(t, 180);
    const W = 10;
    const sv = 2.5;
    const tRight = 3;
    const px = ring.pixelSlots(tRight, sv, W);
    for (let x = 0; x < W; x++) {
      const t = tRight - sv + ((x + 0.5) / W) * sv;
      const i = [...Array(ring.count).keys()].find((k) => ring.time(k) >= t);
      // antes de la primera columna y después de la última no hay dato
      if (i === undefined || i === 0) expect(px[x], `x ${x}`).toBe(-1);
      else {
        expect(px[x], `x ${x}`).toBe(ring.slot(i));
        expect(ring.time(i - 1)).toBeLessThan(t);
      }
    }
    // el anillo dio la vuelta (8 ranuras): los centros de los píxeles, 2,625 · 2,875 · 3,125 · 3,375 s, caen en las
    // columnas de 2,7, 3, 3,25 y 3,5 s, en las ranuras 7, 0, 1 y 2
    for (const t of [3, 3.25, 3.5]) ring.push(t, 180);
    expect(Array.from(ring.pixelSlots(3.5, 1, 4))).toEqual([7, 0, 1, 2]);
  });

  it('un hueco de más de M_MAX_GAP_S (el reloj avanzado sin columnas) queda en negro, no con la columna siguiente', () => {
    const ring = new MColumnRing(64);
    for (let t = 1; t <= 2 + 1e-9; t += 0.1) ring.push(+t.toFixed(1), 180);
    // 3 s sin modo M y otra vez la línea M: la primera columna nueva no rellena el hueco
    for (const t of [5, 5.1, 5.2]) ring.push(t, 180);
    const W = 50;
    const px = ring.pixelSlots(5.5, 5, W);
    for (let x = 0; x < W; x++) {
      const t = 0.5 + ((x + 0.5) / W) * 5;
      if (t > 2 && t < 5) expect(px[x], `t ${t.toFixed(2)}`).toBe(-1);
      if (t > 1.05 && t <= 2) expect(px[x], `t ${t.toFixed(2)}`).toBeGreaterThanOrEqual(0);
    }
    // el borde del hueco: la columna de 5 s solo cubre su propio instante
    expect(M_MAX_GAP_S).toBeGreaterThan(0.25);
  });
});

describe('Colapsabilidad de la VCI (modo M)', () => {
  it('índice (máx − mín)/máx con dos calibres en cualquier orden', () => {
    expect(collapsibilityIndex(20, 15)).toBeCloseTo(25, 12);
    expect(collapsibilityIndex(0, 0)).toBeNaN();
    expect(ivcFromCalipers(12, 18)).toEqual({ maxMm: 18, minMm: 12, ciPct: collapsibilityIndex(18, 12) });
    expect(ivcFromCalipers(18, 12)).toEqual(ivcFromCalipers(12, 18));
  });

  it('la verdad es el diámetro AP del motor en la ventana; sin muestras, null', () => {
    const s = (t: number, d: number) => ({ t, ivc: { dApMm: d, dLatMm: d, dEqMm: d } }) as unknown as PhysiologySample;
    const samples = [s(0, 10), s(1, 20), s(2, 15), s(3, 5)];
    expect(ivcTruth(samples, 0.5, 2.5)).toEqual({ maxMm: 20, minMm: 15, ciPct: 25 });
    expect(ivcTruth(samples, 4, 5)).toBeNull();
  });

  it('en el sano con respiración tranquila la verdad de una ventana de 6 s es la de la decisión 73 (latido incluido)', () => {
    const p = clonePatient(findCase('normal-adult'));
    const engine = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: 20 });
    for (let t = 0; t < 14; t += engine.clock.dt) engine.step();
    const truth = ivcTruth(engine.samples, 8, 14)!;
    // colapso respiratorio del 24 % más el latido de la pared (1,2 mm): 25–35 %
    expect(truth.ciPct).toBeGreaterThan(25);
    expect(truth.ciPct).toBeLessThan(35);
    expect(truth.maxMm).toBeGreaterThan(15);
  });
});
