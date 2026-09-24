import { describe, expect, it } from 'vitest';
import { GpuPassTimer, summarizeGpuTimings } from '../ultrasound/gpuTimer';
import { FRAME_PASSES, passGraphErrors, type PassId, type PassSpec, type Resource } from '../ultrasound/passGraph';
import {
  FRAG_AXIAL,
  FRAG_BLIT,
  FRAG_COLOR,
  FRAG_COMPOUND,
  FRAG_LATERAL,
  FRAG_PERSIST,
  FRAG_RAWFIELD,
  FRAG_SCANCONVERT,
  FRAG_TRANS_HITS,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_SEGMENTS,
  FRAG_TRANSMISSION,
} from '../ultrasound/shaders/passes.glsl';

describe('grafo de pasadas del renderer', () => {
  it('la tabla del renderer es un grafo válido: A → B → C → D → K → (F) → G → persistencia → pantalla', () => {
    expect(passGraphErrors(FRAME_PASSES)).toEqual([]);
    expect(FRAME_PASSES.map((p) => p.label).join(' ')).toBe('A0 A1 A2 A B C D K F G P S');
  });

  const without = (id: string) => FRAME_PASSES.filter((p) => p.id !== id);
  const at = (id: string) => FRAME_PASSES.findIndex((p) => p.id === id);
  const swap = (a: number, b: number) => {
    const out = [...FRAME_PASSES];
    [out[a], out[b]] = [out[b], out[a]];
    return out;
  };

  it('detecta una pasada que lee antes de que exista su entrada', () => {
    // la convolución axial antes del campo crudo
    expect(passGraphErrors(swap(at('rawField'), at('axial'))).join('\n')).toMatch(/axial lee «raw»/);
    // la suma acumulada de la transmisión antes de sus segmentos
    expect(passGraphErrors(swap(at('transmissionSegments'), at('transmissionPrefix'))).join('\n')).toMatch(
      /transmissionPrefix lee «transSeg»/,
    );
    // sin la composición (K), nadie escribe la envolvente que convierte G; sin la lateral (D), nadie lee la
    // convolución axial
    expect(passGraphErrors(without('compound')).join('\n')).toMatch(/scanConvert lee «env»/);
    expect(passGraphErrors(without('lateral')).join('\n')).toMatch(/nadie lee lo que escribe axial/);
  });

  // Composición espacial (decisión 58, T7): el anillo de miradas es una historia externa, así que la regla de
  // «leer antes de que exista» no la ve; la guarda propia de las historias sí
  it('K antes de D compondría las miradas del cuadro anterior: lo detecta', () => {
    expect(passGraphErrors(swap(at('lateral'), at('compound'))).join('\n')).toMatch(
      /compound lee «envLooks» antes de que lateral lo escriba en el cuadro/,
    );
  });

  it('D escribiendo la envolvente a la vez que K: dos escritores', () => {
    const both = FRAME_PASSES.map((p): PassSpec => (p.id === 'lateral' ? { ...p, writes: 'env' } : p));
    expect(passGraphErrors(both).join('\n')).toMatch(/«env» lo escriben lateral y compound/);
  });

  it('el color de cadencia propia puede leerse del cuadro anterior; uno de cada cuadro no', () => {
    expect(passGraphErrors(without('color')).join('\n')).toMatch(/scanConvert lee «color»/);
    const colorEachFrame = FRAME_PASSES.map((p): PassSpec => (p.id === 'color' ? { ...p, cadence: 'frame' } : p));
    expect(passGraphErrors(colorEachFrame)).toEqual([]);
    // movida detrás de G y de cadencia de cuadro, G leería un color que aún no existe
    const late = [...colorEachFrame.filter((p) => p.id !== 'color'), colorEachFrame.find((p) => p.id === 'color')!];
    expect(passGraphErrors(late).join('\n')).toMatch(/scanConvert lee «color»/);
  });

  it('detecta dos escritores, pasadas muertas y la falta de salida a pantalla', () => {
    const dup: PassSpec = { id: 'axial', label: 'C2', reads: ['raw'], writes: 'axial', cadence: 'frame' };
    expect(passGraphErrors([...FRAME_PASSES.slice(0, 3), dup, ...FRAME_PASSES.slice(3)]).join('\n')).toMatch(/repetida|lo escriben/);
    const dead: PassSpec[] = [...FRAME_PASSES.slice(0, 4), { id: 'color', label: 'X', reads: ['env'], writes: 'axial', cadence: 'frame' }];
    expect(passGraphErrors(dead).length).toBeGreaterThan(0);
    expect(passGraphErrors(without('present')).join('\n')).toMatch(/pantalla/);
  });
});

