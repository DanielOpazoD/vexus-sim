import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { HEPATIC_SPINE_GAP_MM } from '../anatomy/organs/liver';
import { sdSpine } from '../anatomy/primitives';
import { Interface } from '../anatomy/interfaces';
import { LIVER_CAPSULE_MM, Tissue } from '../anatomy/tissues';
import { setReferenceBody, validateReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { retroTexture, visceralFatLobules } from '../ultrasound/retroTexture';
import type { Vec3 } from '../core/vec3';
const b = readFileSync('src/anatomy/reference-body.bin');
const profile = validateReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));

describe('frontera hepática y plano retrohepático', () => {
  for (const reference of [false, true])
    it(`no invade el hueso; mantiene un plano blando y cápsula propia (${reference})`, () => {
      setReferenceBody(reference ? profile : undefined);
      let s: AnatomyScene;
      try {
        s = new AnatomyScene(NORMAL_ADULT);
      } finally {
        setReferenceBody();
      }
      let capsule = 0,
        cortex = 0;
      for (let z = -70; z <= 45; z += 5)
        for (let a = 0; a < Math.PI * 2; a += 0.12)
          for (const d of [0.1, 1, 2.9, 3.3, 3.7]) {
            const p: Vec3 = [s.spine.x0 + (s.spine.r + d) * Math.cos(a), s.spine.y0 + (s.spine.r + d) * Math.sin(a), z];
            if (sdSpine(p, s.spine) < HEPATIC_SPINE_GAP_MM) expect(s.liverSdf(p)).toBeGreaterThanOrEqual(0);
            const c = s.classify(p, BASELINE_CALIBER);
            if (c.interface === Interface.LiverCapsule) {
              capsule++;
              expect(sdSpine(p, s.spine)).toBeGreaterThanOrEqual(HEPATIC_SPINE_GAP_MM);
            }
            if (c.interface === Interface.VertebralCortex) {
              cortex++;
              expect(c.tissue).not.toBe(Tissue.LiverCapsule);
              expect(c.tissue).not.toBe(Tissue.Liver);
            }
          }
      expect(capsule).toBeGreaterThan(10);
      expect(cortex).toBeGreaterThan(10);
    });
  it.each([false, true])('el recorrido normal conserva hueso → grasa → cápsula → parénquima (referencia %s)', (reference) => {
    setReferenceBody(reference ? profile : undefined);
    let s: AnatomyScene;
    try {
      s = new AnatomyScene(NORMAL_ADULT);
    } finally {
      setReferenceBody();
    }
    // Los dos testigos históricos no se recolocan para obtener verde. En referencia solo se
    // traslada el eje AP con la columna; la elipse sitúa «before» dentro de la cápsula.
    const before: Vec3 = [-17.508805707, s.spine.y0 + 11.883203125, 15.268222628];
    const towardBone: Vec3 = [-15, s.spine.y0 + 12, 15.3];
    const anchor = s.classify(before, BASELINE_CALIBER);
    expect(anchor.tissue).toBe(Tissue.LiverCapsule);
    expect(anchor.interface).toBe(Interface.LiverCapsule);
    expect(sdSpine(before, s.spine)).toBeGreaterThan(HEPATIC_SPINE_GAP_MM);
    expect(-s.liverSdf(before)).toBeGreaterThan(0);
    expect(-s.liverSdf(before)).toBeLessThan(LIVER_CAPSULE_MM);
    const c = s.classify(towardBone, BASELINE_CALIBER);
    expect(c.tissue).toBe(Tissue.RetroperitonealFat);
    expect(c.interface).toBe(Interface.VertebralCortex);

    // Buscar la superficie ósea sobre la normal local, sin fijar un nuevo punto «hepático».
    // La derivada geométrica y la bisección no usan la clasificación ni la fórmula del recorte hepático.
    const h = 1e-3;
    const gradient = before.map((_, axis) => {
      const plus: Vec3 = [...before],
        minus: Vec3 = [...before];
      plus[axis] += h;
      minus[axis] -= h;
      return (sdSpine(plus, s.spine) - sdSpine(minus, s.spine)) / (2 * h);
    });
    const norm = Math.hypot(...gradient);
    const at = (t: number): Vec3 => before.map((v, axis) => v + (t * gradient[axis]) / norm) as Vec3;
    let lo = -6,
      hi = 0;
    expect(sdSpine(at(lo), s.spine)).toBeLessThan(0);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (sdSpine(at(mid), s.spine) < 0) lo = mid;
      else hi = mid;
    }
    const surface = (lo + hi) / 2;
    const runs: { tissue: Tissue; start: number; count: number }[] = [];
    for (let i = -5; i <= 60; i++) {
      const offset = i / 10;
      const p = at(surface + offset),
        dBone = sdSpine(p, s.spine);
      const q = s.classify(p, BASELINE_CALIBER);
      if (runs.at(-1)?.tissue !== q.tissue) runs.push({ tissue: q.tissue, start: offset, count: 0 });
      runs.at(-1)!.count++;
      if (q.tissue === Tissue.RetroperitonealFat) {
        expect(q.boundaryDistance).toBeLessThanOrEqual(dBone + 1e-9);
        expect(q.interface).toBe(Interface.VertebralCortex);
        expect(q.interfaceDistance).toBeCloseTo(dBone, 9);
      }
      if (q.tissue === Tissue.LiverCapsule) {
        expect(dBone).toBeGreaterThanOrEqual(HEPATIC_SPINE_GAP_MM);
        expect(q.interface).toBe(Interface.LiverCapsule);
        expect(q.interfaceDistance).toBeCloseTo(-s.liverSdf(p), 9);
        expect(q.interfaceDistance).toBeLessThan(LIVER_CAPSULE_MM);
      }
      if (q.tissue === Tissue.Liver) expect(-s.liverSdf(p)).toBeGreaterThanOrEqual(LIVER_CAPSULE_MM);
    }
    expect(runs.map((r) => r.tissue)).toEqual([Tissue.Vertebra, Tissue.RetroperitonealFat, Tissue.LiverCapsule, Tissue.Liver]);
    expect(runs[1].count).toBeGreaterThan(20);
    expect(runs[2].count).toBeGreaterThan(5);
    expect(runs[3].count).toBeGreaterThan(10);
    // Distancias físicas medidas a lo largo de la normal (paso 0,1 mm); no solo nombres de tejido.
    expect(runs[2].start - runs[1].start).toBeGreaterThan(2.7);
    expect(runs[2].start - runs[1].start).toBeLessThan(3.3);
    expect(runs[3].start - runs[2].start).toBeGreaterThan(LIVER_CAPSULE_MM - 0.2);
    expect(runs[3].start - runs[2].start).toBeLessThan(LIVER_CAPSULE_MM + 0.2);
  });
});

