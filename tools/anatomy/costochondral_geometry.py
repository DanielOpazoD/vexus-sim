"""Oráculo offline BodyParts3D; sólo archivos locales explícitos, sin red ni runtime.
DBCLS / BodyParts3D release4, CC BY4.0; procedencia en docs/anatomy.
"""
import hashlib
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

ORIGIN = np.array([-.3152345, -205.92635, 1164.5735])
CENTRE_Y = -21.106195
HASHES = {
    'FJ2810': '50fb17d0b3559b8b6c5481dbe7f877d25726e576564da615c45b2dd7654e315d',
    'FJ3346': '91aa56e034fbe6f413c0f15b76d725a1f8efd115aa2900beda6edf43a3ab0c43',
    'FJ3345': 'a4d22796f4ffc6f9ad1b7d620c917be1638244864eca62aec60bd11033ed3041',
    'FJ3234': '638a766f20b64d02095efa845b5ea316624a376acb44c7e4a6d533d4da6ef4db',
    'FJ3255': '97e69ede580a6e81cc42bb54fb22d4752719b61c5fced8ccccfb18ce64996676',
}
PAIRS = {'right': {'bone': 'FJ3346', 'cartilage': 'FJ3345'},
         'left': {'bone': 'FJ3234', 'cartilage': 'FJ3255'}}


def load_mesh(directory, element):
    path = Path(directory) / (element + '.obj')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != HASHES[element]:
        raise ValueError('SHA256 no coincide: ' + element)
    vertices, faces = [], []
    for line in raw.decode('utf-8').splitlines():
        parts = line.split()
        if parts and parts[0] == 'v':
            vertices.append(list(map(float, parts[1:4])))
        elif parts and parts[0] == 'f':
            if len(parts) != 4:
                raise ValueError('El oráculo exige triángulos: ' + element)
            faces.append([int(p.split('/')[0]) - 1 for p in parts[1:]])
    v, f = np.asarray(vertices), np.asarray(faces, dtype=int)
    if v.ndim != 2 or v.shape[1] != 3 or not np.isfinite(v).all():
        raise ValueError('Vértices inválidos: ' + element)
    if not len(f) or f.min() < 0 or f.max() >= len(v):
        raise ValueError('Índices inválidos: ' + element)
    v = v - ORIGIN
    v[:, 1] = 85.25 - v[:, 1]
    return v, f[:, [0, 2, 1]]  # reflexión LAS: invertir winding


def surface_samples(v, f):
    return np.concatenate([v[np.unique(f)], v[f].mean(axis=1)])


def summary(values):
    x = np.asarray(values)
    if not len(x) or not np.isfinite(x).all():
        raise ValueError('Métricas sin muestras finitas')
    return {'count': len(x), 'min': float(x.min()), 'rms': float(np.sqrt(np.mean(x*x))),
            'p95': float(np.percentile(x, 95)), 'max': float(x.max())}


class TriangleQuery:
    """Distancia exacta punto/triángulo con poda conservadora, no signo local."""
    def __init__(self, v, f):
        self.tri = v[f]
        self.centres = self.tri.mean(axis=1)
        self.radius = np.linalg.norm(self.tri - self.centres[:, None, :], axis=2).max()
        self.tree = cKDTree(self.centres)
        self.vertex_tree = cKDTree(v[np.unique(f)])

    def distance(self, points):
        bounds = self.vertex_tree.query(points)[0]
        distances = []
        for p, upper in zip(points, bounds):
            # Toda cara que pueda ganar está a <=upper+radio de su centroide.
            ids = self.tree.query_ball_point(p, float(upper + self.radius + 1e-9))
            t = self.tri[ids]
            a = t[:, 0]; e = t[:, 1] - a; g = t[:, 2] - a; w = p - a
            n = np.cross(e, g); nn = np.sum(n*n, axis=1)
            ee = np.sum(e*e, axis=1); eg = np.sum(e*g, axis=1); gg = np.sum(g*g, axis=1)
            we = np.sum(w*e, axis=1); wg = np.sum(w*g, axis=1)
            den = ee*gg - eg*eg
            u = np.divide(gg*we-eg*wg, den, out=np.full(len(t), -1.), where=den > 1e-20)
            v = np.divide(ee*wg-eg*we, den, out=np.full(len(t), -1.), where=den > 1e-20)
            inside = (u >= 0) & (v >= 0) & (u+v <= 1)
            wn = np.sum(w*n, axis=1)
            d2 = np.where(inside, wn*wn/np.maximum(nn, 1e-30), np.inf)
            for j, k in [(0, 1), (1, 2), (2, 0)]:
                edge = t[:, k] - t[:, j]; delta = p - t[:, j]
                s = np.clip(np.sum(delta*edge, axis=1)/np.maximum(np.sum(edge*edge, axis=1), 1e-30), 0, 1)
                d2 = np.minimum(d2, np.sum((delta-edge*s[:, None])**2, axis=1))
            distances.append(np.sqrt(d2.min()))
        return np.asarray(distances)


