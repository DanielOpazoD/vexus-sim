import { describe, expect, it } from 'vitest';
import { GpuPassTimer, summarizeGpuTimings } from '../ultrasound/gpuTimer';
import { FRAME_PASSES, passGraphErrors, type PassSpec } from '../ultrasound/passGraph';

describe('grafo de pasadas del renderer', () => {
  it('la tabla del renderer es un grafo válido: A → B → C → D → (F) → G → persistencia → pantalla', () => {
    expect(passGraphErrors(FRAME_PASSES)).toEqual([]);
    expect(FRAME_PASSES.map((p) => p.label).join('')).toBe('ABCDFGPS');
  });

  const without = (id: string) => FRAME_PASSES.filter((p) => p.id !== id);
  const swap = (a: number, b: number) => {
    const out = [...FRAME_PASSES];
    [out[a], out[b]] = [out[b], out[a]];
    return out;
  };

  it('detecta una pasada que lee antes de que exista su entrada', () => {
    // la convolución axial antes del campo crudo
    expect(passGraphErrors(swap(1, 2)).join('\n')).toMatch(/axial lee «raw»/);
    // sin la lateral, nadie escribe la envolvente que convierte G
    expect(passGraphErrors(without('lateral')).join('\n')).toMatch(/scanConvert lee «env»/);
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
