/** Experimental closed-mesh query contract. Not imported by the simulator runtime.
 * Sign uses angle-weighted pseudonormals (Bærentzen & Aanæs, TVCG 2005).
 * Inputs must describe one closed, oriented, embedded component; source validation is separate.
 */
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const n = Math.hypot(...a);
  if (!(n > 0) || !Number.isFinite(n)) throw new Error('Normal de malla no resoluble');
  return a.map((x) => x / n) as V;
};
const read3 = (a: ArrayLike<number>, i: number): V => [a[i], a[i + 1], a[i + 2]];
export interface MeshField {
  vertices: Float32Array; // two RGBA texels: position, angle-weighted vertex pseudonormal
  faces: Float32Array; // two RGBA texels: vertex indices + original face ID, unit face normal
  adjacent: Float32Array; // one RGBA texel: neighbouring faces across AB, BC, CA
  nodes: Float32Array; // two RGBA texels: min + left/start, max + right/negative leaf count
  maxDepth: number;
  boundsPaddingMm: number;
}

export function buildMeshField(positions: ArrayLike<number>, triangles: ArrayLike<number>): MeshField {
  const vCount = positions.length / 3,
    fCount = triangles.length / 3;
  if (!Number.isInteger(vCount) || !Number.isInteger(fCount) || vCount < 4 || fCount < 4 || fCount > 1_000_000)
    throw new Error('Dimensiones de malla inválidas');
  const vertices = new Float32Array(vCount * 8),
    normalSum = new Float64Array(vCount * 3),
    normals = new Float64Array(fCount * 3),
    centres = new Float64Array(fCount * 3),
    neighbours = new Int32Array(fCount * 3).fill(-1),
    incident: number[][] = Array.from({ length: vCount }, () => []),
    unique = new Set<string>();
  let maxAbs = 0;
  for (let i = 0; i < vCount; i++) {
    const p = read3(positions, i * 3).map(Math.fround) as V;
    if (!p.every(Number.isFinite)) throw new Error('Vértice no finito');
    const key = p.join(',');
    if (unique.has(key)) throw new Error('La malla requiere soldadura exacta previa');
    unique.add(key);
    vertices.set(p, i * 8);
    maxAbs = Math.max(maxAbs, ...p.map(Math.abs));
  }
  const edges = new Map<string, { face: number; slot: number; a: number; paired: boolean }>();
  let volume6 = 0;
  const centre = read3(vertices, 0);
  for (let i = 0; i < fCount; i++) {
    const ids = read3(triangles, i * 3);
    if (ids.some((x) => !Number.isInteger(x) || x < 0 || x >= vCount) || new Set(ids).size !== 3) throw new Error('Triángulo inválido');
    const p = ids.map((id) => read3(vertices, id * 8));
    const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    normals.set(n, i * 3);
    centres.set(
      [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3),
      i * 3,
    );
    volume6 += dot(sub(p[0], centre), cross(sub(p[1], centre), sub(p[2], centre)));
    for (let k = 0; k < 3; k++) {
      const id = ids[k],
        u = sub(p[(k + 1) % 3], p[k]),
        w = sub(p[(k + 2) % 3], p[k]),
        angle = Math.atan2(Math.hypot(...cross(u, w)), dot(u, w));
      incident[id].push(i);
      for (let a = 0; a < 3; a++) normalSum[id * 3 + a] += angle * n[a];
      const next = ids[(k + 1) % 3],
        key = `${Math.min(id, next)},${Math.max(id, next)}`,
        previous = edges.get(key);
      if (previous) {
        if (previous.paired || previous.a === id) throw new Error('Arista no manifold o winding inconsistente');
        neighbours[i * 3 + k] = previous.face;
        neighbours[previous.face * 3 + previous.slot] = i;
        previous.paired = true;
      } else edges.set(key, { face: i, slot: k, a: id, paired: false });
    }
  }
  if (neighbours.some((x) => x < 0) || !(volume6 > 0)) throw new Error('Superficie abierta o volumen no positivo');
  // A single face component, with a single incident fan at every vertex.
  const seen = new Set<number>(),
    pending = [0];
  while (pending.length) {
    const f = pending.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    pending.push(...read3(neighbours, f * 3));
  }
  if (seen.size !== fCount) throw new Error('Se exige un único componente');
  for (let i = 0; i < vCount; i++) {
    if (!incident[i].length) throw new Error('Vértice sin caras');
    const allowed = new Set(incident[i]),
      visited = new Set<number>(),
      stack = [incident[i][0]];
    while (stack.length) {
      const f = stack.pop()!;
      if (visited.has(f)) continue;
      visited.add(f);
      for (const n of read3(neighbours, f * 3)) if (allowed.has(n) && !visited.has(n)) stack.push(n);
    }
    if (visited.size !== allowed.size) throw new Error('Enlace de vértice no manifold');
    vertices.set(unit(read3(normalSum, i * 3)), i * 8 + 4);
  }
  const order = Uint32Array.from({ length: fCount }, (_, i) => i),
    nodes: number[] = [],
    padding = Math.max(1e-4, maxAbs * 2 ** -22);
  let maxDepth = 0;
  const build = (lo: number, hi: number, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    if (depth > 30) throw new Error('BVH supera la pila GPU');
    const id = nodes.length / 8,
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity],
      cmin = [...min],
      cmax = [...max];
    nodes.push(0, 0, 0, 0, 0, 0, 0, 0);
    for (let i = lo; i < hi; i++) {
      const f = order[i];
      for (let a = 0; a < 3; a++) {
        cmin[a] = Math.min(cmin[a], centres[f * 3 + a]);
        cmax[a] = Math.max(cmax[a], centres[f * 3 + a]);
        for (const v of read3(triangles, f * 3)) {
          min[a] = Math.min(min[a], vertices[v * 8 + a]);
          max[a] = Math.max(max[a], vertices[v * 8 + a]);
        }
      }
    }
    let left: number, right: number;
    if (hi - lo <= 8) {
      left = lo;
      right = -(hi - lo);
    } else {
      const span = cmax.map((v, a) => v - cmin[a]),
        axis = span.indexOf(Math.max(...span)),
        mid = (lo + hi) >>> 1;
      order.subarray(lo, hi).sort((a, b) => centres[a * 3 + axis] - centres[b * 3 + axis] || a - b);
      left = build(lo, mid, depth + 1);
      right = build(mid, hi, depth + 1);
    }
    nodes.splice(id * 8, 8, ...min.map((v) => v - padding), left, ...max.map((v) => v + padding), right);
    return id;
  };
  build(0, fCount, 0);
  const reverse = new Uint32Array(fCount),
    faces = new Float32Array(fCount * 8),
    adjacent = new Float32Array(fCount * 4);
  order.forEach((f, i) => (reverse[f] = i));
  order.forEach((f, i) => {
    faces.set([...read3(triangles, f * 3), f, ...read3(normals, f * 3), 0], i * 8);
    adjacent.set(
      read3(neighbours, f * 3).map((n) => reverse[n]),
      i * 4,
    );
  });
  return { vertices, faces, adjacent, nodes: Float32Array.from(nodes), maxDepth, boundsPaddingMm: padding };
}