class YRays:
    """Intersecciones completas en y; paridad de malla cerrada, sin normales radiales."""
    def __init__(self, v, f):
        self.tri = v[f]
        xz = self.tri[:, :, [0, 2]]
        centres = xz.mean(axis=1)
        self.radius = np.linalg.norm(xz-centres[:, None, :], axis=2).max()
        self.tree = cKDTree(centres)

    def hits(self, x, z):
        ids = self.tree.query_ball_point([x, z], float(self.radius+1e-8))
        t = self.tri[ids]
        a = t[:, 0]; e = t[:, 1]-a; g = t[:, 2]-a
        dx = x-a[:, 0]; dz = z-a[:, 2]
        den = e[:, 0]*g[:, 2]-e[:, 2]*g[:, 0]
        valid = abs(den) > 1e-12
        u = np.divide(dx*g[:, 2]-dz*g[:, 0], den, out=np.full(len(t), -1.), where=valid)
        v = np.divide(e[:, 0]*dz-e[:, 2]*dx, den, out=np.full(len(t), -1.), where=valid)
        mask = valid & (u >= -1e-9) & (v >= -1e-9) & (u+v <= 1+1e-9)
        # Soldar hits de aristas compartidas; escala numérica, no tolerancia anatómica.
        return np.unique(np.round(a[mask, 1]+u[mask]*e[mask, 1]+v[mask]*g[mask, 1], 8))

    def classify_grid(self, xs, ys, zs):
        inside = np.zeros((len(xs), len(ys), len(zs)), dtype=bool)
        odd_lines = 0
        for i, x in enumerate(xs):
            for k, z in enumerate(zs):
                hits = self.hits(x, z)
                odd_lines += len(hits) % 2
                inside[i, :, k] = (len(hits)-np.searchsorted(hits, ys, side='right')) % 2 == 1
        return inside, odd_lines


def profile_field(points, part):
    rows = np.asarray(part['rows'])
    theta = np.arctan2(points[:, 1]-CENTRE_Y, abs(points[:, 0]))
    rho = np.hypot(points[:, 0], points[:, 1]-CENTRE_Y)
    i = np.clip(np.searchsorted(rows[:, 0], theta)-1, 0, len(rows)-2)
    t = np.clip((theta-rows[i, 0])/(rows[i+1, 0]-rows[i, 0]), 0, 1)
    q = rows[i]+(rows[i+1]-rows[i])*t[:, None]
    dr = rho-q[:, 1]; dz = points[:, 2]-q[:, 2]
    c = np.cos(q[:, 5]); s = np.sin(q[:, 5])
    d = (np.hypot((dr*c+dz*s)/q[:, 3], (-dr*s+dz*c)/q[:, 4])-1)*np.minimum(q[:, 3], q[:, 4])
    result = np.maximum.reduce([d, (rows[0, 0]-theta)*rho, (theta-rows[-1, 0])*rho])
    if part.get('side') == 'right':
        result = np.maximum(result, points[:, 0])
    elif part.get('side') == 'left':
        result = np.maximum(result, -points[:, 0])
    return result