describe('grasa visceral con textura propia sin aumentar potencia basal', () => {
  it('potencia unitaria en una muestra independiente, variación continua y tejidos excluidos', () => {
    let power = 0,
      dbSum = 0,
      db2 = 0;
    const n = 30000;
    for (let i = 0; i < n; i++) {
      const p: Vec3 = [i * 0.971 - 200, i * 0.413 + 70, i * 1.237 - 150];
      const f = visceralFatLobules(p),
        db = 20 * Math.log10(f);
      power += f * f;
      dbSum += db;
      db2 += db * db;
      if (i < 100) {
        expect(retroTexture(p, Tissue.MesentericFat, [1, 0, 0])).toBe(f);
        expect(retroTexture(p, Tissue.RetroperitonealFat, [0, 1, 0])).toBe(f);
        for (const t of [Tissue.Liver, Tissue.RenalCortex, Tissue.PerirenalFat, Tissue.Blood])
          expect(retroTexture(p, t, [1, 0, 0])).toBe(1);
        expect(Math.abs(f - visceralFatLobules([p[0] + 1e-5, p[1], p[2]]))).toBeLessThan(1e-4);
      }
    }
    expect(power / n).toBeGreaterThan(0.97);
    expect(power / n).toBeLessThan(1.03);
    const sd = Math.sqrt(db2 / n - (dbSum / n) ** 2);
    expect(sd).toBeGreaterThan(2.8);
    expect(sd).toBeLessThan(3.6);
  });
});
