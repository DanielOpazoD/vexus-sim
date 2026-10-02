import { describe, expect, it } from 'vitest';
import { Interface, INTERFACES } from '../anatomy/interfaces';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { facetLobe, interfaceAmplitude, IFACE_BETA, IFACE_K_DB, IFACE_SLOPE_REF, IFACE_SIGMA_H_MM } from '../ultrasound/interfaceEcho';
import { DENSITY, densityDb } from '../ultrasound/speckleField';

describe('contraste portal normal: angularidad y homogeneidad material', () => {
  it('amplía la respuesta oblicua con incremento frontal acotado y sin aumentar el grosor del eco', () => {
    const p = INTERFACES[Interface.PortalLumen];
    const previous = (IFACE_BETA * 10 ** (IFACE_K_DB / 20) * 0.05 * IFACE_SLOPE_REF) / 0.25;
    const gainDb = 20 * Math.log10(interfaceAmplitude(Interface.PortalLumen) / previous);
    expect(gainDb).toBeGreaterThan(3);
    expect(gainDb).toBeLessThan(6);
    expect(p.roughnessMm).toBe(0.03);
    expect(IFACE_SIGMA_H_MM).toBe(0.14);
    for (const deg of [20, 30, 40, 50, 60]) {
      const cos = Math.cos((deg * Math.PI) / 180);
      const oldRelative = facetLobe(cos, 0.25) / facetLobe(1, 0.25);
      const newRelative = facetLobe(cos, p.slopeRms) / facetLobe(1, p.slopeRms);
      expect(newRelative, `${deg} grados`).toBeGreaterThan(oldRelative);
    }
    // Se conserva caída rasante: no se pinta una línea blanca independiente del haz.
    expect(facetLobe(Math.cos((85 * Math.PI) / 180), p.slopeRms)).toBeLessThan(1e-20);
  });
  it('no confunde paredes suprahepáticas/VCI ni aclara la sangre o el parénquima basal', () => {
    expect(INTERFACES[Interface.VeinLumen].floor).toBe(0.025);
    expect(INTERFACES[Interface.VeinLumen].slopeRms).toBe(0.14);
    expect(INTERFACES[Interface.IvcLumen].slopeRms).toBe(0.18);
    expect(TISSUES[Tissue.Blood].backscatter).toBe(0.008);
    expect(TISSUES[Tissue.VesselWallPortal].backscatter).toBe(2.6);
    expect(TISSUES[Tissue.Liver].backscatter).toBe(1);
    expect(TISSUES[Tissue.Liver].alpha1).toBe(0.601);
  });
  it('limita el relieve milimétrico a ±2 dB y reduce su desviación sin borrar la textura', () => {
    let sum = 0,
      sum2 = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const x = densityDb([i * 0.731, i * 1.173, i * 0.439], 17);
      expect(Math.abs(x)).toBeLessThanOrEqual(2);
      sum += x;
      sum2 += x * x;
    }
    const sd = Math.sqrt(sum2 / n - (sum / n) ** 2);
    expect(sd).toBeGreaterThan(0.65);
    expect(sd).toBeLessThan(0.85);
    expect(DENSITY.cellMm).toBe(3);
  });
});
