import { describe, expect, it } from 'vitest';
import { EquipmentController, type EquipmentCommand } from '../app/equipment';
import { Simulator, defaultEquipment } from '../app/simulator';
import { createTestHooks } from '../app/testHooks';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { COMPOUND, lookSalt, lookTheta } from '../ultrasound/compound';
import {
  FRAG_COMPOUND,
  FRAG_LATERAL,
  FRAG_RAWFIELD,
  FRAG_RAWFIELD_STEERED,
  FRAG_SCANCONVERT,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_PREFIX_STEERED,
  FRAG_TRANSMISSION,
  FRAG_TRANSMISSION_STEERED,
} from '../ultrasound/shaders/passes.glsl';
import { lookWavenumber } from '../ultrasound/steering';
import { recordingGl } from './support/recordingGl';

/**
 * Cableado de la composición espacial en el renderizador real sobre un WebGL falso (decisión 58): cada
 * cuadro de una mirada dirigida dibuja A2, A y B con sus programas dirigidos, que reciben la mirada (uSteer,
 * uLookSalt); los de la mirada 0 son los de siempre y no la reciben. D escribe en la ranura del anillo de
 * esa mirada, K lee las tres ranuras con su validez y G convierte la salida de K. Con el compuesto apagado o
 * el color encendido, cada cuadro es la mirada 0 y K pasa la envolvente de D. Las lecturas de prueba
 * (`readEnvelope`, `readTransmission`, `readLookEnvelope`) se niegan a devolver en silencio los datos de
 * otro cuadro. La imagen en sí la miden la e2e y el banco (GPU).
 */
const PAIRS = {
  prefix: [FRAG_TRANS_PREFIX, FRAG_TRANS_PREFIX_STEERED],
  trans: [FRAG_TRANSMISSION, FRAG_TRANSMISSION_STEERED],
  raw: [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED],
} as const;
type PairId = keyof typeof PAIRS;
const PAIR_IDS = Object.keys(PAIRS) as PairId[];

function rig(compound = true) {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound } };
  // con la caja de color, la cadencia del color saltaría los cuadros con el reloj quieto: se fuerza
  const frame = () => {
    rec.draws.length = 0;
    sim.render(sim.color.enabled ? { forceColor: true } : undefined);
    const by = (...frags: readonly string[]) => {
      const d = rec.draws.filter((x) => frags.includes(x.frag));
      expect(d.length, 'un dibujo por pasada').toBe(1);
      return d[0];
    };
    return {
      prefix: by(...PAIRS.prefix),
      trans: by(...PAIRS.trans),
      raw: by(...PAIRS.raw),
      lateral: by(FRAG_LATERAL),
      k: by(FRAG_COMPOUND),
      scan: by(FRAG_SCANCONVERT),
    };
  };
  return { ...rec, sim, frame };
}

const K2 = lookWavenumber();
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));

