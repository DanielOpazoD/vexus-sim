/** Estimated regional tube law, not a patient-specific calibration (decision 172). */
export const SUPRA_IVC = { maxDiameterMm: 28, midpointMmHg: 4, widthMmHg: 6, residualDiameterMm: 3 } as const;

export function supraIvcAreaMm2(transmuralMmHg: number): number {
  const d = Math.max(
    SUPRA_IVC.residualDiameterMm,
    SUPRA_IVC.maxDiameterMm / (1 + Math.exp(-(transmuralMmHg - SUPRA_IVC.midpointMmHg) / SUPRA_IVC.widthMmHg)),
  );
  return (Math.PI * d * d) / 4;
}

/** Viscoelastic wall area and elliptical flattening use the same regional tube law. */
export function supraIvcSection(areaMm2: number): { dEqMm: number; dApMm: number; dLatMm: number } {
  const dEqMm = 2 * Math.sqrt(areaMm2 / Math.PI);
  const fraction = Math.max(1e-9, Math.min(1 - 1e-9, dEqMm / SUPRA_IVC.maxDiameterMm));
  const ptm = SUPRA_IVC.midpointMmHg + SUPRA_IVC.widthMmHg * Math.log(fraction / (1 - fraction));
  const flatness = 0.2 / (1 + Math.exp((ptm - 4) / 3));
  return { dEqMm, dApMm: dEqMm * (1 - flatness), dLatMm: dEqMm / (1 - flatness) };
}