/** WebGL2 mínimo para el temporizador: consultas con disponibilidad y resultado programables. */
function fakeGl(opts: { ext: boolean }) {
  const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  let next = 0;
  const state = { disjoint: false, open: 0, created: 0, deleted: 0 };
  const results = new Map<number, { available: boolean; ns: number }>();
  const gl = {
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    getExtension: () => (opts.ext ? EXT : null),
    createQuery: () => {
      state.created++;
      const q = { id: next++ };
      results.set(q.id, { available: false, ns: 0 });
      return q;
    },
    deleteQuery: () => void state.deleted++,
    // como WebGL: reabrir una consulta la deja sin resultado hasta que la GPU termine
    beginQuery: (_target: number, q: { id: number }) => {
      if (state.open) throw new Error('consulta anidada');
      state.open = 1;
      results.set(q.id, { available: false, ns: 0 });
    },
    endQuery: () => void (state.open = 0),
    getParameter: (p: number) => (p === EXT.GPU_DISJOINT_EXT ? state.disjoint : 0),
    getQueryParameter: (q: { id: number }, p: number) => {
      const r = results.get(q.id)!;
      return p === 0x8867 ? r.available : r.ns;
    },
  };
  const finish = (ns: number) => {
    for (const r of results.values())
      if (!r.available) {
        r.available = true;
        r.ns = ns;
      }
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state, finish };
}

describe('GpuPassTimer', () => {
  it('sin la extensión no mide nada y lo dice', () => {
    const { gl, state } = fakeGl({ ext: false });
    const t = new GpuPassTimer<'a'>(gl);
    t.begin('a');
    t.end();
    t.poll();
    expect(t.supported).toBe(false);
    expect(t.timings()).toBeNull();
    expect(state.created).toBe(0);
  });

  it('no bloquea: un resultado aún no disponible se lee en un poll posterior; media exponencial', () => {
    const { gl, finish } = fakeGl({ ext: true });
    const t = new GpuPassTimer<'a' | 'b'>(gl, 0.5);
    t.begin('a');
    t.end();
    t.begin('b');
    t.end();
    t.poll();
    expect(t.timings()).toEqual({});
    finish(2e6);
    t.poll();
    expect(t.timings()).toEqual({ a: 2, b: 2 });
    t.begin('a');
    t.end();
    finish(4e6);
    t.poll();
    expect(t.timings()!.a).toBeCloseTo(3, 9);
  });

  it('descarta los intervalos «disjoint», reutiliza consultas y libera todo al cerrar', () => {
    const { gl, state, finish } = fakeGl({ ext: true });
    const t = new GpuPassTimer<'a'>(gl);
    t.begin('a');
    t.end();
    state.disjoint = true;
    finish(9e6);
    t.poll();
    expect(t.timings()).toEqual({});
    state.disjoint = false;
    t.begin('a');
    t.end();
    expect(state.created).toBe(1);
    t.dispose();
    expect(state.deleted).toBe(1);
  });

  it('deja de abrir consultas si el driver nunca devuelve resultados', () => {
    const { gl, state } = fakeGl({ ext: true });
    const t = new GpuPassTimer<'a'>(gl);
    for (let i = 0; i < 200; i++) {
      t.begin('a');
      t.end();
      t.poll();
    }
    expect(state.created).toBe(64);
  });
});

describe('summarizeGpuTimings', () => {
  it('con resolución por pasada suma las pasadas', () => {
    const t = { rawField: 6, present: 0.2, axial: 0.8 };
    expect(summarizeGpuTimings(t, 'rawField', 'present')).toEqual({ frameMs: 7, perPass: t });
  });

  it('si cada consulta devuelve el cuadro entero (ANGLE/Metal, medido: todas ≈ 18 ms), solo da el total', () => {
    const t = { transmission: 17.9, rawField: 18.3, axial: 18.2, present: 18.6 };
    expect(summarizeGpuTimings(t, 'rawField', 'present')).toEqual({ frameMs: 18.6, perPass: null });
  });

  it('sin temporizadores o sin medidas de referencia no inventa nada', () => {
    expect(summarizeGpuTimings(null, 'rawField', 'present')).toBeNull();
    expect(summarizeGpuTimings({ rawField: 5 }, 'rawField', 'present')).toBeNull();
  });
});

