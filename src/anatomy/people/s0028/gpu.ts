import { personShader } from '../../gpu/personShader';
import type { InstalledCpuPerson, PersonGpuPlan } from '../../person';
import { S0028_BUNDLE } from './descriptor';
export function gpuPlan(person: InstalledCpuPerson): PersonGpuPlan {
  return Object.freeze({
    specializeFragment: (source: string) => personShader(source, { person: 's0028', bundle: S0028_BUNDLE }),
    uploads: [...person.cpu.regional!.s0028WallUploads(), ...person.cpu.regional!.s0028SolidsUploads()],
  });
}
