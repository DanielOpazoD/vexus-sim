/** A lumped venous branch: mL/s, mmHg, mmHg·s/mL, mmHg·s²/mL. */
export interface OutflowBranch {
  flow: number;
  pressure: number;
  resistance: number;
  inertance: number;
}

/** Backward Euler for two inertial branches sharing a resistive outlet.
 * Both branches see the same NEW junction pressure; no explicit feedback delay.
 */
export function stepCoupledOutflows(
  h: number,
  hepatic: OutflowBranch,
  ivc: OutflowBranch,
  atrialPressure: number,
  junctionResistance: number,
): [number, number] {
  const ah = hepatic.inertance / h;
  const ai = ivc.inertance / h;
  const a = ah + hepatic.resistance + junctionResistance;
  const d = ai + ivc.resistance + junctionResistance;
  const b = hepatic.flow * ah + hepatic.pressure - atrialPressure;
  const c = ivc.flow * ai + ivc.pressure - atrialPressure;
  // Expanded determinant avoids subtracting two large Rj² terms under strong collapse.
  const determinant =
    (ah + hepatic.resistance) * (ai + ivc.resistance) + junctionResistance * (ah + hepatic.resistance + ai + ivc.resistance);
  return [(b * d - junctionResistance * c) / determinant, (a * c - junctionResistance * b) / determinant];
}