describe('composición espacial en el renderizador (WebGL falso)', () => {
  it('encendido: miradas 0, +θ, −θ por cuadro, cada una en su ranura, y K compone las válidas', () => {
    const { sim, frame, fboTextures } = rig(true);
    const R = sim.transducer.curvatureRadius;
    const frames = [frame(), frame(), frame(), frame()];
    const fbos = frames.map((f) => f.lateral.fbo);
    // tres ranuras distintas y la cuarta mirada vuelve a la primera
    expect(new Set(fbos.slice(0, 3)).size).toBe(3);
    expect(fbos[3]).toBe(fbos[0]);
    frames.forEach((f, i) => {
      const look = i % COMPOUND.order.length;
      const th = lookTheta(look);
      // la mirada 0 con los programas de siempre, sin la mirada; las dirigidas con los suyos, con ella
      for (const id of PAIR_IDS) {
        expect(f[id].frag, `${id}, mirada ${look}`).toBe(PAIRS[id][look === 0 ? 0 : 1]);
        if (look === 0) expect(f[id].uniforms.uSteer).toBeUndefined();
        else close(f[id].uniforms.uSteer, [th, R * Math.sin(th), R * Math.cos(th), K2]);
      }
      if (look === 0) expect(f.raw.uniforms.uLookSalt).toBeUndefined();
      else expect(f.raw.uniforms.uLookSalt[0]).toBeCloseTo(lookSalt(look), 12);
      // K: las tres ranuras, sus θ y su validez tras escribir la de este cuadro
      close(
        f.k.uniforms.uLookSteer,
        COMPOUND.order.map((_, j) => lookTheta(j)),
      );
      expect(f.k.uniforms.uLookValid).toEqual([1, i >= 1 ? 1 : 0, i >= 2 ? 1 : 0]);
      // G convierte la salida de K, no la de D
      expect(f.scan.fbo).not.toBe(f.lateral.fbo);
    });
    // K muestrea las texturas de las tres ranuras (unidades 0, 1, 2) y escribe otro destino
    const ringTex = fbos.slice(0, 3).map((fbo) => fboTextures.get(fbo!)![0].id);
    expect(frames[2].k.units.split(' ').slice(0, 3)).toEqual(ringTex.map((t, i) => `${i}:${t}`));
    expect(fbos.slice(0, 3)).not.toContain(frames[2].k.fbo);
    const st = sim.renderer.compoundState();
    expect(st).toEqual({ active: true, look: 0, theta: 0, valid: [true, true, true], validCount: 3, resets: 1 });
  });

  it('apagado, o con el color encendido, cada cuadro es la mirada 0 en la misma ranura y K la pasa tal cual', () => {
    for (const color of [false, true]) {
      // sin color, con el conmutador apagado; con color, con el conmutador encendido (la regla lo apaga)
      const { sim, frame } = rig(color);
      if (color) sim.equipment = { ...sim.equipment, color: { ...sim.equipment.color, enabled: true } };
      const fs = [frame(), frame(), frame()];
      expect(new Set(fs.map((f) => f.lateral.fbo)).size).toBe(1);
      for (const f of fs) {
        // los programas de la mirada 0, que no declaran la mirada ni la reciben
        for (const id of PAIR_IDS) {
          expect(f[id].frag, id).toBe(PAIRS[id][0]);
          expect(f[id].uniforms.uSteer).toBeUndefined();
        }
        expect(f.raw.uniforms.uLookSalt).toBeUndefined();
        expect(f.k.uniforms.uLookValid).toEqual([1, 0, 0]);
      }
      expect(sim.renderer.compoundState()).toMatchObject({ active: false, look: 0, validCount: 1 });
      // la mirada 0 es la del último cuadro: la guarda de una mirada puede leerla
      expect(() => sim.renderer.readEnvelope()).not.toThrow();
    }
  });

  it('un cambio de profundidad, de escena o de modo reinicia el anillo con la mirada 0', () => {
    const { sim, frame } = rig(true);
    frame();
    frame();
    const deeper = () => (sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, depthMm: 150 } });
    deeper();
    expect(frame().k.uniforms.uLookValid).toEqual([1, 0, 0]);
    expect(frame().raw.uniforms.uSteer[0]).toBeCloseTo(lookTheta(1), 12);
    sim.renderer.setScene(sim.scene);
    expect(frame().raw.frag).toBe(FRAG_RAWFIELD);
    frame();
    sim.equipment = { ...sim.equipment, color: { ...sim.equipment.color, enabled: true } };
    expect(frame().k.uniforms.uLookValid).toEqual([1, 0, 0]);
    expect(sim.renderer.compoundState().resets).toBe(4);
  });

  it('las lecturas de prueba no devuelven en silencio datos de otro cuadro', () => {
    const { sim, frame } = rig(true);
    frame(); // mirada 0
    expect(() => sim.renderer.readEnvelope()).not.toThrow();
    expect(() => sim.renderer.readLookEnvelope(1)).toThrow(/no tiene una mirada válida/);
    expect(() => sim.renderer.readTransmission({ look: 1 })).toThrow(/no es la del último cuadro/);
    frame(); // mirada +θ
    expect(() => sim.renderer.readEnvelope()).toThrow(/la mirada 0 no es del último cuadro/);
    expect(() => sim.renderer.readEnvelope({ source: 'compound' })).not.toThrow();
    expect(sim.renderer.readLookEnvelope(1).theta).toBeCloseTo(lookTheta(1), 15);
    expect(sim.renderer.readTransmission({ look: 1 }).look).toBe(1);
    // la transmisión de la mirada 0 se calcula en todos los cuadros
    expect(sim.renderer.readTransmission().look).toBe(0);
    expect(() => sim.renderer.readTransmission({ look: 2 })).toThrow(/no es la del último cuadro/);
    expect(() => sim.renderer.readLookEnvelope(3)).toThrow(/fuera del anillo/);
  });
});

