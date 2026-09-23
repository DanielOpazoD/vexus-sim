import { describe, expect, it } from 'vitest';
import {
  depthProfile,
  displayStats,
  envelopeTexture,
  halfWidth,
  RAYLEIGH_DARK_FRACTION,
  secondaryLobe,
  type EnvelopeGeometry,
} from '../app/fidelity';
import { greyOfLevel, levelOfGrey } from '../ultrasound/greyMap';
import type { DisplayFrame } from '../ultrasound/renderer';
import { detect, psf, whiteField } from './syntheticSpeckle';

/**
 * Métricas del banco de fidelidad (decisión 52) sobre campos sintéticos con la geometría del
 * renderizador (192 líneas × 1024 muestras a 18 cm, convexo de ±34° y R 60 mm): el moteado ideal
 * (campo gaussiano complejo + PSF gaussiana) fija la referencia y cada defecto conocido se sale de
 * ella. Valores de referencia medidos con estas semillas: SNR 1,93, fracción oscura 0,068 (Rayleigh
 * 0,0682), grano = 2,355·σ ± 5 %, grietas 0,045; con |Re| (la envolvente como valor absoluto de un
 * campo real): SNR 1,34, oscuros 0,19, grietas 0,31.
 */
const G = { lines: 192, samples: 1024 };
const GEOM: EnvelopeGeometry = { depthMm: 180, halfSector: (34 * Math.PI) / 180, curvatureRadius: 60 };
const DR_MM = GEOM.depthMm / G.samples;
const everywhere = (): boolean => true;
const field = psf(G, whiteField(G, 7), 1.5, 1.0);
const ideal = envelopeTexture(detect(G, field, Math.hypot), everywhere, GEOM);

describe('banco de fidelidad: textura de la envolvente', () => {
  it('el moteado ideal da Rayleigh: SNR 1,91, fracción oscura 0,068 y grano del tamaño de la PSF', () => {
    expect(ideal.patches).toBe((192 / 16) * Math.floor(1024 / 48));
    expect(ideal.snr).toBeGreaterThan(1.85);
    expect(ideal.snr).toBeLessThan(2.0);
    expect(Math.abs(ideal.darkFraction - RAYLEIGH_DARK_FRACTION)).toBeLessThan(0.006);
    // speckle = célula de resolución: FWHM de la autocovarianza ≈ 2,355·σ de la PSF de amplitud
    expect(ideal.fwhmAxialMm / (2.3548 * 1.5 * DR_MM)).toBeGreaterThan(0.9);
    expect(ideal.fwhmAxialMm / (2.3548 * 1.5 * DR_MM)).toBeLessThan(1.1);
    const spacing = (GEOM.curvatureRadius + ideal.depthMm) * ((2 * GEOM.halfSector) / G.lines);
    expect(ideal.fwhmLateralMm / (2.3548 * 1.0 * spacing)).toBeGreaterThan(0.88);
    expect(ideal.fwhmLateralMm / (2.3548 * 1.0 * spacing)).toBeLessThan(1.12);
    expect(ideal.secondaryLobeAxial).toBeLessThan(0.05);
    expect(ideal.secondaryLobeLateral).toBeLessThan(0.05);
    expect(ideal.crackIndex).toBeLessThan(0.08);
  });

  it('una envolvente que es el valor absoluto de un campo real forma grietas: ceros en líneas', () => {
    const t = envelopeTexture(
      detect(G, psf(G, whiteField(G, 9), 1.5, 1.0), (re) => Math.abs(re)),
      everywhere,
      GEOM,
    );
    expect(t.snr).toBeLessThan(1.45); // 1,32 teórico
    expect(t.darkFraction).toBeGreaterThan(0.15);
    expect(t.crackIndex).toBeGreaterThan(3 * ideal.crackIndex);
  });

  it('una estructura periódica (retícula, bloques repetidos) deja un lóbulo secundario', () => {
    const env = detect(G, psf(G, whiteField(G, 11), 1.5, 1.0), Math.hypot);
    for (let v = 0; v < G.samples; v++)
      for (let u = 0; u < G.lines; u++) env.data[v * G.lines + u] *= 1 + 0.8 * Math.cos((2 * Math.PI * v) / 8);
    expect(envelopeTexture(env, everywhere, GEOM).secondaryLobeAxial).toBeGreaterThan(0.3);
  });

  it('solo mide los parches de dentro; sin parches, todo NaN', () => {
    const env = detect(G, field, Math.hypot);
    const none = envelopeTexture(env, () => false, GEOM);
    expect(none.patches).toBe(0);
    expect(none.snr).toBeNaN();
    const shallow = envelopeTexture(env, (_u, v) => v < 512, GEOM);
    expect(shallow.patches).toBe((192 / 16) * Math.floor(512 / 48));
    expect(shallow.depthMm).toBeLessThan(90);
  });

  it('si el grano no cabe en el parche, grietas y lóbulos son NaN, no un «ideal» 0', () => {
    // rampa axial en un parche de 200 muestras: la autocovarianza sigue en ~0,78 a 20 muestras
    // (en un parche corto, cualquier variación lenta cae a 0,5 hacia la mitad del parche y se mide
    // como un grano grande: límite del estimador, no de la imagen)
    const ramp = { lines: G.lines, samples: G.samples, data: new Float32Array(G.lines * G.samples) };
    for (let v = 0; v < G.samples; v++) ramp.data.fill(1 + v / G.samples, v * G.lines, (v + 1) * G.lines);
    const t = envelopeTexture(ramp, everywhere, GEOM, { axial: 200, lateral: 16 });
    expect(t.patches).toBeGreaterThan(0);
    expect(t.fwhmAxialMm).toBeNaN();
    expect(t.crackIndex).toBeNaN();
    expect(t.secondaryLobeAxial).toBeNaN();
  });

  it('un parche menor que los desfases de la autocovarianza no produce NaN', () => {
    const t = envelopeTexture(detect(G, field, Math.hypot), everywhere, GEOM, { axial: 16, lateral: 8 });
    expect(Number.isFinite(t.secondaryLobeAxial)).toBe(true);
    expect(Number.isFinite(t.secondaryLobeLateral)).toBe(true);
    expect(Number.isFinite(t.crackIndex)).toBe(true);
  });

  it('semianchura y lóbulo secundario de una autocovarianza', () => {
    expect(halfWidth([1, 0.8, 0.4])).toBeCloseTo(1.75, 10);
    expect(halfWidth([1, 0.9, 0.7])).toBeNaN();
    expect(secondaryLobe([1, 0.6, 0.2, -0.1, 0.3, 0.1])).toBeCloseTo(0.3, 10);
    expect(secondaryLobe([1, 0.4, 0.1, 0])).toBe(0);
    expect(secondaryLobe([1, 0.9, 0.7])).toBeNaN();
  });
});

