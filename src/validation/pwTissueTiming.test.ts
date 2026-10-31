// @tier slow
import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { dopplerShiftHz } from '../core/units';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import type { AnatomyQuery } from '../anatomy/query';
import { receiverNoiseDb, SampleVolumeIQ, type GateGeometry } from '../doppler/sampleVolume';
import type { SpectralColumn } from '../doppler/spectral';
import type { PhysiologySample } from '../physiology/engine';
import { pwGate } from '../app/pwGate';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { openSession, placeGate, probeAt, PROFILE, TR } from './support/studentChain';

/**
 * El tejido del volumen de muestra lleva un solo movimiento: el del mapa material → mundo, muestreado en el instante de cada
 * pulso. Un tejido uniforme sin sangre no puede dar más que su línea, la falda de la ventana de Hann y el ruido del receptor.
 */
const PHYS_DT = 1 / 250;
const F0 = 2.5e6;

const beam: Vec3 = [0, 1, 0];
const lateral: Vec3 = [1, 0, 0];
const elevation: Vec3 = [0, 0, 1];
const GATE: GateGeometry = {
  center: [0, 0, 0],
  beamDir: beam,
  lateral,
  elevation,
  lengthMm: 4,
  pulseSigmaMm: 0.5,
  lateralSigmaMm: 1.11,
  elevationSigmaMm: 1.88,
  transmission: 1,
};

interface Resp {
  diaphragmCaudalMm: number;
  diaphragmVelocityMmS: number;
}

/**
 * Bloque uniforme que se mueve a lo largo de `dir`, con un mapa de compresión lineal `scale` tras la respiración: la velocidad
 * del mundo es scale·dir·D′, y `tissueVelocity`, la de un punto material sin compresión, dir·D′ (como `RespiratoryDeformation`).
 */
function block(dir: Vec3, scale = 1) {
  return {
    deformation: {
      compression: null,
      displacement: (_m: Vec3, r: Resp): Vec3 => [dir[0] * r.diaphragmCaudalMm, dir[1] * r.diaphragmCaudalMm, dir[2] * r.diaphragmCaudalMm],
      toWorld: (m: Vec3, r: Resp): Vec3 => [
        scale * (m[0] + dir[0] * r.diaphragmCaudalMm),
        scale * (m[1] + dir[1] * r.diaphragmCaudalMm),
        scale * (m[2] + dir[2] * r.diaphragmCaudalMm),
      ],
      toMaterial: (w: Vec3, r: Resp): Vec3 => [
        w[0] / scale - dir[0] * r.diaphragmCaudalMm,
        w[1] / scale - dir[1] * r.diaphragmCaudalMm,
        w[2] / scale - dir[2] * r.diaphragmCaudalMm,
      ],
      tissueVelocity: (_m: Vec3, r: Resp): Vec3 => [
        dir[0] * r.diaphragmVelocityMmS,
        dir[1] * r.diaphragmVelocityMmS,
        dir[2] * r.diaphragmVelocityMmS,
      ],
    },
    scene: { vessels: [], ducts: [], tubeBounds: [], vesselById: new Map(), vesselTubeAt: () => ({ def: null, hit: null }) },
    caliberFor: () => ({ radiusScale: () => 1, ivcApScale: 1 }),
    classifyMaterial: (m: Vec3) => ({
      tissue: Tissue.Liver,
      vessel: null,
      material: m,
      bloodVelocity: null,
      flowBasis: null,
      tissueVelocity: [0, 0, 0],
    }),
  } as unknown as AnatomyQuery;
}

const sample = (t: number, position: (t: number) => number, speed: (t: number) => number) =>
  ({
    t,
    velocities: {},
    hvRadiusScale: 1,
    pvRadiusScale: 1,
    resp: { diaphragmCaudalMm: position(t), diaphragmVelocityMmS: speed(t) },
  }) as unknown as PhysiologySample;

/** Potencia media (dB) de cada banda |f| ∈ [lo, hi) en unas columnas. */
function bandDb(cols: readonly SpectralColumn[], lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  for (const c of cols) {
    const N = c.powerDb.length;
    for (let k = 0; k < N; k++) {
      const f = Math.abs(((k - N / 2) / N) * c.prfHz);
      if (f < lo || f >= hi) continue;
      sum += Math.pow(10, c.powerDb[k] / 10);
      n++;
    }
  }
  return 10 * Math.log10(sum / n);
}

