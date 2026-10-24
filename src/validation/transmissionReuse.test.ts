import { describe, expect, it, vi } from 'vitest';
import { NODE_BASE, SCENE_TEX_W, TUBE_HEADER_TEXELS } from '../anatomy/gpu/anatomy.glsl';
import { Simulator } from '../app/simulator';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import type { FrameInputs, PassRepeat } from '../ultrasound/renderer';
import { TransmissionReuse } from '../ultrasound/transmissionReuse';
import { recordingGl } from './support/recordingGl';

describe('TransmissionReuse: entradas GPU exactas, sin alias de memoria', () => {
  it('conserva una instantánea independiente y distingue valor, forma y cero con signo', () => {
    const reuse = new TransmissionReuse();
    const blocks = [new Float32Array([0, 1]), new Float32Array([2])];
    expect(reuse.matches(blocks)).toBe(false);
    reuse.remember(blocks);
    blocks[0][1] = 3;
    expect(reuse.matches(blocks)).toBe(false);
    expect(reuse.matches([new Float32Array([0, 1]), new Float32Array([2])])).toBe(true);
    expect(reuse.matches([new Float32Array([-0, 1]), new Float32Array([2])])).toBe(false);
    expect(reuse.matches([new Float32Array([0]), new Float32Array([1, 2])])).toBe(false);
    expect(reuse.matches([new Float32Array([0, 1, 2])])).toBe(false);
    reuse.clear();
    expect(reuse.matches([new Float32Array([0, 1]), new Float32Array([2])])).toBe(false);
  });

  it('una entrada no finita nunca autoriza reutilizar, aunque se recuerden los mismos bytes', () => {
    const reuse = new TransmissionReuse();
    for (const value of [NaN, Infinity, -Infinity]) {
      const blocks = [new Float32Array([value])];
      reuse.remember(blocks);
      expect(reuse.matches(blocks)).toBe(false);
    }
  });
});

/** Renderer real sobre recordingGl: se comprueba el protocolo, no imágenes de sus lecturas ficticias. */
function rig() {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  sim.equipment = { ...sim.equipment, bmode: { ...sim.bmode, compound: false } };
  const inputs: FrameInputs = {
    sample: sim.sample,
    frame: sim.frame,
    pose: sim.pose,
    compression: sim.contact,
    transducer: sim.transducer,
    caliber: sim.anatomy.caliberFor(sim.sample),
    probeVelocity: sim.probeVelocity,
    bmode: sim.bmode,
    color: sim.color,
    updateColor: true,
    seed: sim.patient.seed,
  };
  const render = (next = inputs, repeat?: PassRepeat) => {
    rec.draws.length = 0;
    sim.renderer.render(next, repeat);
    return rec.draws.slice();
  };
  const initial = render();
  const programs = initial.slice(0, 2).map((d) => d.program);
  expect(sim.renderer.transmissionHitsPipeline).toBe('line');
  const geometry = (draws: typeof initial) => draws.filter((d) => programs.includes(d.program));
  return { ...rec, sim, inputs, initial, programs, render, geometry };
}

function changedCompression(inputs: FrameInputs): FrameInputs['compression'] {
  const nodes = inputs.compression.nodes.map((n): [number, number, number] => [...n]);
  // Solo cambia la tabla; centro, ejes, alcance y acoplamiento permanecen iguales.
  // Reducir s0 conserva s0 <= sD y no cambia el alcance, que depende de sD y D.
  nodes[Math.floor(nodes.length / 2)][0] -= 0.25;
  return { ...inputs.compression, nodes };
}

