/** Uso: npx tsx tools/anatomy/inspect-bodyparts.ts manifest.json registro.json informe.json
 * Solo inspección offline: no descarga ni instala mallas en la aplicación.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { eligibleForIntegration, registeredPoint, validateRegistration, type Registration, type Triple } from './registration';

const [manifestPath, registrationPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !registrationPath || !outputPath) throw new Error('Requiere manifest.json registro.json informe.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  source: string;
  license: string;
  credit: string;
  files: { name: string; localPath: string; sha256: string; compressedBytes: number }[];
};
const registration = JSON.parse(readFileSync(registrationPath, 'utf8')) as Registration;
const determinant = validateRegistration(registration);
const bounds = (points: Triple[]) => ({
  min: [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))),
  max: [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]))),
});
const files = manifest.files.map((file) => {
  const bytes = readFileSync(file.localPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== file.sha256) throw new Error(`SHA256 distinto: ${file.name}`);
  const vertices: Triple[] = [];
  let faces = 0;
  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const v = line.trim().split(/\s+/).slice(1).map(Number);
      if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`Vértice inválido: ${file.name}`);
      vertices.push(v as Triple);
    } else if (line.startsWith('f ')) faces++;
  }
  if (!vertices.length || !faces) throw new Error(`Malla vacía: ${file.name}`);
  return {
    name: file.name,
    sha256,
    vertices: vertices.length,
    faces,
    objBytes: bytes.length,
    sourceZipCompressedBytes: file.compressedBytes,
    rawBounds: bounds(vertices),
    candidateMmBounds: bounds(vertices.map((v) => registeredPoint(v, registration))),
  };
});
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      source: manifest.source,
      license: manifest.license,
      credit: manifest.credit,
      registration,
      determinant,
      reverseWinding: determinant < 0,
      eligibleForIntegration: eligibleForIntegration(registration),
      note: 'Las cotas transformadas son candidatos geométricos, no dimensiones clínicas validadas. Un único registro para todos los assets; ninguna normalización por órgano.',
      files,
      totals: {
        objBytes: files.reduce((n, f) => n + f.objBytes, 0),
        sourceZipCompressedBytes: files.reduce((n, f) => n + f.sourceZipCompressedBytes, 0),
        vertices: files.reduce((n, f) => n + f.vertices, 0),
        faces: files.reduce((n, f) => n + f.faces, 0),
      },
    },
    null,
    2,
  ) + '\n',
);