/** Uniforms que declara un shader (samplers incluidos), sin los comentarios. */
const declaredUniforms = (src: string): string[] =>
  [...src.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)/g)].map((m) => m[2]);
const declaredSamplers = (src: string): string[] =>
  [...src.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].map((m) => m[1]);

/** Textura puesta en la unidad de un sampler en un dibujo (`units`: «unidad:id» separados por espacios). */
function samplerTexture(d: { units: string; uniforms: Record<string, number[]> }, sampler: string): number | undefined {
  const unit = d.uniforms[sampler]?.[0];
  const hit = d.units.split(' ').find((u) => u.startsWith(`${unit}:`));
  return hit === undefined ? undefined : Number(hit.split(':')[1]);
}

/**
 * Dos programas por pasada con miradas (decisión 58): la rama dirigida compilada dentro del programa de la
 * mirada 0 le costaba a B ~2 ms por cuadro aun con el compuesto apagado, así que A2, A y B tienen un programa
 * de la mirada 0 (el de siempre) y otro dirigido, y el renderizador elige uno por cuadro. Una subida que falta
 * es un no-op silencioso de WebGL (el sampler leería la unidad 0): cada programa debe recibir todo lo que
 * declara, del programa puesto, y cada sampler la textura que le toca.
 */
describe('dos programas por pasada con miradas (WebGL falso)', () => {
  it('cada programa recibe todos los uniforms y samplers que declara, del programa puesto y con su textura', () => {
    const { frame, misuse, fboTextures } = rig(true);
    const f0 = frame(); // mirada 0: el primer dibujo de los programas de la mirada 0
    const f1 = frame(); // +θ: el primer dibujo de los dirigidos
    for (const [f, k] of [
      [f0, 0],
      [f1, 1],
    ] as const)
      for (const id of PAIR_IDS) {
        const d = f[id];
        expect(d.frag, id).toBe(PAIRS[id][k]);
        const got = Object.keys(d.uniforms);
        expect(
          declaredUniforms(d.frag).filter((u) => !got.includes(u)),
          `${id}, programa ${k === 0 ? 'de la mirada 0' : 'dirigido'}: uniforms sin subir`,
        ).toEqual([]);
        // cada sampler en su unidad, con una textura puesta y sin compartir unidad con otro
        const samplers = declaredSamplers(d.frag);
        expect(new Set(samplers.map((n) => d.uniforms[n][0])).size, id).toBe(samplers.length);
        for (const n of samplers) expect(samplerTexture(d, n), `${id}: ${n}`).toBeDefined();
      }
    // las salidas de la mirada dirigida llegan a quien las lee: A2 o2/o3 → A, A o1/o3 → B
    const pre = fboTextures.get(f1.prefix.fbo!)!.map((t) => t.id);
    const tr = fboTextures.get(f1.trans.fbo!)!.map((t) => t.id);
    expect(samplerTexture(f1.trans, 'uPreSteer')).toBe(pre[2]);
    expect(samplerTexture(f1.trans, 'uPreSteerX')).toBe(pre[3]);
    expect(samplerTexture(f1.raw, 'uTrans1')).toBe(tr[1]);
    expect(samplerTexture(f1.raw, 'uTrans3')).toBe(tr[3]);
    expect(samplerTexture(f0.raw, 'uTrans0')).toBe(fboTextures.get(f0.trans.fbo!)![0].id);
    // ningún uniform fue a un programa que no estaba puesto (WebGL lo habría descartado)
    frame();
    frame();
    expect(misuse).toEqual([]);
  });

  it('la mirada del cuadro elige el programa: dos por pasada, el de la mirada 0 vuelve en el cuarto cuadro', () => {
    const { frame } = rig(true);
    const fs = [frame(), frame(), frame(), frame()];
    for (const id of PAIR_IDS) {
      const programs = fs.map((f) => f[id].program);
      expect(programs[0], id).not.toBe(programs[1]);
      expect(programs[2], id).toBe(programs[1]);
      expect(programs[3], id).toBe(programs[0]);
    }
    // con el compuesto apagado, solo el de la mirada 0
    const off = rig(false);
    const gs = [off.frame(), off.frame(), off.frame()];
    for (const id of PAIR_IDS) expect(gs.map((g) => g[id].frag)).toEqual(Array(3).fill(PAIRS[id][0]));
  });

  it('ningún dibujo tiene adjuntos activos sin salida en su programa (WebGL no dibujaría), en las tres miradas y apagado', () => {
    // A2 y A de la mirada 0 escriben 2 y 3 de los 4 adjuntos de su destino: con los 4 activos, WebGL
    // rechaza el dibujo y el destino conserva el cuadro anterior (la transmisión, el espejo y el hueso
    // de la mirada 0 salían de la dirigida anterior: paridad a 407 dB y espejo a 99 mm en la e2e)
    for (const compound of [true, false]) {
      const { frame, misuse, sim } = rig(compound);
      for (let i = 0; i < 4; i++) frame();
      for (let i = 0; i < 3; i++) sim.render({ repeat: { pass: 'transmissionPrefix', times: 2 } });
      for (let i = 0; i < 3; i++) sim.render({ repeat: { pass: 'transmission', times: 2 } });
      expect(
        misuse.filter((m) => m.startsWith('dibujo rechazado')),
        `compuesto ${compound}`,
      ).toEqual([]);
    }
  });

  it('repeatPass repite el programa de la mirada del cuadro, no el otro', () => {
    const passes = { prefix: 'transmissionPrefix', trans: 'transmission', raw: 'rawField' } as const;
    for (const id of PAIR_IDS) {
      const { sim, draws } = rig(true);
      for (let look = 0; look < COMPOUND.order.length; look++) {
        draws.length = 0;
        sim.render({ repeat: { pass: passes[id], times: 2 } });
        const d = draws.filter((x) => (PAIRS[id] as readonly string[]).includes(x.frag));
        expect(d.length, `${id}, mirada ${look}`).toBe(3);
        expect(d[0].frag).toBe(PAIRS[id][look === 0 ? 0 : 1]);
        expect(new Set(d.map((x) => x.program)).size).toBe(1);
        expect(d.slice(1).every((x) => x.fbo !== d[0].fbo && x.units === d[0].units)).toBe(true);
      }
    }
  });

  it('la pérdida de contexto: la reconstrucción libera los seis programas y el renderizador nuevo usa los suyos', () => {
    const { sim, frame, deleted, canvas } = rig(true);
    const before = [frame(), frame()];
    const old = new Set(before.flatMap((f) => PAIR_IDS.map((id) => f[id].program)));
    expect(old.size).toBe(6);
    sim.rebuildRenderer(canvas);
    for (const p of old) expect(deleted.has(p!)).toBe(true);
    // el anillo empieza de nuevo: la mirada 0 y luego +θ, con programas nuevos y vivos
    const after = [frame(), frame()];
    after.forEach((f, look) => {
      for (const id of PAIR_IDS) {
        expect(f[id].frag).toBe(PAIRS[id][look]);
        expect(old.has(f[id].program)).toBe(false);
        expect(deleted.has(f[id].program!)).toBe(false);
      }
    });
  });
});

