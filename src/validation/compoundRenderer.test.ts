import { describe, expect, it } from 'vitest';
import { Simulator } from '../app/simulator';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { COMPOUND, lookSalt, lookTheta } from '../ultrasound/compound';
import {
  FRAG_COMPOUND,
  FRAG_LATERAL,
  FRAG_RAWFIELD,
  FRAG_SCANCONVERT,
  FRAG_TRANS_PREFIX,
  FRAG_TRANSMISSION,
} from '../ultrasound/shaders/passes.glsl';
import { lookWavenumber } from '../ultrasound/steering';
import { recordingGl } from './support/recordingGl';

/**
 * Cableado de la composición espacial en el renderizador real sobre un WebGL falso (decisión 58): la
 * mirada de cada cuadro llega a A2, A y B (uSteer, uLookSalt), D escribe en la ranura del anillo de esa
 * mirada, K lee las tres ranuras con su validez y G convierte la salida de K. Con el compuesto apagado o
 * el color encendido, cada cuadro es la mirada 0 y K pasa la envolvente de D. Las lecturas de prueba
 * (`readEnvelope`, `readTransmission`, `readLookEnvelope`) se niegan a devolver en silencio los datos de
 * otro cuadro. La imagen en sí la miden la e2e y el banco (GPU).
 */
function rig(compound = true) {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound } };
  // con la caja de color, la cadencia del color saltaría los cuadros con el reloj quieto: se fuerza
  const frame = () => {
    rec.draws.length = 0;
    sim.render(sim.color.enabled ? { forceColor: true } : undefined);
    const by = (frag: string) => {
      const d = rec.draws.filter((x) => x.frag === frag);
      expect(d.length, 'un dibujo por pasada').toBe(1);
      return d[0];
    };
    return {
      prefix: by(FRAG_TRANS_PREFIX),
      trans: by(FRAG_TRANSMISSION),
      raw: by(FRAG_RAWFIELD),
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
      for (const d of [f.prefix, f.trans, f.raw]) close(d.uniforms.uSteer, [th, R * Math.sin(th), R * Math.cos(th), K2]);
      expect(f.raw.uniforms.uLookSalt[0]).toBeCloseTo(lookSalt(look), 12);
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
        expect(f.raw.uniforms.uSteer[0]).toBe(0);
        expect(f.raw.uniforms.uLookSalt[0]).toBe(0);
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
    expect(frame().raw.uniforms.uSteer[0]).toBe(0);
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
