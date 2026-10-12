/** Registro único de assets externos. No se importa en la aplicación ni normaliza órganos por separado. */
export type Triple = [number, number, number];
export interface Registration {
  sourceUnit: 'mm' | 'cm';
  /** Matriz ortogonal por filas: admite inversión de handedness, nunca shear/escala por órgano. */
  axes: [Triple, Triple, Triple];
  sourceOrigin: Triple;
  targetOriginMm: Triple;
  evidence: { units: 'verified' | 'pending'; orientation: 'verified' | 'pending'; landmarks: 'verified' | 'pending' };
}

export function validateRegistration(r: Registration): number {
  if (r.axes.length !== 3 || r.axes.some((row) => row.length !== 3) || r.sourceOrigin.length !== 3 || r.targetOriginMm.length !== 3)
    throw new Error('El registro requiere tres dimensiones');
  const values = [...r.axes.flat(), ...r.sourceOrigin, ...r.targetOriginMm];
  if (!values.every(Number.isFinite) || !['mm', 'cm'].includes(r.sourceUnit)) throw new Error('Registro no finito o unidad desconocida');
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      const dot = r.axes[a].reduce((sum, v, i) => sum + v * r.axes[b][i], 0);
      if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-8) throw new Error('Los ejes deben ser ortogonales sin deformación');
    }
  const [a, b, c] = r.axes;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

export function registeredPoint(p: Triple, r: Registration): Triple {
  validateRegistration(r);
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error('Vértice no finito o de dimensión inválida');
  const scale = r.sourceUnit === 'cm' ? 10 : 1;
  return r.axes.map((row, a) => row.reduce((sum, v, i) => sum + v * (p[i] - r.sourceOrigin[i]) * scale, r.targetOriginMm[a])) as Triple;
}

/** Inversa del MISMO registro de caso; no vuelve a ajustar el órgano ni el punto. */
export function sourcePoint(p: Triple, r: Registration): Triple {
  validateRegistration(r);
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error('Punto no finito o de dimensión inválida');
  const scale = r.sourceUnit === 'cm' ? 10 : 1;
  return r.sourceOrigin.map((v, i) => v + r.axes.reduce((sum, row, a) => sum + row[i] * (p[a] - r.targetOriginMm[a]), 0) / scale) as Triple;
}

export function registeredNormal(n: Triple, r: Registration): Triple {
  validateRegistration(r);
  if (n.length !== 3 || !n.every(Number.isFinite)) throw new Error('Normal no finita o de dimensión inválida');
  const q = r.axes.map((row) => row.reduce((sum, v, i) => sum + v * n[i], 0)) as Triple;
  const len = Math.hypot(...q);
  if (!Number.isFinite(len) || len === 0) throw new Error('Normal no resoluble');
  return q.map((v) => v / len) as Triple;
}

export function registeredTriangle(face: Triple, r: Registration): Triple {
  return validateRegistration(r) < 0 ? [face[0], face[2], face[1]] : [...face];
}

export function eligibleForIntegration(r: Registration): boolean {
  validateRegistration(r);
  return ['units', 'orientation', 'landmarks'].every((key) => r.evidence?.[key as keyof Registration['evidence']] === 'verified');
}
