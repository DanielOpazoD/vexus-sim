"""Reproducir la candidata elíptica DESCARTADA, sin modificar ningún asset runtime.
Sólo investigación offline: contexto y atribución en COSTOCHONDRAL_BENCHMARK.md.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
from costochondral_geometry import ORIGIN, CENTRE_Y, PAIRS, HASHES, load_mesh, profile_field, summary


def section(v, f, theta):
    t = v[f]
    d = abs(t[:, :, 0])*np.sin(theta)-(t[:, :, 1]-CENTRE_Y)*np.cos(theta)
    mask = (d.min(axis=1) <= 0) & (d.max(axis=1) > 0)
    segments = []
    for ps, ds in zip(t[mask], d[mask]):
        hits = []
        for a, b in [(0, 1), (1, 2), (2, 0)]:
            if ds[a] <= 0 < ds[b] or ds[b] <= 0 < ds[a]:
                p = ps[a]+(ps[b]-ps[a])*(ds[a]/(ds[a]-ds[b]))
                hits.append([abs(p[0])*np.cos(theta)+(p[1]-CENTRE_Y)*np.sin(theta), p[2]])
        if len(hits) == 2:
            segments.append(hits)
    if not segments:
        raise ValueError('Corte sin segmentos')
    return np.asarray(segments)


def fit(directory, joints):
    result = []
    for side, pair in PAIRS.items():
        joint = next(j for j in joints if j['side'] == side)
        for tissue, element in pair.items():
            v, f = load_mesh(directory, element); used = v[np.unique(f)]
            # Orden de entradas del ajuste original; no se emite una malla con este winding.
            f = f[:, [0, 2, 1]]
            angles_used = np.arctan2(used[:, 1]-CENTRE_Y, abs(used[:, 0]))
            point = np.asarray(joint[tissue+'SourceVertexLpsMm'])-ORIGIN
            point[1] = 85.25-point[1]
            if np.linalg.norm(used-point, axis=1).min() > 1e-6:
                raise ValueError('Anchor no pertenece a vértices usados: '+element)
            angle = np.arctan2(point[1]-CENTRE_Y, abs(point[0]))
            anchor = np.array([np.hypot(point[0], point[1]-CENTRE_Y), point[2]])
            angles = np.unique(np.r_[np.linspace(angles_used.min()+1e-5, angles_used.max()-1e-5, 65), angle])
            rows = []; unconverged = []
            for theta in angles:
                seg = section(v, f, theta); h = seg.reshape(-1, 2)
                lengths = np.maximum(np.linalg.norm(seg[:, 1]-seg[:, 0], axis=1), 1e-8)
                weight = np.repeat(np.sqrt(lengths), 2); weight /= np.sqrt(np.mean(weight**2))
                centre = np.average(h, axis=0, weights=weight**2)
                covariance = ((h-centre)*weight[:, None]).T@((h-centre)*weight[:, None])/np.sum(weight**2)
                eigen, vectors = np.linalg.eigh(covariance)
                axes = np.sqrt(np.maximum(eigen[::-1]*2, .0001))
                rotation = np.arctan2(vectors[1, -1], vectors[0, -1])

                def distance(points, q):
                    dr, dz = (points-q[:2]).T; c = np.cos(q[4]); s = np.sin(q[4])
                    return (np.hypot((dr*c+dz*s)/q[2], (-dr*s+dz*c)/q[3])-1)*min(q[2], q[3])

                def objective(q):
                    error = distance(h, q)*weight
                    extents = np.sqrt([(q[2]*np.cos(q[4]))**2+(q[3]*np.sin(q[4]))**2,
                                       (q[2]*np.sin(q[4]))**2+(q[3]*np.cos(q[4]))**2])
                    violation = np.r_[np.maximum(0, h.min(axis=0)-(q[:2]-extents)),
                                      np.maximum(0, (q[:2]+extents)-h.max(axis=0))]
                    error = np.r_[error, violation*np.sqrt(len(h))*4]
                    if abs(theta-angle) < 1e-12:
                        error = np.r_[error, distance(anchor[None, :], q)*1000]
                    return error

                maximum = max(.006, float(np.linalg.norm(h.max(axis=0)-h.min(axis=0))))
                initial = np.r_[np.clip(centre, h.min(axis=0)+1e-9, h.max(axis=0)-1e-9),
                                np.clip(axes, .005001, maximum-1e-9), rotation]
                solver = least_squares(objective, initial, bounds=([*h.min(axis=0), .005, .005, -20],
                    [*h.max(axis=0), maximum, maximum, 20]), max_nfev=500)
                q = solver.x
                if not solver.success:
                    unconverged.append({'thetaRad': float(theta), 'status': int(solver.status), 'evaluations': int(solver.nfev), 'reason': solver.message})
                if q[2] < q[3]:
                    q[2], q[3] = q[3], q[2]; q[4] += np.pi/2
                q[4] = (q[4]+np.pi/2) % np.pi-np.pi/2
                rows.append([theta, *q])
            rows = np.asarray(rows); rows[:, -1] = np.unwrap(rows[:, -1]*2)/2
            chosen = [0, len(angles)-1, int(np.argmin(abs(angles-angle)))]
            while len(chosen) < 16:
                choices = []
                for k in range(len(angles)):
                    if k in chosen:
                        continue
                    e = abs(profile_field(used, {'rows': rows[sorted(chosen+[k])]}))
                    choices.append((np.percentile(e, 95)+np.sqrt(np.mean(e*e)), k))
                chosen.append(min(choices)[1])
            part = {'id': element, 'side': side, 'tissue': tissue, 'sha256': HASHES[element],
                'centreYmm': CENTRE_Y, 'rows': rows[sorted(chosen)].tolist(),
                'jointSourcePointLasMm': point.tolist(), 'unconvergedSections': unconverged}
            part['jointFieldMm'] = float(profile_field(point[None, :], part)[0])
            part['residualMm'] = summary(abs(profile_field(used, {'rows': part['rows']})))
            result.append(part)
            print(element, part['residualMm'], flush=True)
    return {'method': '16 adaptive source triangle-plane sections per piece; independent sides; perimeter-weighted rotated ellipse; bounded centre/axes; constrained native vertex. REJECTED by whole-joint audit.',
        'credit': 'BodyParts3D, © DBCLS, CC BY4.0; source provenance in reference-source-manifest.json',
        'integrated': False, 'clinicalValidation': False, 'parts': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Salida debe ser nueva')
    root = Path(__file__).resolve().parents[2]
    joints = json.loads((root/'docs/anatomy/source-costochondral-distances.json').read_text())['parts']
    result = fit(args.atlas, joints)
    with args.output.open('x') as out:
        out.write(json.dumps(result, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
