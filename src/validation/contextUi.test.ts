import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseTeacherNotes } from '../app/teacherNotes';
import type { Simulator } from '../app/simulator';
import { Store } from '../app/store';
import { CASE_TEACHING } from '../cases/teaching';
import { CASE_VIGNETTES } from '../cases/vignettes';
import type { Syncable } from '../ui/controls';
import type { PanelContext } from '../ui/panel/context';
import { MeasureTab } from '../ui/panel/measureTab';
import { TeacherTab, renderCaseNotes } from '../ui/panel/teacherTab';
import { CONTEXT_FLAGS, CONTEXT_LABELS, contextResultLines } from '../ui/panel/vexusText';
import { classifyModifiedVexus, classifyVexusC } from '../vexus/classification';
import { FakeElement, fakeDocument, findAll } from './support/fakeDom';

/**
 * Cableado del contexto clínico en la consola (decisión 82), con un DOM falso: la sección «Contexto clínico» de la
 * pestaña Medir (viñeta, una casilla por confusor, lo marcado en el grado y en el resultado, y cuándo se borra) y lo que
 * solo ve el docente en su pestaña. Las pestañas son las de la app; el panel se sustituye por lo mínimo que la pestaña le
 * pide (secciones, sincronización, estado y un simulador con el id del caso).
 */