describe('banco de fidelidad: imagen mostrada', () => {
  it('gris del tejido: media, percentiles y fracción de huecos', () => {
    const img: DisplayFrame = { width: 100, height: 50, gray: new Uint8Array(5000).fill(100) };
    for (let i = 0; i < 500; i++) img.gray[i * 10] = 0;
    const s = displayStats(img, () => true);
    expect(s.pixels).toBe(5000);
    expect(s.mean).toBeCloseTo(90, 10);
    expect(s.p05).toBe(0);
    expect(s.p50).toBe(100);
    expect(s.darkFraction).toBeCloseTo(0.1, 10);
    expect(displayStats(img, () => false).mean).toBeNaN();
  });

  it('el perfil en profundidad recupera la pendiente en dB a través de la curva de grises', () => {
    // 200 filas = 100 mm; nivel −30 dB + 0,4 dB/cm bajo un techo de 60 dB
    const W = 60;
    const H = 200;
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const db = -30 + 0.4 * ((y * 0.5) / 10);
      gray.fill(Math.round(greyOfLevel((db + 60) / 60) * 255), y * W, (y + 1) * W);
    }
    const p = depthProfile({ width: W, height: H, gray }, (_x, y) => y * 0.5, 60, 10, 1, 10);
    expect(p.bands).toHaveLength(10);
    expect(p.slopeDbPerCm).toBeGreaterThan(0.35);
    expect(p.slopeDbPerCm).toBeLessThan(0.45);
    expect(p.bands[0].db).toBeGreaterThan(-31);
    expect(p.bands[0].db).toBeLessThan(-29);
  });

  it('la curva de grises y su inversa son la misma función', () => {
    for (let y = 0; y <= 1; y += 0.125) expect(levelOfGrey(greyOfLevel(y))).toBeCloseTo(y, 12);
    expect(greyOfLevel(0)).toBe(0);
    expect(greyOfLevel(1)).toBeCloseTo(1, 12);
  });
});
