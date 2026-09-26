import type { EquivalenceReport } from '../../app/equivalenceCheck';
import { FRAME_PASSES } from '../../ultrasound/passGraph';
import { errorLog, errorMessage } from '../../app/errorLog';
import { TISSUES } from '../../anatomy/tissues';
import { FLUID_TIME_ACCELERATION, type AppliedIntervention, type Intervention } from '../../physiology/circulation';
import { classifyVexusC } from '../../vexus/classification';
import { measurePhysiologyTruth } from '../../vexus/measurements';
import { button, controlId, note, row } from '../controls';
import type { PanelContext } from './context';
import { patternText, renalText } from './vexusText';

/** Niveles de PEEP de la botonera (cmH₂O). */
type PeepLevel = '0' | '5' | '10' | '15';
const PEEP_LEVELS: PeepLevel[] = ['0', '5', '10', '15'];
/** Un bolo o un diurético de la botonera (mL). */
const FLUID_STEP_ML = { bolusSmall: 250, bolusLarge: 500, diuresis: 500 } as const;

/** Rótulo de una intervención aplicada (para el estado y el anuncio). */
export function interventionText(i: Intervention): string {
  if (i.kind === 'peep') return `PEEP ${i.cmH2O} cmH₂O`;
  const ml = Math.round(i.volumeMl);
  return i.kind === 'bolus' ? `bolo de ${ml} mL` : `diurético de −${ml} mL`;
}

/** Anuncio de lo aplicado (región `role="status"`): lo recortado al límite del paciente se dice. */
export function announcement(requested: Intervention, applied: AppliedIntervention | null): string {
  if (!applied) return 'Sin efecto: el volumen ya está en su límite para este paciente.';
  if (applied.kind === 'peep') return `PEEP a ${applied.cmH2O} cmH₂O.`;
  const text = interventionText(applied);
  const capped = requested.kind !== 'peep' && applied.volumeMl < requested.volumeMl ? ' (recortado al límite del paciente)' : '';
  return `${text[0].toUpperCase()}${text.slice(1)} en curso${capped}.`;
}

/** Tiempo desde una intervención; para los líquidos, con su equivalente clínico (tiempo docente acelerado). */
export function elapsedText(i: AppliedIntervention, t: number): string {
  const s = Math.max(0, t - i.t0);
  if (i.kind === 'peep') return `hace ${s.toFixed(0)} s`;
  return `hace ${s.toFixed(0)} s (≈ ${((s * FLUID_TIME_ACCELERATION) / 60).toFixed(0)} min clínicos)`;
}