beforeEach(() => vi.stubGlobal('document', fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

function fakePanel(sim: object, debug = false) {
  const syncables: Syncable[] = [];
  const sections: string[] = [];
  const store = new Store({
    mode: 'B',
    tab: 'medir',
    frozen: false,
    debug,
    audio: false,
    caseId: 'normal-adult',
    torso: true,
    tool: 'none',
  });
  const ctx: PanelContext = {
    sim: () => sim as unknown as Simulator,
    store,
    dispatch: () => undefined,
    track: <T extends Syncable>(s: T): T => {
      syncables.push(s);
      return s;
    },
    sync: () => syncables.forEach((s) => s.sync()),
    section: (parent, title) => {
      const sec = document.createElement('section');
      const body = document.createElement('div');
      sec.append(title, body);
      parent.appendChild(sec);
      sections.push(title);
      return body;
    },
    segmented: () => document.createElement('div'),
  };
  return { ctx, sections, store };
}

function mountMeasure(caseId: string) {
  const sim = { patient: { id: caseId }, pw: { enabled: false } };
  const { ctx, sections } = fakePanel(sim);
  const host = new FakeElement('div');
  const tab = new MeasureTab(ctx, host as unknown as HTMLElement, new FakeElement('span') as unknown as HTMLElement);
  const byClass = (c: string) => findAll(host, (e) => e.classList.contains(c));
  const boxes = () => findAll(host, (e) => e.tagName === 'INPUT' && e.type === 'checkbox');
  const box = (label: string) => boxes().find((b) => b.parentElement!.textContent === label)!;
  return {
    tab,
    sections,
    boxes,
    box,
    result: () => byClass('result')[0].innerHTML,
    /** El anunciador del grado va en la pestaña, fuera del cuerpo de la medida (que se oculta con el calibrador armado). */
    live: () => {
      const live = findAll(host, (e) => e.classList.contains('sr-only'));
      expect(live).toHaveLength(1);
      expect(live[0].parentElement).toBe(host);
      return live[0];
    },
    vignette: () => byClass('vignette')[0].textContent,
    /** Otro caso (la sesión reconstruye el simulador y el panel avisa a la pestaña) o el mismo reiniciado. */
    load: (id: string) => {
      sim.patient = { id };
      tab.onSimulatorChanged();
    },
    button: (text: string) => findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === text)[0],
    /**
     * Capturas ya hechas. Las de la pestaña salen del espectro adquirido, que aquí no hay: se ponen en sus campos, y lo
     * que se prueba es lo que la pestaña hace con ellas (grado con el contexto, líneas y avisos).
     */
    measured: (m: { hepatic?: unknown; portal?: unknown; renal?: unknown }) => {
      const t = tab as unknown as { lastHepatic: unknown; lastPortal: unknown; lastRenal: unknown };
      t.lastHepatic = m.hepatic ?? null;
      t.lastPortal = m.portal ?? null;
      t.lastRenal = m.renal ?? null;
    },
  };
}

// capturas con el visto bueno de la calidad, con los valores del caso de la presión intraabdominal alta
const OK = { quality: { issue: null } };
const SEVERE_HV = { ...OK, pattern: 'severe', sPeak: -9, dPeak: 27, aPeak: 2, beats: 4 };
const NORMAL_HV = { ...OK, pattern: 'normal', sPeak: 25, dPeak: 15, aPeak: -4, beats: 4 };
const NORMAL_PV = { ...OK, vMax: 21, vMin: 16, pulsatilityFraction: 22 };
const CONTINUOUS_RV = { ...OK, pattern: 'continuous', sPeak: 13, dPeak: 22, vMin: 6, beats: 4 };
const MONOPHASIC_RV = { ...CONTINUOUS_RV, pattern: 'monophasic', sPeak: 8, dPeak: 36, vMin: -6 };

describe('Pestaña Medir: contexto clínico (decisión 82)', () => {
  it('«Contexto clínico» va antes del protocolo, con la viñeta del caso y una casilla sin marcar por confusor', () => {
    const m = mountMeasure('abdominal-hypertension');
    expect(m.sections).toEqual(['Contexto clínico', 'Protocolo VExUS', 'Resultado']);
    expect(m.vignette()).toBe(CASE_VIGNETTES['abdominal-hypertension']);
    expect(m.boxes().map((b) => b.parentElement!.textContent)).toEqual([
      'ERC avanzada o diálisis',
      'Cirrosis',
      'Fibrilación auricular',
      'Sin ECG',
      'Ventilación con presión positiva',
      'Presión intraabdominal alta',
      'Deportista',
    ]);
    expect(m.boxes().every((b) => !b.checked)).toBe(true);
    // el grupo tiene nombre (la leyenda) y cada casilla el suyo (su etiqueta la envuelve)
    const group = m.boxes()[0].parentElement!.parentElement!;
    expect(group.tagName).toBe('FIELDSET');
    expect(group.children[0].tagName).toBe('LEGEND');
    // sin nada marcado ni medido: sin avisos, y la línea del mVExUS
    expect(m.result()).not.toContain('ctx-warn');
    expect(m.result()).toContain('mVExUS (sin riñón): <b>—</b>');
    // el resumen para el lector de pantalla está en una región viva
    expect(m.live().getAttribute('aria-live')).toBe('polite');
    expect(m.live().textContent).toBe('VExUS —, VCI no medida');
  });

  it('«Cirrosis» quita la porta en los dos sentidos y la suprahepática solo si no está invertida', () => {
    const m = mountMeasure('cirrhosis-pulmonary-hypertension');
    const portal = { ...OK, vMax: 13, vMin: 8, pulsatilityFraction: 38 };
    m.measured({ hepatic: SEVERE_HV, portal, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(31);
    expect(m.result()).toContain('VExUS 3 <span class="small">completo</span>');
    m.box('Cirrosis').click();
    let r = m.result();
    // la S invertida y el riñón grave siguen dando el 3: la cirrosis aplana la suprahepática, no la invierte (un grado,
    // no un intervalo: «con el contexto»)
    expect(r).toContain('VExUS 3 <span class="small">con el contexto</span>');
    expect(r).toContain('<b>Porta · no fiable</b> — cirrosis: la pulsatilidad portal no sigue a la PAD');
    expect(r).toContain('<b>Suprahepática · aviso</b> — cirrosis:');
    let lines = r.split('</div>');
    expect(lines.find((l) => l.includes('Porta: 13.0/8.0'))).toContain('(leve)');
    expect(lines.find((l) => l.includes('Porta: 13.0/8.0'))).toContain('· no fiable');
    expect(lines.find((l) => l.includes('VSH: S'))).not.toContain('no fiable');
    expect(lines.find((l) => l.includes('Renal: S'))).not.toContain('no fiable');
    expect(m.live().textContent).toBe('VExUS 3, con el contexto');
    // con la suprahepática normal, que la cirrosis puede ocultar, sí deja de contar: el intervalo lo abre el riñón
    m.measured({ hepatic: NORMAL_HV, portal, renal: MONOPHASIC_RV });
    m.tab.renderResult();
    r = m.result();
    expect(r).toContain('VExUS 2–3 <span class="small">intervalo por el contexto</span>');
    expect(r).toContain('<b>Suprahepática · no fiable</b> — cirrosis:');
    lines = r.split('</div>');
    expect(lines.find((l) => l.includes('VSH: S'))).toContain('· no fiable');
    m.box('Cirrosis').click();
    expect(m.result()).not.toContain('no fiable');
  });

  it('presión intraabdominal alta: la VCI pequeña da el intervalo en vez del grado 0 falso, con el aviso y el mVExUS', () => {
    const m = mountMeasure('abdominal-hypertension');
    m.measured({ hepatic: SEVERE_HV, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(14.5);
    expect(m.result()).toContain('VExUS 0 <span class="small">completo</span>');
    m.box('Presión intraabdominal alta').click();
    const r = m.result();
    expect(r).toContain('VExUS 0–2 <span class="small">intervalo por el contexto</span>');
    expect(r).toContain('<b>VCI · aviso</b> — presión intraabdominal alta: la VCI puede ser pequeña con la PAD alta');
    expect(r).toContain('mVExUS (sin riñón): <b>0–2</b> <span class="small">intervalo por el contexto</span>');
    expect(r).not.toContain('del corte de 20 mm');
    expect(m.live().textContent).toBe('VExUS 0–2, intervalo por el contexto');
    // sin el riñón medido, «incompleto»: falta una medida, no solo el contexto
    m.measured({ hepatic: SEVERE_HV, portal: NORMAL_PV });
    m.tab.renderResult();
    expect(m.result()).toContain('VExUS 0–3 <span class="small">incompleto</span>');
    // a ±2 mm del corte, la nota
    m.tab.setIvcCaliper(21);
    expect(m.result()).toContain('VCI a ±2 mm del corte de 20 mm');
  });

  it('ERC y deportista solo quitan el hallazgo grave: con el riñón y la porta normales el grado no se abre', () => {
    const m = mountMeasure('normal-adult');
    m.measured({ hepatic: NORMAL_HV, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(24);
    m.box('ERC avanzada o diálisis').click();
    m.box('Deportista').click();
    const r = m.result();
    expect(r).toContain('VExUS 1 <span class="small">completo</span>');
    expect(r).not.toContain('no fiable');
    expect(r).toContain('<b>Renal · aviso</b>');
    expect(r).toContain('<b>VCI · aviso</b> — deportista: la VCI puede estar dilatada sin PAD alta');
  });

  it('otro caso desmarca todo y cambia la viñeta; reiniciar el mismo, intervenir o «Borrar mediciones» no tocan lo marcado', () => {
    const m = mountMeasure('abdominal-hypertension');
    m.box('Presión intraabdominal alta').click();
    m.box('Cirrosis').click();
    const warnings = () => (m.result().match(/ctx-warn/g) ?? []).length;
    expect(warnings()).toBe(3);
    // intervención docente: la historia no cambia (el panel solo borra las mediciones)
    m.tab.setIvcCaliper(9);
    m.tab.clearMeasurements();
    expect(m.box('Presión intraabdominal alta').checked).toBe(true);
    expect(warnings()).toBe(3);
    m.button('Borrar mediciones').click();
    expect(m.box('Cirrosis').checked).toBe(true);
    // «Reiniciar paciente»: el mismo caso, las mediciones fuera y lo marcado sigue
    m.tab.setIvcCaliper(9);
    m.load('abdominal-hypertension');
    expect(m.result()).toContain('VCI: — ');
    expect(m.box('Cirrosis').checked).toBe(true);
    expect(warnings()).toBe(3);
    // otro caso: nada marcado, sin avisos y la viñeta nueva
    m.load('normal-adult');
    expect(m.boxes().every((b) => !b.checked)).toBe(true);
    expect(warnings()).toBe(0);
    expect(m.vignette()).toBe(CASE_VIGNETTES['normal-adult']);
  });
});

describe('Resultado con el contexto: textos (decisión 82)', () => {
  it('cada confusor tiene su rótulo y cada aviso su territorio y su motivo', () => {
    expect(CONTEXT_FLAGS).toHaveLength(7);
    for (const f of CONTEXT_FLAGS) expect(CONTEXT_LABELS[f].length).toBeGreaterThan(3);
    const all = Object.fromEntries(CONTEXT_FLAGS.map((f) => [f, true]));
    const input = { ivcMaxDiameterMm: 24, hepatic: 'severe', portalPulsatilityFraction: 60, renal: 'monophasic' } as const;
    const lines = contextResultLines(classifyVexusC(input, all), classifyModifiedVexus(input, all));
    const warn = lines.filter((l) => l.includes('ctx-warn'));
    expect(warn).toHaveLength(9); // la cirrosis y el deportista avisan de dos territorios cada uno
    // quitan: el riñón grave (ERC) y la porta (cirrosis y deportista); la S invertida sigue contando
    expect(warn.filter((l) => l.includes('· no fiable'))).toHaveLength(3);
    expect(lines[0]).toMatch(/^<div>mVExUS \(sin riñón\): <b>/);
    // la nota de la VCI solo a ±2 mm del corte: 24 mm no, 21,5 sí
    expect(lines.some((l) => l.includes('del corte de 20 mm'))).toBe(false);
    const near = { ...input, ivcMaxDiameterMm: 21.5 };
    expect(contextResultLines(classifyVexusC(near), classifyModifiedVexus(near)).some((l) => l.includes('del corte de 20 mm'))).toBe(true);
  });
});

/** Un simulador con lo que lee la pestaña Docente al construirse: el id del caso y el estado del lazo cerrado. */
function fakeTeacherSim(caseId: string) {
  return {
    patient: { id: caseId },
    physiology: {
      clock: { t: 0 },
      circulation: {
        state: {
          rapMeanMmHg: 14,
          cardiacOutputMlS: 80,
          fluidDeltaMl: 0,
          fluidTargetMl: 0,
          peepCmH2O: 0,
          peepTargetCmH2O: 0,
          tricuspidRegurgitation: 0.7,
        },
        loop: { rap0: 14, co0: 80, tr0: 0.7 },
        interventions: [],
        fluidRoom: () => 500,
      },
    },
  };
}

describe('Pestaña Docente: lo que solo ve el docente (decisión 82)', () => {
  it('las notas del caso: el nombre, los confusores reales y la trampa; para el alumno, nada', () => {
    const el = new FakeElement('div');
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('abdominal-hypertension', true));
    expect(el.children.map((c) => c.textContent)).toEqual([
      'Trampa · PIA alta con fallo derecho',
      'Contexto real: Presión intraabdominal alta',
      CASE_TEACHING['abdominal-hypertension'].trap,
    ]);
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('af-moderate-congestion', true));
    expect(el.children.map((c) => c.textContent).slice(1)).toEqual([
      'Contexto real: Fibrilación auricular',
      'Caso de referencia, sin trampa.',
    ]);
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('abdominal-hypertension', false));
    expect(el.childNodes).toHaveLength(0);
    expect(el.textContent).toBe('');
  });

  it('al apagar el modo docente se vacían las notas y el estado del lazo, también en el DOM oculto', () => {
    const sim = fakeTeacherSim('abdominal-hypertension');
    const { ctx, store } = fakePanel(sim, true);
    const host = new FakeElement('div');
    const tab = new TeacherTab(ctx, host as unknown as HTMLElement);
    ctx.sync();
    const notes = () => findAll(host, (e) => e.classList.contains('case-notes'))[0].textContent;
    const loop = () => findAll(host, (e) => e.classList.contains('loop-state'))[0].textContent;
    expect(notes()).toContain('Grado 0 falso');
    expect(loop()).toContain('14.0 mmHg · caso 14.0');
    // la verdad que pintó el bucle (`renderDebug`, que aquí no corre: necesita el simulador entero)
    const truth = findAll(host, (e) => e.classList.contains('debug'))[0];
    truth.textContent = 'VERDAD FISIOLÓGICA (últimos 6 s)';
    store.set({ debug: false });
    ctx.sync();
    expect(notes()).toBe('');
    expect(truth.textContent).toBe('');
    // quedan los rótulos de las filas, sin ningún valor del caso
    expect(loop()).not.toMatch(/\d/);
    // tampoco al cambiar de caso en modo alumno (la pestaña ya cargada sigue recibiendo el aviso)
    sim.patient = { id: 'cirrhosis-pulmonary-hypertension' };
    tab.onSimulatorChanged();
    ctx.sync();
    expect(loop()).not.toMatch(/\d/);
    expect(notes()).toBe('');
    // y al volver al modo docente, todo otra vez
    store.set({ debug: true });
    ctx.sync();
    expect(notes()).toContain('La porta subestima');
    expect(loop()).toContain('caso 14.0');
  });
});
