/** Referencia TAC offline: índices nativos ↔ RAS/mm ↔ un único marco LAS del caso. */
import { createHash } from 'node:crypto';
import { registeredPoint, sourcePoint, validateRegistration, type Registration, type Triple } from './registration';

export interface CtGrid {
  source: { dataset: string; version: string; case: string };
  ctSha256: string;
  shape: Triple;
  affineRASmm: number[][];
  unitsDeclared: string;
  millimeterEvidence: string | null;
  allMasksShareOriginalGrid: boolean;
}

function matrix(g: CtGrid): { a: number[][]; inverse: number[][] } {
  const a = g.affineRASmm;
  if (!g.source.dataset || !g.source.version || !g.source.case || !/^[a-f0-9]{64}$/.test(g.ctSha256))
    throw new Error('Referencia TAC sin procedencia exacta');
  if (g.shape.length !== 3 || !g.shape.every((x) => Number.isSafeInteger(x) && x > 0) || !g.allMasksShareOriginalGrid)
    throw new Error('TAC y máscaras requieren rejilla original verificada');
  if (g.unitsDeclared !== 'mm' && !(g.unitsDeclared === 'unknown' && g.millimeterEvidence?.trim()))
    throw new Error('Unidades físicas TAC no verificadas');
  if (a.length !== 4 || a.some((row) => row.length !== 4 || !row.every(Number.isFinite)) || a[3].some((v, i) => v !== (i === 3 ? 1 : 0)))
    throw new Error('Affine TAC inválido');
  const [x, y, z] = a;
  const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  if (Math.abs(det) < 1e-12) throw new Error('Affine TAC singular');
  const inverse = [
    [y[1] * z[2] - y[2] * z[1], x[2] * z[1] - x[1] * z[2], x[1] * y[2] - x[2] * y[1]],
    [y[2] * z[0] - y[0] * z[2], x[0] * z[2] - x[2] * z[0], x[2] * y[0] - x[0] * y[2]],
    [y[0] * z[1] - y[1] * z[0], x[1] * z[0] - x[0] * z[1], x[0] * y[1] - x[1] * y[0]],
  ].map((row) => row.map((v) => v / det));
  return { a, inverse };
}

/** Datos del mismo TAC, con un solo registro para TODOS sus tejidos. No alinea otra persona. */
export class CtCaseFrame {
  readonly id: string;
  private readonly grid: CtGrid;
  private readonly registration: Registration;
  private readonly a: number[][];
  private readonly inverse: number[][];

  constructor(grid: CtGrid, registration: Registration) {
    this.grid = structuredClone(grid);
    this.registration = structuredClone(registration);
    ({ a: this.a, inverse: this.inverse } = matrix(this.grid));
    validateRegistration(this.registration);
    if (registration.sourceUnit !== 'mm') throw new Error('El affine RAS ya está en mm');
    // Identidad física reproducible: el mismo nombre de caso con otro affine/registro NO es el mismo marco.
    this.id =
      'ct:' +
      createHash('sha256')
        .update(JSON.stringify({ grid: this.grid, registration: this.registration }))
        .digest('hex');
  }

  voxelToPatient(voxel: Triple): Triple {
    if (voxel.length !== 3 || !voxel.every(Number.isFinite)) throw new Error('Índice TAC inválido');
    const ras = this.a.slice(0, 3).map((row) => row.slice(0, 3).reduce((s, v, i) => s + v * voxel[i], row[3])) as Triple;
    return registeredPoint(ras, this.registration);
  }

  patientToVoxel(pointMm: Triple, frameId: string): { voxel: Triple; inside: boolean } {
    if (frameId !== this.id) throw new Error('Marco anatómico distinto: no superponer individuos o registros');
    const ras = sourcePoint(pointMm, this.registration);
    const d = ras.map((v, i) => v - this.a[i][3]);
    const voxel = this.inverse.map((row) => row.reduce((s, v, i) => s + v * d[i], 0)) as Triple;
    // Soporte físico de los voxeles, no solo sus centros. Sin clamp ni extrapolación de tejido.
    return { voxel, inside: voxel.every((v, i) => v >= -0.5 && v < this.grid.shape[i] - 0.5) };
  }

  descriptor() {
    return structuredClone({
      id: this.id,
      grid: this.grid,
      registration: this.registration,
      meaning: 'Marco físico de un caso; no certifica segmentación, registro entre personas, ecografía ni normalidad clínica',
    });
  }
}

export const NATIVE_RAS_TO_LAS: Registration = {
  sourceUnit: 'mm',
  axes: [
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  sourceOrigin: [0, 0, 0],
  targetOriginMm: [0, 0, 0],
  evidence: { units: 'pending', orientation: 'pending', landmarks: 'pending' },
};
