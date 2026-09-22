/**
 * Calibración de la fisiología (NEEDS_CALIBRATION): integra cada caso y
 * resume los observables fisiológicos verdaderos (no los adquiridos) para
 * compararlos con los anclajes de la base de conocimiento (D.4, G.2).
 *
 *   npm run calibrate
 */
import { AnatomyScene } from '../src/anatomy/scene';
import { CASES } from '../src/cases';
import { PhysiologyEngine } from '../src/physiology/engine';
import { measurePhysiologyTruth } from '../src/vexus/measurements';
import { classifyVexusC } from '../src/vexus/classification';

for (const patient of CASES) {
  const scene = new AnatomyScene(patient);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 20 });
  const seconds = 16;
  const steps = Math.round(seconds / engine.clock.dt);
  for (let i = 0; i < steps; i++) engine.step();
  const m = measurePhysiologyTruth(engine, { fromT: 6, toT: 16 });
  const grade = classifyVexusC({
    ivcMaxDiameterMm: m.ivcMaxMm,
    hepatic: m.hepaticPattern,
    portalPulsatilityFraction: m.portalPF,
    renal: m.renalPattern,
  });
  console.log(`\n=== ${patient.label} (${patient.id}) ===`);
  console.log(
    `PAD media ${patient.rapMeanMmHg} mmHg · FC ${patient.heartRateBpm} · RV ${patient.rvFunction} · TR ${patient.tricuspidRegurgitation}`,
  );
  console.log(
    `P_AD ${m.pRaMin.toFixed(1)}–${m.pRaMax.toFixed(1)} mmHg · P_hep ${m.pHepMean.toFixed(1)} · P_esp ${m.pSpMean.toFixed(1)} · P_VCI ${m.pIvcMean.toFixed(1)} (Ptm ${m.ptmIvcMean.toFixed(1)})`,
  );
  console.log(`VCI AP máx/mín ${m.ivcMaxMm.toFixed(1)}/${m.ivcMinMm.toFixed(1)} mm · colapso ${(100 * m.ivcCollapse).toFixed(0)} %`);
  console.log(
    `Suprahepática dcha: S ${m.hvS.toFixed(1)} · D ${m.hvD.toFixed(1)} · A ${m.hvA.toFixed(1)} cm/s → ${m.hepaticPattern} (S/D ${m.hvSD.toFixed(2)})`,
  );
  console.log(`Porta: Vmáx ${m.pvMax.toFixed(1)} · Vmín ${m.pvMin.toFixed(1)} cm/s · PF ${m.portalPF.toFixed(0)} %`);
  console.log(
    `Art. hepática PSV/EDV ${m.haPsv.toFixed(1)}/${m.haEdv.toFixed(1)} cm/s · Q_hv ${m.qHvMean.toFixed(1)} · Q_pv ${m.qPvMean.toFixed(1)} · Q_ha ${m.qHaMean.toFixed(1)} mL/s`,
  );
  console.log(
    `V. interlobar: S ${m.rvS.toFixed(1)} · D ${m.rvD.toFixed(1)} · mín ${m.rvMin.toFixed(1)} cm/s → ${m.renalPattern} · art. interlobar PSV/EDV ${m.raPsv.toFixed(1)}/${m.raEdv.toFixed(1)} cm/s`,
  );
  console.log(`Grado VExUS C emergente: ${grade.grade} (${grade.status})`);
}
