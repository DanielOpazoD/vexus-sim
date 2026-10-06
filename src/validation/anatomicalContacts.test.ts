import { expect, it } from 'vitest';
import { signedContactSamples } from '../../tools/anatomy/signed-contact';
import { organSignedFields } from '../../tools/anatomy/organ-fields';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';

it('contacto con signo distingue penetración, separación muestreada y una medición inválida', () => {
  // Esfera analítica independiente de los campos del simulador: 3 mm dentro, 2 mm fuera.
  const field = (p: [number, number, number]) => Math.hypot(...p) - 5;
  const r = signedContactSamples(
    [
      [2, 0, 0],
      [0, 7, 0],
    ],
    field,
  );
  expect(r.minimumSignedFieldMm).toBe(-3);
  expect(r.maximumSignedFieldMm).toBe(2);
  expect(r.negativeSamples).toBe(1);
  expect(r.witness).toEqual([2, 0, 0]);
  expect(r.globalMinimumCertified).toBe(false);
  const outside = signedContactSamples([[0, 7, 0]], field);
  expect(outside.interpretation).toBe('inconclusive-no-sampled-penetration');
  expect(() => signedContactSamples([], field)).toThrow('sin muestras');
  expect(() => signedContactSamples([[NaN, 0, 0]], field)).toThrow('no finita');
  expect(() => signedContactSamples([[0, 0, 0]], () => NaN)).toThrow('no finito');
});

it('el banco consulta ambos riñones en su marco local y conserva el signo del hígado efectivo', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const fields = organSignedFields(scene);
  expect(fields.kidneyRight(scene.kidneyRight.center)).toBeLessThan(-10);
  expect(fields.kidneyLeft(scene.kidneyLeft.center)).toBeLessThan(-10);
  // El centro contralateral está fuera: detecta omitir la traslación/rotación al marco renal.
  expect(fields.kidneyRight(scene.kidneyLeft.center)).toBeGreaterThan(50);
  expect(fields.kidneyLeft(scene.kidneyRight.center)).toBeGreaterThan(50);
  expect(fields.liverAfterWallAndDiaphragmClip([-60, 20, 0])).toBeLessThan(0);
  expect(fields.liverAfterWallAndDiaphragmClip([0, 110, 0])).toBeGreaterThan(0);
});
