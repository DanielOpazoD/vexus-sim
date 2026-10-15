import { SCENE_UNIFORMS } from '../anatomy/gpu/sceneUniforms';

/** A renderer owns one geometric atlas. Constant selection lets the driver remove the other anatomy. */
export function specializeAbdominalShader(fragment: string, enabled: boolean): string {
  const name = SCENE_UNIFORMS.find((u) => u.name === 'uAbdominalAtlasEnabled')!.name;
  return fragment.replace(new RegExp(`uniform\\s+int\\s+${name}\\s*;`), `const int ${name}=${enabled ? 1 : 0};`);
}

export function specializeSceneShaders<K extends string>(fragments: Record<K, string>, enabled: boolean): Record<K, string> {
  return Object.fromEntries(
    Object.entries<string>(fragments).map(([name, fragment]) => [name, specializeAbdominalShader(fragment, enabled)]),
  ) as Record<K, string>;
}