function closest(p: V, a: V, b: V, c: V): { point: V; feature: number; distance2: number } {
  const v = [a, b, c];
  let point = a,
    feature = 0,
    distance2 = Infinity;
  for (let e = 0; e < 3; e++) {
    const u = v[e],
      w = v[(e + 1) % 3],
      d = sub(w, u),
      t = Math.max(0, Math.min(1, dot(sub(p, u), d) / dot(d, d))),
      q = u.map((x, j) => x + t * d[j]) as V,
      delta = sub(p, q),
      r2 = dot(delta, delta);
    if (r2 < distance2) {
      distance2 = r2;
      point = q;
      feature = t === 0 ? e : t === 1 ? (e + 1) % 3 : 3 + e;
    }
  }
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a),
    n = cross(ab, ac),
    n2 = dot(n, n);
  if (n2 > 1e-30) {
    const u = dot(cross(ap, ac), n) / n2,
      w = dot(cross(ab, ap), n) / n2;
    if (u > 0 && w > 0 && u + w < 1) {
      const q = a.map((x, j) => x + u * ab[j] + w * ac[j]) as V,
        d = sub(p, q),
        r2 = dot(d, d);
      if (r2 < distance2) {
        point = q;
        feature = 6;
        distance2 = r2;
      }
    }
  }
  return { point, feature, distance2 };
}

export function queryMeshField(field: MeshField, p: V): { distance: number; normal: V; face: number; visited: number } {
  if (!p.every(Number.isFinite)) throw new Error('Consulta no finita');
  const { nodes, faces, vertices, adjacent } = field,
    stack = [0];
  let best = Infinity,
    bestFace = -1,
    bestFeature = -1,
    bestPoint: V = [0, 0, 0],
    visited = 0;
  const box = (id: number) =>
    [0, 1, 2].reduce((s, a) => {
      const d = Math.max(nodes[id * 8 + a] - p[a], 0, p[a] - nodes[id * 8 + 4 + a]);
      return s + d * d;
    }, 0);
  while (stack.length) {
    const id = stack.pop()!;
    if (++visited > nodes.length / 8) throw new Error('BVH inválido');
    if (box(id) > best) continue;
    const left = nodes[id * 8 + 3],
      right = nodes[id * 8 + 7];
    if (right < 0) {
      for (let f = left; f < left - right; f++) {
        const ids = read3(faces, f * 8),
          q = closest(p, ...(ids.map((i) => read3(vertices, i * 8)) as [V, V, V]));
        if (q.distance2 < best) {
          best = q.distance2;
          bestPoint = q.point;
          bestFeature = q.feature;
          bestFace = f;
        }
      }
    } else if (box(left) < box(right)) stack.push(right, left);
    else stack.push(left, right);
  }
  if (bestFace < 0 || !Number.isFinite(best)) throw new Error('No se encontró superficie');
  let pseudo: V;
  if (bestFeature < 3) pseudo = read3(vertices, faces[bestFace * 8 + bestFeature] * 8 + 4);
  else if (bestFeature < 6) {
    const other = adjacent[bestFace * 4 + bestFeature - 3],
      a = read3(faces, bestFace * 8 + 4),
      b = read3(faces, other * 8 + 4);
    pseudo = a.map((x, i) => x + b[i]) as V;
  } else pseudo = read3(faces, bestFace * 8 + 4);
  const delta = sub(p, bestPoint),
    sign = dot(delta, pseudo) < 0 ? -1 : 1,
    d = Math.sqrt(best);
  return {
    distance: sign * d,
    normal: d > 1e-12 ? (delta.map((x) => (sign * x) / d) as V) : unit(pseudo),
    face: faces[bestFace * 8 + 3],
    visited,
  };
}
