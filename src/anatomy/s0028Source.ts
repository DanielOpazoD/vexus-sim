import { anatomyBundle } from './anatomyBundle';
import { abdominalAtlas } from './abdominalAtlas';
import { thoracicAtlas } from './thoracicAtlas';
import { sourceDistance, sourceLabel } from './sourceVolume';
import type { Vec3 } from '../core/vec3';

/** Consulta CPU de los campos P1 separados; cartílago y pulmón no son una cola ósea. @twin s0028-lector */
export function s0028SourceValue(p: Vec3, name: string): { d: number; label: number } {
  if (anatomyBundle.person !== 's0028') return { d: 16, label: 0 };
  const f = anatomyBundle.fields.find((f) => f.name === name);
  if (!f) throw new Error('Campo s0028 desconocido: ' + name);
  const data = f.asset === 'abdominal' ? abdominalAtlas : thoracicAtlas;
  if (!data) return { d: 16, label: 0 };
  const dimensions = anatomyBundle[f.asset].textureDimensions;
  return { d: sourceDistance(data, p, f, dimensions), label: sourceLabel(data, p, f, dimensions) };
}
