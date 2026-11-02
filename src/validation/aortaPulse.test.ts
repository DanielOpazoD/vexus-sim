import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { CASES, NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { gauss, type Beat } from '../physiology/rhythm';

// Oráculo independiente del cableado del candidato: contorno arterial preexistente,
// centros mecánicos tras R, no fase de UI ni máximo futuro de cada latido.
function pulseAt(t: number, beats: readonly Beat[]): number {
  return beats.reduce((p, b) => {
    const s = Math.sqrt(b.rr / 0.8);
    return p + gauss(t - b.tR - 0.12 * s, 0.06 * s) + 0.4 * gauss(t - b.tR - 0.3 * s, 0.09 * s);
  }, -0.3);
}
// Máximo de las dos gaussianas nominales, calculado una vez, no por latido.
const NOMINAL_EXCURSION = 1.0569487134195235;
const expectedScale = (pulse: number) => 1 + (0.08 * (pulse + 0.3)) / NOMINAL_EXCURSION;

function fixture(dt = 0.004, patient = NORMAL_ADULT) {
  const scene = new AnatomyScene(patient);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { dt, historySeconds: 20 });
  while (engine.sample.t < 12) engine.step();
  return { scene, engine, samples: engine.samples.filter((s) => s.t >= 8) };
}

describe('calibre aórtico arterial, decisión 314', () => {
  it('rechaza escala fija: distensión nominal positiva de 1,6 mm sobre 20 mm', () => {
    const { samples } = fixture();
    const diameters = samples.map((s) => 20 * s.aortaRadiusScale);
    expect(Math.max(...diameters) - Math.min(...diameters)).toBeGreaterThan(1.58);
    expect(Math.max(...diameters) - Math.min(...diameters)).toBeLessThan(1.62);
  });

  it.each(CASES)('$id: rechaza inversión, R sin retraso y doble retraso con los eventos reales', (patient) => {
    const { engine, samples } = fixture(0.004, patient);
    for (const s of samples) {
      const expected = expectedScale(pulseAt(s.t, engine.rhythm.beatsAround(s.t)));
      expect(s.aortaRadiusScale, `t=${s.t}`).toBeCloseTo(expected, 7);
    }
    const beats = engine.rhythm.beatsBetween(8, 12);
    expect(beats.length).toBeGreaterThan(1);
    for (const b of beats) {
      const inBeat = samples.filter((s) => s.t >= b.tR && s.t < b.tR + Math.min(b.rr, 0.4));
      const peak = inBeat.reduce((a, c) => (a.aortaRadiusScale > c.aortaRadiusScale ? a : c));
      // Ventana mecánica histórica, ± un paso: excluye R y el retraso duplicado.
      expect((peak.t - b.tR) / Math.sqrt(b.rr / 0.8)).toBeGreaterThan(0.115);
      expect((peak.t - b.tR) / Math.sqrt(b.rr / 0.8)).toBeLessThan(0.14);
    }
  });

  it('rechaza Q/A discordante: recupera el caudal original usando el área que ve la anatomía', () => {
    const { engine, scene, samples } = fixture();
    const query = new AnatomyQuery(scene);
    for (const s of samples) {
      const scale = query.caliberFor(s).radiusScale('aorta');
      expect(scale).toBeCloseTo(s.aortaRadiusScale, 12);
      expect((s.velocities.aorta * scene.vesselAreas().aorta * scale ** 2) / 1000).toBeCloseTo(
        80 + 190 * pulseAt(s.t, engine.rhythm.beatsAround(s.t)),
        8,
      );
      for (const id of ['celiacTrunk', 'sma', 'renalArteryRight', 'iliacArteryLeft'] as const)
        expect(query.caliberFor(s).radiusScale(id)).toBe(1);
    }
  });

  it('FA conserva RR irregular; dt 0,004 y 0,002 coinciden en tiempos comunes', () => {
    const patient = CASES.find((p) => p.rhythm === 'atrial-fibrillation')!;
    const a = fixture(0.004, patient);
    const b = fixture(0.002, patient);
    expect(new Set(a.engine.rhythm.beatsBetween(8, 12).map((beat) => beat.rr)).size).toBeGreaterThan(2);
    const fine = new Map(b.samples.map((s) => [Math.round(s.t * 1000), s]));
    for (const s of a.samples) expect(s.aortaRadiusScale).toBeCloseTo(fine.get(Math.round(s.t * 1000))!.aortaRadiusScale, 10);
  });

  it('congelado no avanza calibre ni velocidad por tiempo de pared', () => {
    const { engine } = fixture();
    engine.clock.pause();
    const before = engine.sample;
    engine.advanceRealTime(0.2);
    expect(engine.sample).toBe(before);
    expect(engine.sample.aortaRadiusScale).toBeGreaterThanOrEqual(1);
  });
});

it('la derivada radial es la del mismo pulso y no un segundo reloj', async () => {
  const { arterialCaliberAt, AORTA_MECHANICS } = await import('../physiology/arterialCaliber');
  const { engine } = fixture();
  const t = 9;
  const beats = engine.rhythm.beatsAround(t);
  const at = (time: number) => arterialCaliberAt({ t: time, beats, mechanics: AORTA_MECHANICS });
  expect(at(t).radiusScaleRateS).toBeCloseTo((at(t + 1e-6).radiusScale - at(t - 1e-6).radiusScale) / 2e-6, 7);
});
