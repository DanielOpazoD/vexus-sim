import type { Vec3 } from '../../../core/vec3';
import type { PersonAssets } from '../../personAssets';
import { sourceDistance, sourceLabel } from '../../sourceVolume';
import { S0028_BUNDLE as B } from './descriptor';
export function createSourceQueries(assets: PersonAssets) {
  const abdominalAtlas = assets.buffers.abdominal,
    thoracicAtlas = assets.buffers.thoracic;
  const depthAt: Vec3 = [0, 0, 0];
  /** La EDT común en (x, y, z), sin reservar memoria: la consultan el 3D por vértice y la pared por punto. */
  function s0028DepthXyz(x: number, y: number, z: number): number | undefined {
    if (!abdominalAtlas) return undefined;
    const f = B.depth;
    let outside = 0;
    for (let i = 0; i < 3; i++) {
      const q = ((i === 0 ? x : i === 1 ? y : z) - f.originMm[i]) / 3;
      const a = Math.max(0, Math.min(f.dimensions[i] - 1, q));
      depthAt[i] = f.originMm[i] + a * 3;
      outside += (q - a) ** 2;
    }
    return sourceDistance(abdominalAtlas, depthAt, f, B.abdominal.textureDimensions) + Math.sqrt(outside) * 3;
  }
  /** Profundidad bajo la piel s0028 en p (la GPU la lee con `torsoDepth` especializada en `personShader`). @twin s0028-lector */
  function s0028Depth(p: Vec3): number | undefined {
    return s0028DepthXyz(p[0], p[1], p[2]);
  }
  function s0028DepthGradient(p: Vec3): Vec3 | undefined {
    if (!abdominalAtlas) return undefined;
    const [x, y, z] = p;
    return [
      (s0028DepthXyz(x + 1.5, y, z)! - s0028DepthXyz(x - 1.5, y, z)!) / 3,
      (s0028DepthXyz(x, y + 1.5, z)! - s0028DepthXyz(x, y - 1.5, z)!) / 3,
      (s0028DepthXyz(x, y, z + 1.5)! - s0028DepthXyz(x, y, z - 1.5)!) / 3,
    ];
  }

  function sourceGas(p: Vec3): boolean {
    if (!abdominalAtlas) return false;
    const f = B.fields.find((f) => f.name === 'digestiveTract')!;
    return sourceLabel(abdominalAtlas, p, f, B.abdominal.textureDimensions) >= 128;
  }

  /** Consulta CPU de los campos P1 separados; cartílago y pulmón no son una cola ósea. @twin s0028-lector */
  function s0028SourceValue(p: Vec3, name: string): { d: number; label: number } {
    const f = B.fields.find((f) => f.name === name);
    if (!f) throw new Error('Campo s0028 desconocido: ' + name);
    const data = f.asset === 'abdominal' ? abdominalAtlas : thoracicAtlas;
    if (!data) return { d: 16, label: 0 };
    const dimensions = B[f.asset].textureDimensions;
    return { d: sourceDistance(data, p, f, dimensions), label: sourceLabel(data, p, f, dimensions) };
  }

  return { s0028DepthXyz, s0028Depth, s0028DepthGradient, sourceGas, s0028SourceValue };
}
