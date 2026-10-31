import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';

/**
 * Velocidad en el eje de las arterias del adulto sano en apnea frente a publicaciones (decisión 297): media ± 1 DE, salvo donde se dice.
 * Gao et al. 2011 (10 sanos, ángulo corregido), Madubueze y Ugwa 2018 (150 controles), Baumgartner et al. 1999 (21 voluntarios, rango
 * observado; 102 ± 37 es ± 2 DE), EFSUMB Course Book (47 sanos, fuente secundaria). No es validación clínica.
 */
describe('arterias del adulto sano frente a valores publicados', () => {
  const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient);
  const areas = scene.vesselAreas();
  const engine = new PhysiologyEngine(patient, areas);
  for (let i = 0; i < 2500; i++) engine.step();
  const ids: VesselId[] = [
    'interlobarArtery1',
    'renalArteryRight',
    'aorta',
    'commonHepaticArtery',
    'hepaticArtery',
    'celiacTrunk',
    'splenicArtery',
    'leftGastricArtery',
    'sma',
  ];
  const seen = new Map(ids.map((id) => [id, { max: -Infinity, min: Infinity, sum: 0 }]));
  let sumNetwork = 0;
  let sumShown = 0;
  const steps = 7500;
  for (let i = 0; i < steps; i++) {
    const s = engine.step();
    for (const id of ids) {
      const v = seen.get(id)!;
      const cms = s.velocities[id] / 10;
      v.max = Math.max(v.max, cms);
      v.min = Math.min(v.min, cms);
      v.sum += cms;
    }
    sumNetwork += s.qRenalArtery / 2;
    sumShown += (s.velocities.renalArteryRight * areas.renalArteryRight) / 1000;
  }
  /** Máximo del perfil (n + 2)/n sobre la media de la sección. */
  const center = (id: VesselId) => {
    const def = scene.vesselById.get(id);
    return def ? (def.profileN + 2) / def.profileN : 1.5;
  };
  const psv = (id: VesselId) => seen.get(id)!.max * center(id);
  const low = (id: VesselId) => seen.get(id)!.min * center(id);
  const meanFlow = (id: VesselId) => ((seen.get(id)!.sum / steps) * areas[id]) / 100;

  it('interlobar: sistólica, mínimo e IR en el intervalo de los controles', () => {
    expect(psv('interlobarArtery1')).toBeGreaterThan(30.11 - 5.18);
    expect(psv('interlobarArtery1')).toBeLessThan(30.11 + 5.18);
    expect(low('interlobarArtery1')).toBeGreaterThan(12.69 - 2.17);
    expect(low('interlobarArtery1')).toBeLessThan(12.69 + 2.17);
    const ri = 1 - low('interlobarArtery1') / psv('interlobarArtery1');
    expect(ri).toBeGreaterThan(0.55);
    expect(ri).toBeLessThan(0.63);
  });

  it('renal principal: dentro del rango observado, aunque por encima de las medias', () => {
    // 10 mL/s por una luz de 2,5 mm de radio no dan 79 ± 8 cm/s (limitación `renal-artery-velocity-high`)
    expect(psv('renalArteryRight')).toBeGreaterThan(49);
    expect(psv('renalArteryRight')).toBeLessThan(150);
  });

  it('el Doppler renal muestra otro pulso que la red, con el mismo caudal medio', () => {
    expect(sumShown / sumNetwork).toBeGreaterThan(0.99);
    expect(sumShown / sumNetwork).toBeLessThan(1.01);
  });

  it('aorta: sistólica en su intervalo y caudal entre el de sus ramas y el gasto', () => {
    expect(psv('aorta')).toBeGreaterThan(102 - 18.5);
    expect(psv('aorta')).toBeLessThan(102 + 18.5);
    const branches = 2 * meanFlow('renalArteryRight') + meanFlow('celiacTrunk') + meanFlow('sma');
    expect(meanFlow('aorta')).toBeGreaterThan(branches);
    expect(meanFlow('aorta')).toBeLessThan(83);
    // al final de la diástole sigue bajando lo que se llevan las ramas, sin detener toda la aorta
    expect(low('aorta')).toBeGreaterThan(5);
  });

  it('el celíaco reparte sus ramas y la hepática común alimenta a la propia, también tras un bolo', () => {
    expect(meanFlow('celiacTrunk')).toBeCloseTo(
      meanFlow('commonHepaticArtery') + meanFlow('splenicArtery') + meanFlow('leftGastricArtery'),
      6,
    );
    const e = new PhysiologyEngine(patient, areas);
    for (let i = 0; i < 500; i++) e.step();
    expect(e.intervene({ kind: 'bolus', volumeMl: 1500 })).not.toBeNull();
    for (let i = 0; i < 5000; i++) {
      const s = e.step();
      expect(s.velocities.commonHepaticArtery * areas.commonHepaticArtery).toBeGreaterThan(
        s.velocities.hepaticArtery * areas.hepaticArtery,
      );
    }
  });

  it.each([50, 120])('el Doppler renal conserva el caudal medio de la red a %i lpm, a ±2 %%', (heartRateBpm) => {
    const e = new PhysiologyEngine({ ...patient, heartRateBpm }, areas);
    for (let i = 0; i < 2500; i++) e.step();
    let network = 0;
    let shown = 0;
    for (let i = 0; i < 7500; i++) {
      const s = e.step();
      network += s.qRenalArtery / 2;
      shown += (s.velocities.renalArteryRight * areas.renalArteryRight) / 1000;
    }
    expect(shown / network).toBeGreaterThan(0.98);
    expect(shown / network).toBeLessThan(1.02);
  });

  it.each([NORMAL_ADULT, SEVERE_CONGESTION])('$id: el campo de velocidades da a las arterias el máximo de su perfil en el eje', (base) => {
    const anatomyScene = new AnatomyScene(base);
    const anatomy = new AnatomyQuery(anatomyScene);
    const e = new PhysiologyEngine(base, anatomyScene.vesselAreas());
    const s = e.step();
    let measured = 0;
    for (const id of ['interlobarArtery1', 'renalArteryRight', 'hepaticArtery'] as const) {
      const nodes = anatomyScene.vesselById.get(id)!.tube.nodes;
      const q = anatomy.classifyMaterial(nodes[1].p, s);
      if (q.vessel !== id) continue;
      const speed = Math.hypot(...q.bloodVelocity!);
      expect(speed / Math.abs(s.velocities[id])).toBeCloseTo(1.5, 3);
      measured++;
    }
    expect(measured).toBeGreaterThan(0);
  });

  it('hepáticas, celíaco y mesentérica: sistólica en el intervalo de la fuente secundaria', () => {
    for (const [id, mean, sd] of [
      ['commonHepaticArtery', 102, 46],
      ['hepaticArtery', 58, 34],
      ['celiacTrunk', 137, 45],
      ['sma', 145, 42],
    ] as const) {
      expect(psv(id), id).toBeGreaterThan(mean - sd);
      expect(psv(id), id).toBeLessThan(mean + sd);
    }
  });
});
