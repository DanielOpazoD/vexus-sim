import type { EquivalenceReport } from '../../app/equivalenceCheck';
import { TISSUES } from '../../anatomy/tissues';
import { classifyVexusC } from '../../vexus/classification';
import { measurePhysiologyTruth } from '../../vexus/measurements';
import { help } from '../controls';
import type { PanelContext } from './context';
import { patternText, renalText } from './vexusText';

/** Pestaña Docente: verdad fisiológica y estado de la adquisición (solo con la casilla activada). */
export class TeacherTab {
  private debugEl!: HTMLElement;
  /** Informe de equivalencia TS ↔ GLSL (lo alimenta el bucle principal a baja cadencia). */
  equivalence: EquivalenceReport | null = null;

  constructor(
    private readonly ctx: PanelContext,
    host: HTMLElement,
  ) {
    this.build(host);
  }

  private build(p: HTMLElement): void {
    const sec = this.ctx.section(p, 'Verdad fisiológica y adquisición');
    help(sec, 'Se oculta al alumno. La verdad del caso y lo adquirido se calculan por separado.');
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    sec.appendChild(this.debugEl);
  }

  renderDebug(): void {
    if (!this.ctx.store.get().debug || this.ctx.store.get().tab !== 'docente') return;
    const sim = this.ctx.sim();
    const s = sim.sample;
    const t = sim.physiology.clock.t;
    let truth = 'VERDAD FISIOLÓGICA: acumulando historial…\n';
    if (t > 8) {
      try {
        const m = measurePhysiologyTruth(sim.physiology, { fromT: t - 6, toT: t });
        const g = classifyVexusC({
          ivcMaxDiameterMm: m.ivcMaxMm,
          hepatic: m.hepaticPattern,
          portalPulsatilityFraction: m.portalPF,
          renal: m.renalPattern,
        });
        truth =
          `VERDAD FISIOLÓGICA (últimos 6 s)\n` +
          `  VCI AP máx/mín ${m.ivcMaxMm.toFixed(1)}/${m.ivcMinMm.toFixed(1)} mm\n` +
          `  VSH S/D/A ${m.hvS.toFixed(1)}/${m.hvD.toFixed(1)}/${m.hvA.toFixed(1)} cm/s → ${patternText(m.hepaticPattern)}\n` +
          `  Porta ${m.pvMax.toFixed(1)}/${m.pvMin.toFixed(1)} cm/s → PF ${m.portalPF.toFixed(0)} %\n` +
          `  V. interlobar S/D/mín ${m.rvS.toFixed(1)}/${m.rvD.toFixed(1)}/${m.rvMin.toFixed(1)} cm/s → ${renalText(m.renalPattern)}\n` +
          `  Grado C de referencia: ${g.grade ?? (g.gradeRange ? g.gradeRange.join('–') : '—')}\n`;
      } catch {
        truth = 'VERDAD FISIOLÓGICA: —\n';
      }
    }
    const g = sim.gateInfo;
    const fd = sim.gateExpectedShiftHz();
    const comp = sim.sampleVolume.lastComposition;
    const gateTxt = sim.pw.enabled
      ? `PUERTA PW\n  vaso en el centro: ${g?.vessel ?? 'ninguno'} · ángulo haz–flujo ${g?.beamAngleToFlowDeg?.toFixed(0) ?? '—'}°\n` +
        `  transmisión ${g ? (20 * Math.log10(Math.max(1e-6, g.transmission))).toFixed(0) : '—'} dB · fD física en el centro ${fd !== null ? fd.toFixed(0) + ' Hz' : '—'}\n` +
        `  volumen: sangre ${(comp.bloodFraction * 100).toFixed(0)} % · arterial ${(comp.arterialFraction * 100).toFixed(0)} % · pared ${(comp.wallFraction * 100).toFixed(0)} %\n`
      : '';
    const eq = this.equivalence;
    const eqTxt = eq
      ? `ANATOMÍA TS ↔ GLSL: acuerdo ${(eq.agreement * 100).toFixed(1)} % · interior ${(eq.interiorAgreement * 100).toFixed(1)} %` +
        (eq.worst.length ? ` · peor: ${eq.worst.map((w) => `${TISSUES[w.cpu].name}→${TISSUES[w.gpu].name} ${w.count}`).join(', ')}` : '') +
        '\n'
      : '';
    this.debugEl.textContent =
      eqTxt +
      `t ${t.toFixed(2)} s · latido ${s.beatIndex} · fase ${s.cardiacPhase.toFixed(2)} · resp ${s.resp.volume.toFixed(2)}\n` +
      `P_AD ${s.pRa.toFixed(1)} · P_VCI ${s.pIvc.toFixed(1)} (Ptm ${s.pIvcTransmural.toFixed(1)}) · P_hep ${s.pHepatic.toFixed(1)} · P_abd ${s.pAbd.toFixed(1)} mmHg\n` +
      `Q_hv ${s.qHepaticVein.toFixed(1)} · Q_pv ${s.qPortal.toFixed(1)} · Q_ha ${s.qHepaticArtery.toFixed(1)} mL/s · VCI AP/lat ${s.ivc.dApMm.toFixed(1)}/${s.ivc.dLatMm.toFixed(1)} mm\n` +
      `u VSH dcha ${(s.velocities.hvRight / 10).toFixed(1)} · porta ${(s.velocities.pvTrunk / 10).toFixed(1)} · VCI ${(s.velocities.ivcSupra / 10).toFixed(1)} · v. interlobar ${(s.velocities.interlobarVein2 / 10).toFixed(1)} cm/s\n` +
      gateTxt +
      truth;
  }
}