describe('A0/A1: invalidación desde las entradas efectivas del renderer', () => {
  it('detecta un nodo de compresión sin cambios de haz ni uniforms geométricos', () => {
    const r = rig();
    expect(r.geometry(r.render())).toHaveLength(0);
    const changed = { ...r.inputs, compression: changedCompression(r.inputs) };
    const next = r.render(changed);
    expect(r.geometry(next)).toHaveLength(2);
    expect(next[0].uniforms).toEqual(r.initial[0].uniforms);
    expect(r.geometry(r.render(changed))).toHaveLength(0);
  });

  it('detecta exclusivamente profundidad y reutiliza objetos nuevos con los mismos valores', () => {
    const r = rig();
    const changed = { ...r.inputs, bmode: { ...r.inputs.bmode, depthMm: r.inputs.bmode.depthMm + 10 } };
    const next = r.render(changed);
    expect(r.geometry(next)).toHaveLength(2);
    expect(next[0].uniforms.uDepth).toEqual([changed.bmode.depthMm]);
    expect(r.geometry(r.render({ ...changed, bmode: { ...changed.bmode } }))).toHaveLength(0);
  });

  it('reevalúa el mismo callable de calibre antes de decidir un hit', () => {
    const r = rig();
    let factor = 1;
    const radiusScale = vi.fn((id: Parameters<FrameInputs['caliber']['radiusScale']>[0]) => r.inputs.caliber.radiusScale(id) * factor);
    const changed = { ...r.inputs, caliber: { ...r.inputs.caliber, radiusScale } };
    expect(r.geometry(r.render(changed))).toHaveLength(0);
    radiusScale.mockClear();
    factor = 1.2;
    expect(r.geometry(r.render(changed))).toHaveLength(2);
    expect(radiusScale).toHaveBeenCalled();
    expect(r.geometry(r.render(changed))).toHaveLength(0);
  });

  it('restaura cabeceras y compresión tras queryPoints con allTubes y otro estado', () => {
    const r = rig();
    const gl = r.sim.renderer.gl;
    const upload = Reflect.get(gl, 'texSubImage2D');
    const uploads: { y: unknown; values: Float32Array }[] = [];
    gl.texSubImage2D = (...args: unknown[]) => {
      const values = args.at(-1);
      if (values instanceof Float32Array) uploads.push({ y: args[3], values: values.slice() });
      Reflect.apply(upload, gl, args);
    };
    try {
      r.render(r.inputs, { pass: 'transmissionSegments', times: 0 });
      const headerLength = Math.ceil(NODE_BASE / SCENE_TEX_W) * SCENE_TEX_W * 4;
      const activeFloats = r.initial[0].uniforms.uTubeCount[0] * TUBE_HEADER_TEXELS * 4;
      const header = () =>
        uploads
          .filter((u) => u.y === 0 && u.values.length === headerLength)
          .at(-1)!
          .values.subarray(0, activeFloats);
      const originalHeaders = header().slice();
      const other = {
        ...r.inputs,
        compression: changedCompression(r.inputs),
        caliber: { ...r.inputs.caliber, radiusScale: () => 1.3 },
      };
      r.sim.renderer.queryPoints(new Float32Array([0, 0, 0]), other, true);
      expect(header()).not.toEqual(originalHeaders);
      uploads.length = 0;
      const restored = r.render();
      expect(header()).toEqual(originalHeaders);
      // Las consultas no escriben A0/A1; lo exigible es restaurar sus entradas,
      // no un miss artificial. B debe recibir otra vez la compresión original.
      const raw = restored.find((d) => d.program === r.initial[4].program)!;
      expect(raw.uniforms.uCompC).toEqual(r.initial[4].uniforms.uCompC);
      expect(raw.uniforms.uCompAx).toEqual(r.initial[4].uniforms.uCompAx);
      expect(
        uploads.some((u) => u.y !== 0),
        'tabla de compresión restaurada',
      ).toBe(true);
      expect(r.misuse).toEqual([]);
    } finally {
      gl.texSubImage2D = upload;
    }
  });

  it.each(['same', 'previous'] as const)('tras fallo de A1 recompone el estado %s y setScene invalida la misma escena', (retry) => {
    const r = rig();
    const gl = r.sim.renderer.gl;
    const use = Reflect.get(gl, 'useProgram'),
      draw = Reflect.get(gl, 'drawArrays');
    let current: WebGLProgram | null = null;
    gl.useProgram = (program) => {
      current = program;
      use.call(gl, program);
    };
    gl.drawArrays = (...args) => {
      if (current === (r.programs[1] as unknown as WebGLProgram)) throw new Error('A1 interrumpida');
      Reflect.apply(draw, gl, args);
    };
    const changed = { ...r.inputs, bmode: { ...r.inputs.bmode, depthMm: r.inputs.bmode.depthMm + 10 } };
    try {
      expect(() => r.render(changed)).toThrow('A1 interrumpida');
    } finally {
      gl.drawArrays = draw;
      gl.useProgram = use;
    }
    // Con fixture nuevo en cada rama: ni confirmar B antes de A1 ni rescatar A
    // después de que A0 se sobrescribiera puede autorizar este primer reintento.
    const firstRetry = retry === 'same' ? changed : r.inputs;
    expect(r.geometry(r.render(firstRetry))).toHaveLength(2);
    expect(r.geometry(r.render(firstRetry))).toHaveLength(0);
    r.sim.renderer.setScene(r.sim.scene);
    expect(r.geometry(r.render(firstRetry))).toHaveLength(2);
  });

  for (const [index, pass] of ['transmissionHits', 'transmissionSegments'].entries())
    it(`repeat de ${pass} conserva el pase real y sus uniforms después de un hit`, () => {
      const r = rig();
      expect(r.geometry(r.render())).toHaveLength(0);
      const repeated = r.render(r.inputs, { pass: pass as PassRepeat['pass'], times: 2 });
      expect(repeated).toHaveLength(r.initial.length + 2);
      const own = repeated[index],
        extra = repeated.slice(index + 1, index + 3);
      expect(own.program).toBe(r.programs[index]);
      for (const d of extra) {
        expect(d.program).toBe(own.program);
        expect(d.uniforms).toEqual(own.uniforms);
        expect(d.units).toBe(own.units);
        expect(d.fbo).not.toBe(own.fbo);
      }
      expect(extra[0].fbo).not.toBe(extra[1].fbo);
      expect(r.misuse).toEqual([]);
    });
});