/**
 * Arranque (decisión 58): los programas dirigidos suman tres a los que se compilan al crear el renderizador y
 * al reconstruirlo tras perder el contexto (el de B, otros 46,5 kB de GLSL con la anatomía entera). Consultar el
 * estado de un shader o de un programa bloquea hasta que termina: hacerlo tras cada uno encadenaba las
 * compilaciones de una en una. Se encargan todas y se comprueban después, con KHR_parallel_shader_compile
 * pedida antes de compilar (el navegador puede repartirlas entre sus hilos de fondo), y un fallo lanza con el
 * nombre del programa y su registro y libera todos los del lote.
 */
describe('arranque: los programas se enlazan en lote (WebGL falso)', () => {
  const build = (opts?: Parameters<typeof recordingGl>[1]) => {
    const rec = recordingGl({ width: 320, height: 240 }, opts);
    return { ...rec, make: () => new Simulator(clonePatient(NORMAL_ADULT), rec.canvas) };
  };
  /** Llamadas de `calls` desde `from`: ninguna consulta de estado antes del último enlace y una por programa. */
  const expectBatched = (calls: readonly string[], from: number, programs: number) => {
    const c = calls.slice(from);
    const links = c.flatMap((x, i) => (x === 'linkProgram' ? [i] : []));
    expect(links.length, 'un enlace por programa').toBe(programs);
    const firstQuery = c.findIndex((x) => x === 'getShaderParameter' || x === 'getProgramParameter');
    expect(firstQuery, 'primera consulta de estado tras el último enlace').toBeGreaterThan(links[links.length - 1]);
    expect(c.filter((x) => x === 'getProgramParameter').length, 'cada enlace se comprueba').toBe(programs);
    // el estado de compilación solo se lee si un enlace falla, para el mensaje
    expect(c.filter((x) => x === 'getShaderParameter')).toEqual([]);
  };

  it('al crearse y al reconstruirse: todo encargado antes de la primera consulta, con la extensión pedida antes', () => {
    const { calls, programs, make, canvas } = build();
    const sim = make();
    // los seis de las pasadas con miradas y los demás; el de consulta se crea al usarse
    expect(programs.length).toBeGreaterThan(6);
    expectBatched(calls, 0, programs.length);
    const ext = calls.indexOf('getExtension:KHR_parallel_shader_compile');
    expect(ext, 'extensión pedida').toBeGreaterThanOrEqual(0);
    expect(ext).toBeLessThan(calls.indexOf('compileShader'));
    const [from, before] = [calls.length, programs.length];
    sim.rebuildRenderer(canvas);
    expectBatched(calls, from, programs.length - before);
    expect(programs.length - before).toBe(before);
  });

  it('un fallo de compilación o de enlace lanza con el nombre y el registro y libera todos los del lote', () => {
    const cases = [
      ['compile', /Compilación de rawfieldSteered\.frag:\nERROR: 0:2: falso/],
      ['link', /Enlace de rawfieldSteered: enlace falso/],
    ] as const;
    for (const [stage, message] of cases) {
      const { make, programs, deleted } = build({ fail: { frag: FRAG_RAWFIELD_STEERED, stage } });
      expect(make, stage).toThrow(message);
      expect(programs.length, stage).toBeGreaterThan(6);
      expect(programs.filter((p) => !deleted.has(p)).length, `${stage}: programas sin liberar`).toBe(0);
    }
  });
});

