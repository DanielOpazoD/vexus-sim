import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { HEPATIC_SPINE_GAP_MM, hepaticSpineEnvelopeSd } from '../anatomy/organs/liver';
import { SPINE_SHAPE, sdSpine } from '../anatomy/primitives';
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
  it.each([false, true])('la envolvente hepática excluye el hueso en cuerpos, platillos, discos y arco (referencia %s)', (reference) => {
    setReferenceBody(reference ? profile : undefined);
    let s: AnatomyScene;
    try {
      s = new AnatomyScene(NORMAL_ADULT);
    } finally {
      setReferenceBody();
    }
    let gapSamples = 0;
    for (const level of [-4, -3, -2, -1, 0, 1, 2])
      for (const dz of [-15.6, -15.5, -15.4, -12.1, -12, -11.9, 0, 11.9, 12, 12.1, 15.4, 15.5, 15.6])
        for (const x of [-45, -40, -20, -10, 0, 10, 20, 40, 45])
          for (const y of [-35, -32, -20, -12, 0, 12, 20]) {
            const p: Vec3 = [s.spine.x0 + x, s.spine.y0 + y, SPINE_SHAPE.z0Mm + level * SPINE_SHAPE.levelMm + dz];
            const bone = sdSpine(p, s.spine);
            expect(hepaticSpineEnvelopeSd(p, s.spine)).toBeLessThanOrEqual(bone + 1e-12);
            if (bone >= 0 && bone < HEPATIC_SPINE_GAP_MM) {
              gapSamples++;
              expect(s.liverSdf(p)).toBeGreaterThanOrEqual(0);
            }
          }
    expect(gapSamples).toBeGreaterThan(100);
  });

  it.each([false, true])('la normal hepática converge a través del centro discal sin un pliegue espurio (referencia %s)', (reference) => {
    setReferenceBody(reference ? profile : undefined);
    let s: AnatomyScene;
    try {
      s = new AnatomyScene(NORMAL_ADULT);
    } finally {
      setReferenceBody();
    }
    const z = SPINE_SHAPE.z0Mm + 1.5 * SPINE_SHAPE.levelMm;
    // Testigo descubierto por liverContour: antes había una cúspide de ~136° persistente al refinar.
    const oldFold: Vec3 = [-13.035898384862241, s.spine.y0 + 12, z];
    const at = (x: number, dz: number): Vec3 => [x, s.spine.y0 + 12, z + dz];
    const surface = (dz: number): Vec3 => {
      let lo = -30,
        hi = -10;
      expect(s.liverSdf(at(lo, dz))).toBeLessThan(0);
      expect(s.liverSdf(at(hi, dz))).toBeGreaterThan(0);
      for (let i = 0; i < 45; i++) {
        const mid = (lo + hi) / 2;
        if (s.liverSdf(at(mid, dz)) < 0) lo = mid;
        else hi = mid;
      }
      const p = at((lo + hi) / 2, dz);
      expect(Math.abs(s.faceSdf(p, BASELINE_CALIBER, 'liverSurface')!)).toBeLessThan(1e-8);
      expect(sdSpine(p, s.spine)).toBeGreaterThanOrEqual(HEPATIC_SPINE_GAP_MM);
      return p;
    };
    const normal = (p: Vec3, h: number) => {
      const g = p.map((_, axis) => {
        const plus: Vec3 = [...p],
          minus: Vec3 = [...p];
        plus[axis] += h;
        minus[axis] -= h;
        return (s.liverSdf(plus) - s.liverSdf(minus)) / (2 * h);
      });
      const norm = Math.hypot(...g);
      expect(norm).toBeGreaterThan(0.1);
      return g.map((x) => x / norm);
    };
    const turns = [0.1, 0.025, 0.005].map((step) => {
      const a = normal(surface(-step), step / 10),
        b = normal(surface(step), step / 10);
      return (
        (Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              a.reduce((dot, n, i) => dot + n * b[i], 0),
            ),
          ),
        ) *
          180) /
        Math.PI
      );
    });
    expect(turns[1]).toBeLessThan(1);
    expect(turns[2]).toBeLessThan(0.2);
    expect(turns[2]).toBeLessThanOrEqual(turns[0] * 0.5 + 1e-5);
    expect(s.liverSdf(oldFold)).toBeGreaterThan(2);
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
