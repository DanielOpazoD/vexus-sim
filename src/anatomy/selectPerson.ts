export type PersonSelection = 'current' | 'legacy' | 's0028';
/** Selection contains no descriptors, assets or implementation imports. */
export function selectPerson(params: URLSearchParams): PersonSelection {
  const abdomen = params.get('abdomen');
  if (abdomen === 's0028') {
    if (params.get('reference') === '1') throw new Error('reference=1 incompatible con s0028');
    return 's0028';
  }
  if (abdomen && !['legacy', 'atlas'].includes(abdomen)) throw new Error('Persona desconocida');
  return abdomen === 'legacy' ? 'legacy' : 'current';
}