def profile_mesh(part, angular, circumference):
    """Triangulación del nivel cero: anillos de campo y discos de ambos extremos."""
    rows = np.asarray(part['rows'])
    angles = np.unique(np.r_[np.linspace(rows[0, 0], rows[-1, 0], angular), rows[:, 0]])
    i = np.clip(np.searchsorted(rows[:, 0], angles)-1, 0, len(rows)-2)
    t = (angles-rows[i, 0])/(rows[i+1, 0]-rows[i, 0])
    q = rows[i]+(rows[i+1]-rows[i])*t[:, None]
    beta = np.arange(circumference)*2*np.pi/circumference
    vertices, faces = [], []
    sign = -1 if part['side'] == 'right' else 1
    for theta, cr, cz, a, b, rotation in q:
        dr = a*np.cos(beta)*np.cos(rotation)-b*np.sin(beta)*np.sin(rotation)
        dz = a*np.cos(beta)*np.sin(rotation)+b*np.sin(beta)*np.cos(rotation)
        r = cr+dr
        vertices.extend(np.c_[sign*r*np.cos(theta), CENTRE_Y+r*np.sin(theta), cz+dz])
    for j in range(len(q)-1):
        for k in range(circumference):
            a = j*circumference+k; b = j*circumference+(k+1) % circumference
            c = a+circumference; d = b+circumference
            faces.extend([[a, b, c], [b, d, c]])
    for j in [0, len(q)-1]:
        theta, cr, cz = q[j, :3]; centre = len(vertices)
        vertices.append([sign*cr*np.cos(theta), CENTRE_Y+cr*np.sin(theta), cz])
        for k in range(circumference):
            a = j*circumference+k; b = j*circumference+(k+1) % circumference
            faces.append([centre, b, a] if j == 0 else [centre, a, b])
    return np.asarray(vertices), np.asarray(faces)


def topology(v, f):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    unique, ids = np.unique(v, axis=0, return_inverse=True)
    wf = ids[f]
    directed = np.concatenate([wf[:, [0, 1]], wf[:, [1, 2]], wf[:, [2, 0]]])
    edges = np.sort(directed, axis=1)
    edge, inverse, counts = np.unique(edges, axis=0, return_inverse=True, return_counts=True)
    orientation = np.bincount(inverse, weights=np.where(directed[:, 0] < directed[:, 1], 1, -1))
    graph = coo_matrix((np.ones(len(edge)), (edge[:, 0], edge[:, 1])), shape=(len(unique), len(unique)))
    used = np.unique(wf)
    count, labels = connected_components(graph.tocsr()[used][:, used], directed=False)
    by_vertex = np.full(len(unique), -1); by_vertex[used] = labels
    components = []
    for k in range(count):
        faces = f[by_vertex[wf[:, 0]] == k]
        points = v[np.unique(faces)]; tri = v[faces]
        centred = tri-points.mean(axis=0)
        area = np.linalg.norm(np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]), axis=1).sum()/2
        volume = np.sum(centred[:, 0]*np.cross(centred[:, 1], centred[:, 2]))/6
        components.append({'triangles': len(faces), 'usedOriginalVertices': len(points),
            'surfaceAreaMm2': float(area), 'signedEnclosedVolumeMm3': float(volume),
            'minLasMm': points.min(axis=0).tolist(), 'maxLasMm': points.max(axis=0).tolist()})
    return {'usedVerticesAfterExactWeld': len(used), 'surfaceComponents': int(count),
            'boundaryEdges': int((counts == 1).sum()), 'nonManifoldEdges': int((counts > 2).sum()),
            'inconsistentOrientedEdges': int((orientation != 0).sum()),
            'degenerateTriangles': int((np.linalg.norm(np.cross(v[f[:, 1]]-v[f[:, 0]], v[f[:, 2]]-v[f[:, 0]]), axis=1) <= 1e-12).sum()),
            'components': components}