function maxBinDb(cols: readonly SpectralColumn[]): number {
  const N = cols[0].powerDb.length;
  const avg = new Float64Array(N);
  for (const c of cols) for (let k = 0; k < N; k++) avg[k] += Math.pow(10, c.powerDb[k] / 10) / cols.length;
  return 10 * Math.log10(Math.max(...avg));
}

/** Espectro de la cadena (filtro casi abierto) con el reloj fisiológico: 10,4 pulsos por paso a 2600 Hz. */
function chainColumns(
  anatomy: AnatomyQuery,
  seconds: number,
  position: (t: number) => number,
  speed: (t: number) => number,
  prfHz = 2600,
): SpectralColumn[] {
  const chain = new PwDopplerChain(anatomy, 5);
  let t = 0;
  chain.begin(prfHz, F0, 0, 1, PHYS_DT);
  chain.setGate(GATE, sample(0, position, speed));
  for (let i = 0; i < seconds / PHYS_DT; i++) {
    if (i % 8 === 0) {
      chain.flush();
      chain.begin(prfHz, F0, 0, 1, t + PHYS_DT);
    }
    t += PHYS_DT;
    const s = sample(t, position, speed);
    if (i % 8 === 0) chain.setGate(GATE, s);
    chain.step(s, [0, 0, 0], PHYS_DT);
  }
  chain.flush();
  return chain.spectral.columns.filter((c) => c.t > 1);
}

