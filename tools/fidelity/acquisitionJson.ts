/** JSON nombra los centinelas documentados del transductor y del contacto; rechaza el resto. */
export function acquisitionJson(value: Record<string, unknown>): string {
  const paths = new WeakMap<object, string[]>();
  return (
    JSON.stringify(
      { ...value, numberEncoding: 'finite-numbers-or-acquisition-sentinels-v2' },
      function (this: object, key, entry: unknown) {
        const parent = paths.get(this) ?? [];
        const path = key ? [...parent, key] : parent;
        if (entry && typeof entry === 'object') paths.set(entry, path);
        if (typeof entry !== 'number' || Number.isFinite(entry)) return entry;
        if (key === 'curvatureRadius' && entry === Infinity) return 'planar';
        // Solo las dos ubicaciones adquiridas: snapshot del auditor y sidecar de imagen/cine.
        const contact =
          path[0] === 'compression'
            ? path.slice(1)
            : path[0] === 'frame' && path[1] === 'anatomy' && path[2] === 'compression'
              ? path.slice(3)
              : [];
        if (contact.length === 1 && contact[0] === 'radiusMm' && entry === Infinity) return 'planar';
        if (contact.length === 2 && contact[0] === 'summary' && contact[1] === 'neededMm' && entry === Infinity) return 'unreachable';
        if (contact.length === 3 && contact[0] === 'summary' && Array.isArray(this) && /^\d+$/.test(contact[2])) {
          if (contact[1] === 'skinAlongMm' && Number.isNaN(entry)) return 'no-skin-intersection';
          if (contact[1] === 'wallAlongMm' && entry === Infinity) return 'no-wall-intersection';
        }
        throw new Error(`Non-finite acquisition metadata: ${JSON.stringify(path)}`);
      },
      2,
    ) + '\n'
  );
}