/**
 * Los ganchos de prueba con el compuesto (decisión 58) sobre el renderizador real y el WebGL falso (las
 * lecturas dan ceros: aquí se comprueba el protocolo, no la imagen): llenan el anillo antes de medir, leen
 * la transmisión de cada mirada en su cuadro, dejan el conmutador como estaba y se niegan a medir «el
 * compuesto» cuando no se forma.
 */
describe('ganchos de prueba con el compuesto (WebGL falso)', () => {
  function hookRig() {
    const rec = recordingGl({ width: 320, height: 240 });
    const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
    const equipment = new EquipmentController(defaultEquipment(), {
      halfSectorRad: sim.transducer.halfSector,
      cMmS: C_RECONSTRUCTION_MM_S,
    });
    sim.equipment = equipment.state;
    equipment.subscribe((next) => {
      sim.equipment = next;
    });
    const dispatch = (cmd: EquipmentCommand): void => equipment.dispatch(cmd);
    const lateralDraws = () => rec.draws.filter((d) => d.frag === FRAG_LATERAL).length;
    return { rec, sim, dispatch, hooks: createTestHooks(() => sim, dispatch), lateralDraws };
  }

  it('fidelity con el compuesto llena el anillo, asienta la persistencia y devuelve la composición', () => {
    const { sim, hooks, rec, lateralDraws } = hookRig();
    expect(sim.bmode.compound).toBe(true);
    const s = hooks.fidelity({ compound: true, startPoint: 'subxiphoid', display: true });
    // 3 cuadros para llenar el anillo tras el salto de pose y 5 de persistencia (0,35⁵ < 1 %)
    expect(lateralDraws()).toBe(3 + 5);
    expect(s.compound?.thetas).toEqual(COMPOUND.order.map((_, i) => lookTheta(i)));
    expect(s.compound?.bands.length).toBe(4);
    expect(Number.isNaN(s.display!.shadow.umbraShiftMm)).toBe(true);
    // el último cuadro dibujado fue una mirada del anillo lleno
    expect(sim.renderer.compoundState().validCount).toBe(3);
    rec.draws.length = 0;
    // con el compuesto apagado, un cuadro por medida y ninguna composición; el conmutador vuelve a su sitio
    const one = hooks.fidelity({ compound: false, startPoint: 'subxiphoid' });
    expect(lateralDraws()).toBe(1);
    expect(one.compound).toBeUndefined();
    expect(sim.bmode.compound).toBe(true);
  });

  it('llenar el anillo reescribe las tres ranuras en el instante de la medida, aunque la pose no salte', () => {
    const { sim, hooks, rec } = hookRig();
    hooks.fidelity({ compound: true, startPoint: 'subxiphoid' });
    const resets = sim.renderer.compoundState().resets;
    rec.draws.length = 0;
    hooks.fidelity({ compound: true, startPoint: 'subxiphoid' });
    // la misma pose: el anillo no se reinicia, pero sus tres ranuras se vuelven a escribir antes de medir
    expect(sim.renderer.compoundState().resets).toBe(resets);
    const lateral = rec.draws.filter((d) => d.frag === FRAG_LATERAL).map((d) => d.fbo);
    expect(lateral.length).toBe(3 + 3);
    expect(new Set(lateral.slice(0, 3)).size).toBe(3);
    expect(hooks.envelopeGuard({ startPoint: 'subxiphoid' }).threw).toBe(true);
  });

  it('el compuesto no se mide si no se forma (color) y el conmutador vuelve a como estaba aunque falle', () => {
    const { sim, hooks, dispatch } = hookRig();
    dispatch({ type: 'compound', enabled: false });
    dispatch({ type: 'color', patch: { enabled: true } });
    expect(() => hooks.speckle({ compound: true, startPoint: 'subxiphoid' })).toThrow(/el compuesto no se forma/);
    expect(sim.bmode.compound).toBe(false);
    expect(() => hooks.transmissionParity({ compound: false, look: 1, startPoint: 'subxiphoid' })).toThrow(/exige el compuesto activo/);
  });

  it('la guarda de readEnvelope lanza tras una mirada dirigida; la paridad dirigida mide su mirada', () => {
    const { sim, hooks } = hookRig();
    const g = hooks.envelopeGuard({ startPoint: 'subxiphoid' });
    expect(g.threw).toBe(true);
    expect(g.look).not.toBe(0);
    expect(g.message).toMatch(/la mirada 0 no es del último cuadro/);
    const p = hooks.transmissionParity({ compound: true, look: 2, startPoint: 'subxiphoid', every: 32 });
    expect(sim.renderer.compoundState().look).toBe(2);
    expect(p.lines).toBe(6);
    expect(p.samples + (p.ambiguous ?? 0)).toBeGreaterThan(0);
    expect(hooks.compoundState().active).toBe(true);
  });
});
