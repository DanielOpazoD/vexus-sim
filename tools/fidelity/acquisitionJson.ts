/** JSON preserves finite millimetres and names the positive-infinite planar limit. */
export function acquisitionJson(value: Record<string, unknown>): string {
  return (
    JSON.stringify(
      { ...value, numberEncoding: 'finite-numbers-or-planar-curvature-v1' },
      (key, entry: unknown) => {
        if (typeof entry !== 'number' || Number.isFinite(entry)) return entry;
        if (key === 'curvatureRadius' && entry === Infinity) return 'planar';
        throw new Error(`Non-finite acquisition metadata: ${key}`);
      },
      2,
    ) + '\n'
  );
}
