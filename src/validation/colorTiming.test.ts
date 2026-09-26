import { describe, expect, it } from 'vitest';
import { COLOR_LINE_SPACING_RAD, colorLineCount, colorTiming, pwDutyCycle } from '../ultrasound/colorTiming';

/** Cadencia física del color (decisión 39): la caja, la PRF y el ensemble cuestan cuadros. */
describe('Cadencia del Doppler color', () => {
  it('una caja de 0,5 rad a 2 kHz con ensemble 8 y B de 192 líneas a 16 cm ronda los 8 Hz', () => {
    const t = colorTiming(-0.25, 0.25, 2000, 8, 192, 160);
    expect(t.lines).toBe(Math.ceil(0.5 / COLOR_LINE_SPACING_RAD));
    expect(t.colorFrameS).toBeCloseTo((t.lines * 8) / 2000, 9);
    expect(t.bFrameS).toBeCloseTo((192 * 2 * 160) / 1_540_000, 9);
    expect(t.frameHz).toBeGreaterThan(6);
    expect(t.frameHz).toBeLessThan(10);
  });

  it('abrir la caja, bajar la PRF o subir el ensemble baja la frecuencia de cuadro', () => {
    const base = colorTiming(-0.2, 0.2, 2000, 8, 192, 160).frameHz;
    expect(colorTiming(-0.4, 0.4, 2000, 8, 192, 160).frameHz).toBeLessThan(base);
    expect(colorTiming(-0.2, 0.2, 1000, 8, 192, 160).frameHz).toBeLessThan(base);
    expect(colorTiming(-0.2, 0.2, 2000, 12, 192, 160).frameHz).toBeLessThan(base);
    expect(colorTiming(-0.2, 0.2, 2000, 8, 192, 80).frameHz).toBeGreaterThan(base);
  });

  it('tríplex (decisión 66): el PW intercalado se lleva su parte del tiempo y la imagen va más lenta', () => {
    // PW a 2600 Hz con la puerta hasta 92 mm: cada disparo espera 2·92/c ≈ 119 µs → 31 % del tiempo
    const duty = pwDutyCycle(2600, 92);
    expect(duty).toBeCloseTo((2600 * 2 * 92) / 1_540_000, 9);
    const color = colorTiming(-0.25, 0.25, 2000, 8, 192, 180);
    const triplex = colorTiming(-0.25, 0.25, 2000, 8, 192, 180, 1_540_000, COLOR_LINE_SPACING_RAD, duty);
    expect(triplex.pwDuty).toBeCloseTo(duty, 9);
    expect(triplex.frameHz).toBeCloseTo(color.frameHz * (1 - duty), 9);
    expect(color.pwDuty).toBe(0);
    // acotado: el PW nunca se come todo el tiempo de la imagen
    expect(pwDutyCycle(12_000, 200)).toBe(0.8);
    expect(pwDutyCycle(-5, 90)).toBe(0);
  });

  it('nunca menos de 4 líneas ni PRF absurda', () => {
    expect(colorLineCount(0, 0.001)).toBe(4);
    expect(Number.isFinite(colorTiming(0, 0.1, 0, 8, 192, 160).frameHz)).toBe(true);
  });
});