/**
 * Lo que cada pasada declara leer frente a lo que su shader muestrea (decisión 58, T7): la tabla dice qué
 * recurso lee cada sampler del shader de cada pasada; los de la escena y el acoplamiento (uSceneTex,
 * uCoupling) van en el preludio común y no cuentan. Un sampler nuevo sin fila, una lectura sin declarar
 * o una declarada sin sampler son errores: el grafo no puede mentir sobre sus dependencias.
 */
const SAMPLERS: Record<PassId, { src: string; samplers: Record<string, Resource> }> = {
  transmissionHits: { src: FRAG_TRANS_HITS, samplers: {} },
  transmissionSegments: { src: FRAG_TRANS_SEGMENTS, samplers: { uHits0: 'transHits', uHits1: 'transHits' } },
  transmissionPrefix: { src: FRAG_TRANS_PREFIX, samplers: { uSeg: 'transSeg', uHits0: 'transHits', uHits1: 'transHits' } },
  transmission: {
    src: FRAG_TRANSMISSION,
    samplers: { uPre0: 'transPrefix', uPre1: 'transPrefix', uPreSteer: 'transPrefix', uPreSteerX: 'transPrefix', uHits0: 'transHits' },
  },
  rawField: { src: FRAG_RAWFIELD, samplers: { uTrans0: 'trans', uTrans1: 'trans', uTrans3: 'trans' } },
  axial: { src: FRAG_AXIAL, samplers: { uField: 'raw' } },
  lateral: { src: FRAG_LATERAL, samplers: { uField: 'axial' } },
  compound: { src: FRAG_COMPOUND, samplers: { uLook0: 'envLooks', uLook1: 'envLooks', uLook2: 'envLooks' } },
  color: { src: FRAG_COLOR, samplers: { uTrans0: 'trans' } },
  scanConvert: { src: FRAG_SCANCONVERT, samplers: { uEnv: 'env', uColor: 'color' } },
  persistence: { src: FRAG_PERSIST, samplers: { uCur: 'scan', uPrev: 'persist' } },
  present: { src: FRAG_BLIT, samplers: { uTex: 'persist' } },
};
const PRELUDE_SAMPLERS = new Set(['uSceneTex', 'uCoupling']);
const PRELUDE_RESOURCES = new Set<Resource>(['scene', 'coupling']);

function samplerErrors(passes: readonly PassSpec[]): string[] {
  const errors: string[] = [];
  for (const p of passes) {
    const { src, samplers } = SAMPLERS[p.id];
    const declared = [...src.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+sampler2D\s+(\w+)/g)].map((m) => m[1]);
    for (const name of declared) {
      if (PRELUDE_SAMPLERS.has(name)) continue;
      const r = samplers[name];
      if (r === undefined) errors.push(`${p.id}: el sampler ${name} no está en la tabla`);
      else if (!p.reads.includes(r)) errors.push(`${p.id} muestrea ${name} («${r}») sin declararlo`);
    }
    for (const r of p.reads)
      if (!PRELUDE_RESOURCES.has(r) && !declared.some((n) => samplers[n] === r))
        errors.push(`${p.id} declara leer «${r}» y no lo muestrea`);
  }
  return errors;
}

describe('las lecturas declaradas son las de los shaders', () => {
  it('cada pasada muestrea exactamente lo que declara el grafo', () => {
    expect(samplerErrors(FRAME_PASSES)).toEqual([]);
  });

  it('B sin leer la transmisión (su rama dirigida muestrea uTrans3): lo detecta', () => {
    const blind = FRAME_PASSES.map((p): PassSpec => (p.id === 'rawField' ? { ...p, reads: ['scene'] } : p));
    expect(samplerErrors(blind).join('\n')).toMatch(/rawField muestrea uTrans0 \(«trans»\) sin declararlo/);
    expect(samplerErrors(blind).join('\n')).toMatch(/rawField muestrea uTrans3 \(«trans»\) sin declararlo/);
    // y K sin declarar el anillo
    const k = FRAME_PASSES.map((p): PassSpec => (p.id === 'compound' ? { ...p, reads: [] } : p));
    expect(samplerErrors(k).join('\n')).toMatch(/compound muestrea uLook0 \(«envLooks»\) sin declararlo/);
  });
});