/** Pestaña Docente: verdad fisiológica, intervenciones y estado de la adquisición (solo con la casilla activada). */
export class TeacherTab {
  private debugEl!: HTMLElement;
  /** Valores del estado del lazo (una fila por magnitud). */
  private loopRows!: Record<'rap' | 'co' | 'volume' | 'peep' | 'tr' | 'last', HTMLElement>;
  private announceEl!: HTMLElement;
  /** Informe de equivalencia TS ↔ GLSL (lo alimenta el bucle principal a baja cadencia). */
  equivalence: EquivalenceReport | null = null;
  /** Descarga del diagnóstico (versión, GPU, caso, equipo, errores); la conecta `main.ts`. */
  onExportDiagnostics: () => void = () => undefined;
  /**
   * «Reiniciar paciente»: vuelve a cargar el caso (la sesión reconstruye el simulador) y devuelve el error si no pudo;
   * lo conecta `main.ts`.
   */
  onResetPatient: () => unknown = () => null;
  /** Tras una intervención aplicada: borra las mediciones del alumno y dice si había alguna; lo conecta el panel. */
  onIntervention: () => boolean = () => false;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: PanelContext,
    host: HTMLElement,
  ) {
    this.build(host);
  }

  private build(p: HTMLElement): void {
    this.buildInterventions(p);
    const sec = this.ctx.section(p, 'Verdad fisiológica y adquisición');
    note(sec, 'Oculto al alumno; la verdad del caso y lo adquirido se calculan por separado.');
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    sec.appendChild(this.debugEl);
    const diag = this.ctx.section(p, 'Diagnóstico', {
      info: 'Versión, commit, navegador, GPU, caso, equipo y últimos errores en un JSON para adjuntar a un informe. Sin datos del usuario.',
    });
    button(row(diag), 'Descargar diagnóstico', () => this.onExportDiagnostics());
  }

  /**
   * Intervenciones sobre el lazo cerrado (decisión 79): bolo, diurético y PEEP con el estado y el tiempo
   * transcurrido; «Reiniciar paciente» vuelve al caso. Solo existe en la pestaña Docente (oculta al alumno).
   */
  private buildInterventions(p: HTMLElement): void {
    const sim = this.ctx.sim;
    const sec = this.ctx.section(p, 'Intervenciones', {
      info:
        `La PAD media sale del cruce del retorno venoso con la curva de Starling del VD; las ondas conservan su forma. ` +
        `Líquidos en tiempo docente acelerado ×${FLUID_TIME_ACCELERATION} (1 s ≈ ${FLUID_TIME_ACCELERATION} s clínicos): el bolo ` +
        `llega en ~30 s y el diurético en ~2 min. La PEEP (CPAP si respira solo) actúa en segundos. «Reiniciar paciente» ` +
        `vuelve al caso. Cada intervención borra las mediciones de «Medir»: el grado no mezcla el antes y el después.`,
    });
    const fluids = row(sec);
    const fluidButtons: Array<{ el: HTMLButtonElement; sign: 1 | -1 }> = [
      {
        el: button(fluids, `Bolo ${FLUID_STEP_ML.bolusSmall} mL`, () => this.apply({ kind: 'bolus', volumeMl: FLUID_STEP_ML.bolusSmall }))
          .el,
        sign: 1,
      },
      {
        el: button(fluids, `Bolo ${FLUID_STEP_ML.bolusLarge} mL`, () => this.apply({ kind: 'bolus', volumeMl: FLUID_STEP_ML.bolusLarge }))
          .el,
        sign: 1,
      },
      {
        el: button(fluids, `Diurético −${FLUID_STEP_ML.diuresis} mL`, () =>
          this.apply({ kind: 'diuresis', volumeMl: FLUID_STEP_ML.diuresis }),
        ).el,
        sign: -1,
      },
    ];
    // sin sitio en ese sentido (límite del volumen o del llenado del caso) el botón se marca como no disponible, sin
    // `disabled`: con el teclado el foco se quedaría en el cuerpo de la página. Un clic entonces solo explica por qué
    this.ctx.track({
      sync: () => {
        const c = sim().physiology.circulation;
        for (const b of fluidButtons) b.el.setAttribute('aria-disabled', String(c.fluidRoom(b.sign) < 1));
      },
    });
    const peepRow = document.createElement('div');
    peepRow.className = 'field-row';
    const peepLabel = document.createElement('span');
    peepLabel.className = 'grow';
    peepLabel.id = controlId('peep');
    peepLabel.textContent = 'PEEP (cmH₂O)';
    peepRow.appendChild(peepLabel);
    // una PEEP pedida fuera de la botonera (por la API) no enciende ningún botón
    this.ctx
      .segmented<PeepLevel | 'otra'>(
        peepRow,
        PEEP_LEVELS.map((v) => [v, v]),
        () => {
          const target = String(sim().physiology.circulation.state.peepTargetCmH2O);
          return (PEEP_LEVELS as string[]).includes(target) ? (target as PeepLevel) : 'otra';
        },
        (v) => {
          if (v !== 'otra') this.apply({ kind: 'peep', cmH2O: Number(v) });
        },
      )
      .setAttribute('aria-labelledby', peepLabel.id);
    sec.appendChild(peepRow);
    const dl = document.createElement('dl');
    dl.className = 'loop-state';
    const field = (label: string) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dl.append(dt, dd);
      return dd;
    };
    this.loopRows = {
      rap: field('PAD media'),
      co: field('Gasto'),
      volume: field('Volumen'),
      peep: field('PEEP'),
      tr: field('IT'),
      last: field('Última'),
    };
    sec.appendChild(dl);
    // anuncio de lo aplicado para los lectores de pantalla (el estado numérico cambia 4 veces por segundo y no se anuncia)
    this.announceEl = note(sec);
    this.announceEl.setAttribute('role', 'status');
    button(row(sec), 'Reiniciar paciente', () => {
      const error = this.onResetPatient();
      this.announce(error ? `No se pudo reiniciar el paciente: ${errorMessage(error)}` : 'Paciente reiniciado: vuelve al caso.');
      this.ctx.sync();
      this.renderLoop();
    });
    this.renderLoop();
  }

  /** Cambio de caso o reinicio: el aviso de la intervención anterior ya no vale. */
  onSimulatorChanged(): void {
    this.clearAnnouncement();
    this.renderLoop();
  }

  private apply(i: Intervention): void {
    const applied = this.ctx.sim().physiology.intervene(i);
    let text = announcement(i, applied);
    if (applied && this.onIntervention()) text += ' Mediciones borradas: el grado no mezcla el antes y el después.';
    this.announce(text);
    this.ctx.sync();
    this.renderLoop();
  }

  /** Mensaje en la región `role="status"`: se vacía y se escribe un instante después, para que se lea aunque se repita. */
  private announce(text: string): void {
    this.clearAnnouncement();
    this.announceTimer = setTimeout(() => {
      this.announceEl.textContent = text;
      this.announceTimer = null;
    }, 50);
  }

  private clearAnnouncement(): void {
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.announceEl.textContent = '';
  }

  /** Estado del lazo cerrado frente al caso y la última intervención con el tiempo transcurrido. */
  private renderLoop(): void {
    const e = this.ctx.sim().physiology;
    const c = e.circulation;
    const s = c.state;
    const k = c.loop;
    const lpm = (mlS: number) => ((mlS * 60) / 1000).toFixed(1);
    const sign = (v: number) => (Math.round(v) === 0 ? '0' : `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}`);
    const last = c.interventions[c.interventions.length - 1];
    const r = this.loopRows;
    r.rap.textContent = `${s.rapMeanMmHg.toFixed(1)} mmHg · caso ${k.rap0.toFixed(1)}`;
    r.co.textContent = `${lpm(s.cardiacOutputMlS)} L/min · caso ${lpm(k.co0)}`;
    r.volume.textContent = `${sign(s.fluidDeltaMl)} de ${sign(s.fluidTargetMl)} mL`;
    r.peep.textContent = `${s.peepCmH2O.toFixed(0)} cmH₂O`;
    r.tr.textContent = `${s.tricuspidRegurgitation.toFixed(2)} · caso ${k.tr0.toFixed(2)}`;
    r.last.textContent = last ? `${interventionText(last)}, ${elapsedText(last, e.clock.t)}` : 'ninguna';
  }

  renderDebug(): void {
    if (!this.ctx.store.get().debug || this.ctx.store.get().tab !== 'docente') return;
    this.renderLoop();
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
      } catch (e) {
        truth = `VERDAD FISIOLÓGICA: — (${errorMessage(e)})\n`;
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
    const gpu = sim.renderer.gpuTimings();
    const perPass = gpu?.perPass;
    const gpuTxt = !gpu
      ? 'GPU: el navegador no expone temporizadores (o aún no hay medidas)\n'
      : perPass
        ? `GPU ${gpu.frameMs.toFixed(1)} ms/cuadro: ${FRAME_PASSES.filter((p) => perPass[p.id] !== undefined)
            .map((p) => `${p.label} ${perPass[p.id]!.toFixed(2)}`)
            .join(' · ')}\n`
        : `GPU ≈ ${gpu.frameMs.toFixed(1)} ms/cuadro (este navegador no separa las pasadas)\n`;
    const loop = sim.physiology.circulation.state;
    const errs = errorLog.recent(5);
    const errTxt = errs.length
      ? `ERRORES (${errorLog.size})\n` +
        errs.map((e) => `  [${e.source}] ${e.message}${e.count > 1 ? ` ×${e.count}` : ''}`).join('\n') +
        '\n'
      : '';
    this.debugEl.textContent =
      errTxt +
      eqTxt +
      gpuTxt +
      `t ${t.toFixed(2)} s · latido ${s.beatIndex} · fase ${s.cardiacPhase.toFixed(2)} · resp ${s.resp.volume.toFixed(2)}\n` +
      `P_AD ${s.pRa.toFixed(1)} · P_VCI ${s.pIvc.toFixed(1)} (Ptm ${s.pIvcTransmural.toFixed(1)}) · P_hep ${s.pHepatic.toFixed(1)} · P_abd ${s.pAbd.toFixed(1)} mmHg\n` +
      `Lazo: PAD media ${loop.rapMeanMmHg.toFixed(1)} (llenado ${loop.fillingRapMmHg.toFixed(1)}) · Pmsf ${loop.pmsfMmHg.toFixed(1)} mmHg · GC ${((loop.cardiacOutputMlS * 60) / 1000).toFixed(2)} L/min\n` +
      `Q_hv ${s.qHepaticVein.toFixed(1)} · Q_pv ${s.qPortal.toFixed(1)} · Q_ha ${s.qHepaticArtery.toFixed(1)} mL/s · VCI AP/lat ${s.ivc.dApMm.toFixed(1)}/${s.ivc.dLatMm.toFixed(1)} mm\n` +
      `u VSH dcha ${(s.velocities.hvRight / 10).toFixed(1)} · porta ${(s.velocities.pvTrunk / 10).toFixed(1)} · VCI ${(s.velocities.ivcSupra / 10).toFixed(1)} · v. interlobar ${(s.velocities.interlobarVein2 / 10).toFixed(1)} cm/s\n` +
      gateTxt +
      truth;
  }
}
