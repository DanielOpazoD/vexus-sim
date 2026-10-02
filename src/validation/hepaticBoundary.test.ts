import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { HEPATIC_SPINE_GAP_MM } from '../anatomy/organs/liver';
import { sdSpine } from '../anatomy/primitives';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
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
  it('reproduce la transición hepática antes del hueso observada en la ventana intercostal', () => {
    const s = new AnatomyScene(NORMAL_ADULT);
    const before: Vec3 = [-17.508805707, -34.116796875, 15.268222628];
    const towardBone: Vec3 = [-15, -34, 15.3];
    expect(s.classify(before, BASELINE_CALIBER).tissue).toBe(Tissue.Liver);
    const c = s.classify(towardBone, BASELINE_CALIBER);
    expect(c.tissue).toBe(Tissue.RetroperitonealFat);
    expect(c.interface).toBe(Interface.VertebralCortex);
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