describe('Movimiento del tejido en el volumen de muestra', () => {
  it('suena a la derivada del mapa material → mundo, con su compresión', () => {
    const scale = 0.7;
    const dir: Vec3 = [0, 1, 0];
    const speed = 20;
    const anatomy = block(dir, scale);
    const sv = new SampleVolumeIQ(anatomy, 7);
    sv.setEquipment({ prfHz: 2500, f0Hz: F0, gain: 1 });
    const position = (t: number) => speed * t;
    const constant = () => speed;
    sv.setGate(GATE, sample(0, position, constant));
    const re = new Float32Array(10);
    const im = new Float32Array(10);
    let lagRe = 0;
    let lagIm = 0;
    let pr = 0;
    let pi = 0;
    for (let i = 1; i <= 1000; i++) {
      sv.generate(sample(i * PHYS_DT, position, constant), [0, 0, 0], 10, re, im);
      for (let k = 0; k < 10; k++) {
        lagRe += re[k] * pr + im[k] * pi;
        lagIm += im[k] * pr - re[k] * pi;
        pr = re[k];
        pi = im[k];
      }
    }
    const fHz = (Math.atan2(lagIm, lagRe) * 2500) / (2 * Math.PI);
    // el eco se acerca o se aleja según la velocidad del mundo sobre el haz
    const expected = dopplerShiftHz(-scale * speed, F0);
    expect(Math.abs(fHz - expected) / Math.abs(expected)).toBeLessThan(0.02);
  });

  it('toma la derivada en el punto material de la puerta, no en su punto del mundo', () => {
    // Peso respiratorio que crece a lo largo del haz, y(mundo) = y + D·w(y), w = 1 + 0,02·y: con el diafragma a 12 mm, el centro de la
    // puerta (y mundo 0) es el punto material −12/1,24 = −9,68, con w = 0,806; y tomado como material, w = 1.
    const b = 0.02;
    const anatomy = {
      deformation: {
        compression: null,
        toWorld: (m: Vec3, r: Resp): Vec3 => [m[0], m[1] + r.diaphragmCaudalMm * (1 + b * m[1]), m[2]],
        toMaterial: (w: Vec3, r: Resp): Vec3 => [w[0], (w[1] - r.diaphragmCaudalMm) / (1 + b * r.diaphragmCaudalMm), w[2]],
        tissueVelocity: (m: Vec3, r: Resp): Vec3 => [0, r.diaphragmVelocityMmS * (1 + b * m[1]), 0],
      },
      scene: { vessels: [], ducts: [], tubeBounds: [], vesselById: new Map(), vesselTubeAt: () => ({ def: null, hit: null }) },
      caliberFor: () => ({ radiusScale: () => 1, ivcApScale: 1 }),
      classifyMaterial: (m: Vec3) => ({
        tissue: Tissue.Liver,
        vessel: null,
        material: m,
        bloodVelocity: null,
        flowBasis: null,
        tissueVelocity: [0, 0, 0],
      }),
    } as unknown as AnatomyQuery;
    const speed = 5;
    const position = (t: number) => 12 + speed * t;
    const constant = () => speed;
    const sv = new SampleVolumeIQ(anatomy, 7);
    sv.setEquipment({ prfHz: 2500, f0Hz: F0, gain: 1 });
    sv.setGate(GATE, sample(0, position, constant));
    const re = new Float32Array(10);
    const im = new Float32Array(10);
    let lagRe = 0;
    let lagIm = 0;
    let pr = 0;
    let pi = 0;
    // 0,2 s: el diafragma pasa de 12 a 13 mm y el peso del centro de la puerta, de 0,806 a 0,794
    for (let i = 1; i <= 50; i++) {
      sv.generate(sample(i * PHYS_DT, position, constant), [0, 0, 0], 10, re, im);
      for (let k = 0; k < 10; k++) {
        lagRe += re[k] * pr + im[k] * pi;
        lagIm += im[k] * pr - re[k] * pi;
        pr = re[k];
        pi = im[k];
      }
    }
    const fHz = (Math.atan2(lagIm, lagRe) * 2500) / (2 * Math.PI);
    const dMid = position(0.1);
    const atMaterial = dopplerShiftHz(-speed * (1 - (b * dMid) / (1 + b * dMid)), F0);
    const atWorld = dopplerShiftHz(-speed, F0);
    expect(Math.abs(fHz - atMaterial)).toBeLessThan(0.25 * Math.abs(atWorld - atMaterial));
  });

  it('con pulsos no enteros por paso no deja líneas lejos del tejido que se mueve', () => {
    // Movimiento sobre todo perpendicular al haz, como el diafragma visto en una vista oblicua, con la velocidad de la respiración profunda.
    const n = Math.hypot(0.9, 0.3, 0.3);
    const anatomy = block([0.9 / n, 0.3 / n, 0.3 / n]);
    const position = (t: number) => 20 * Math.sin((2 * Math.PI * t) / 4);
    const speed = (t: number) => 20 * ((2 * Math.PI) / 4) * Math.cos((2 * Math.PI * t) / 4);
    const cols = chainColumns(anatomy, 8, position, speed);
    const peak = maxBinDb(cols);
    // Con el tiempo de cada pulso queda la falda de la ventana de Hann, hasta el receptor (−92 dB): −78,7, −86,0 y −90,8 dB;
    // fijando el último pulso de cada llamada al final del paso, −71,4, −76,7 y −80,0 dB
    for (const [lo, hi, limit] of [
      [300, 450, -76],
      [450, 650, -83],
      [650, 1300, -87],
    ]) {
      expect(bandDb(cols, lo, hi) - peak, `banda ${lo}–${hi} Hz`).toBeLessThan(limit);
    }
  });

  it('en la cadena real con respiración profunda, lejos de la línea del tejido queda el ruido del receptor', () => {
    const session = openSession(NORMAL_ADULT, 'deep', 1);
    const contact = probeAt(session, 'subcostal');
    const best = placeGate(session, contact, ['hvMiddle'])!;
    const { engine, chain, anatomy } = session;
    // al parénquima, donde la cuña de compresión de la sonda hace que el tejido no vaya a la velocidad del diafragma
    const cursor = { theta: best.theta, depthMm: best.r + 12, gateMm: 4 };
    chain.reset();
    const t0 = engine.clock.t;
    const speeds: Array<{ t: number; v: number }> = [];
    while (engine.clock.t < t0 + 16) {
      chain.begin(2600, TR.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
      for (let i = 0; i < 8; i++) {
        const s = engine.step();
        if (i === 0) {
          const { gate } = pwGate(anatomy, contact.frame, contact, PROFILE, DEFAULT_BMODE.focusMm, cursor, s);
          chain.setGate(gate, s);
          speeds.push({ t: s.t, v: Math.abs(s.resp.diaphragmVelocityMmS) });
        }
        chain.step(s, [0, 0, 0], engine.clock.dt);
      }
      chain.flush();
    }
    const fast = [...speeds].sort((a, b) => a.v - b.v)[Math.floor((2 * speeds.length) / 3)].v;
    const speedAt = (t: number) =>
      speeds[Math.min(speeds.length - 1, Math.max(0, Math.round((t - speeds[0].t) / (8 * engine.clock.dt))))].v;
    const cols = chain.spectral.columns.filter((c) => c.t > t0 + 2 && speedAt(c.t) >= fast);
    expect(cols.length).toBeGreaterThan(300);
    const noise = receiverNoiseDb(0, cols[0].powerDb.length);
    expect(bandDb(cols, 650, 1300) - noise, '650–1300 Hz sobre el ruido').toBeLessThan(1.8);
  });
});
