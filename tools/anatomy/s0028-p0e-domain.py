"""P0e offline: piel de 1024 rayos / 0,75 mm y EDT con exterior no tisular."""
import argparse
import gzip
import importlib.util
import json
from pathlib import Path
import time

import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

Z_DOMAIN = (-210., 60.)
RAYS = 1024
SKIN_STEP = .75


def domain(points):
    return (points[:, 2] >= Z_DOMAIN[0]) & (points[:, 2] <= Z_DOMAIN[1])


def interpolate_xy(nodes, z, phase, origin_z):
    at = (np.arange(1024)+phase)*RAYS/1024
    a = np.floor(at).astype(int); t = (at-a)[None, :, None]; a %= RAYS
    qz = np.clip((z-origin_z)/SKIN_STEP, 0, len(nodes)-1)
    k = np.minimum(np.floor(qz).astype(int), len(nodes)-2)
    tz = (qz-k)[:, None, None]
    low = nodes[k[:, None], a]*(1-t)+nodes[k[:, None], (a+1)%RAYS]*t
    high = nodes[(k+1)[:, None], a]*(1-t)+nodes[(k+1)[:, None], (a+1)%RAYS]*t
    return np.concatenate([low*(1-tz)+high*tz, np.broadcast_to(z[:, None, None], (len(z), 1024, 1))], axis=2).reshape(-1, 3)


def scalar_sample(array, points, origin, pitch):
    return ndi.map_coordinates(array, ((points-origin)/pitch).T, order=1, mode='nearest', prefilter=False)


def depth_policy(sdf, points, sdf_origin):
    hi = sdf_origin+(np.array(sdf.shape)-1)*3
    clamped = np.clip(points, sdf_origin, hi)
    inside = np.all(clamped == points, axis=1)
    return scalar_sample(sdf, clamped, sdf_origin, 3.)+np.linalg.norm(points-clamped, axis=1), inside


def consumed_stats(error):
    if len(error) == 0:
        return {'samples': 0, 'p95Mm': None, 'maxMm': None, 'pass': False}
    return {'samples': len(error), 'p95Mm': float(np.quantile(error, .95)),
            'maxMm': float(error.max()), 'pass': bool(np.quantile(error, .95) <= 1.5 and error.max() <= 3)}


def depth_axes(body, origin):
    zi = np.flatnonzero((origin[2]+np.arange(body.shape[2])*1.5 >= Z_DOMAIN[0]) &
                        (origin[2]+np.arange(body.shape[2])*1.5 <= Z_DOMAIN[1]))
    occupied = np.argwhere(np.any(body[:, :, zi], axis=2))
    lo = np.r_[occupied.min(0)-8, int(np.floor((Z_DOMAIN[0]-6-origin[2])/1.5))]
    hi = np.r_[occupied.max(0)+8, int(np.ceil((Z_DOMAIN[1]+6-origin[2])/1.5))]
    lo = (lo//2)*2; hi = ((hi+1)//2)*2
    return [np.arange(a, b+1, 2) for a, b in zip(lo, hi)], zi


def run(source, model, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    SPEC = importlib.util.spec_from_file_location('skin', Path(__file__).with_name('s0028-skin.py'))
    skin = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(skin)
    out.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((source/'fields.json').read_text())
    if skin.lib.sha((source/'body-source.npz').read_bytes()) != metadata['bodySourceSha256']:
        raise ValueError('Máscara fuente alterada')
    body_data = np.load(source/'body-source.npz')
    body, origin = body_data['body'], body_data['origin']
    levels = origin[2]+np.arange(body.shape[2])*1.5
    levels = levels[levels <= 120]
    native_levels = levels.copy()
    levels = origin[2]+np.arange((len(levels)-1)*2+1)*SKIN_STEP
    angles = np.arange(RAYS)*2*np.pi/RAYS
    radii = np.arange(0, 400.125, .25)
    nodes = np.empty((len(levels), RAYS, 2), '<f2')
    multiplicity = []
    for zi, z in enumerate(levels):
        qz = (z-origin[2])/1.5
        j = min(int(qz), body.shape[2]-2); t = qz-j
        section = body[:, :, j].astype(float)*(1-t)+body[:, :, j+1]*t
        occupied = np.argwhere(section >= .5)
        cy = origin[1]+(occupied[:, 1].min()+occupied[:, 1].max())*.75
        xy = np.stack([radii[None, :]*np.cos(angles[:, None]), cy+radii[None, :]*np.sin(angles[:, None])])
        values = ndi.map_coordinates(section.astype(float), (xy-origin[:2, None, None])/1.5,
                                    order=1, mode='constant', cval=0, prefilter=False)
        inside = values >= .5
        if not np.all(inside.any(axis=1)):
            raise ValueError('Rayo sin frontera')
        k = inside.shape[1]-1-np.argmax(inside[:, ::-1], axis=1)
        if np.any(k == inside.shape[1]-1):
            raise ValueError('Radio truncado')
        v = values[np.arange(RAYS), k]; w = values[np.arange(RAYS), k+1]
        r = radii[k]+(.5-v)*.25/(w-v)
        nodes[zi] = np.column_stack([r*np.cos(angles), cy+r*np.sin(angles)])
        multiplicity.append({'zMm': float(z), 'raysWithReentry': int(np.count_nonzero(np.any(inside[:, 1:] & ~inside[:, :-1], axis=1)))})
    file = out/'skin-polar.gzip.bin'
    raw = nodes.tobytes(); file.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    if gzip.decompress(file.read_bytes()) != raw:
        raise ValueError('Piel no recuperada')
    recovered = np.frombuffer(gzip.decompress(file.read_bytes()), '<f2').reshape(nodes.shape).astype(float)
    source_points = np.fromfile(source/'skin-points.f32', '<f4').reshape(-1, 3)
    source_tree = cKDTree(source_points)
    old_profile = np.fromfile(source/'profile.bin', '<f4').reshape(14, 65)
    planes = [p for p in json.loads((model/'planes.json').read_text())['planes'] if 'phi' in p]
    results = {}
    witnesses = []
    midpoint = None
    midpoint_errors = None
    for fraction in [0, .25, .5, .75]:
        z = native_levels if fraction == 0 else native_levels[:-1]+fraction*1.5
        p = interpolate_xy(recovered, z, .37, origin[2])
        to_source = source_tree.query(p)[0]
        to_model = cKDTree(p).query(source_points)[0]
        windows = {plane['id']: {
            'sourceToProfile': skin.stats(to_model[skin.window_mask(source_points, old_profile, plane)]),
            'profileToSource': skin.stats(to_source[skin.window_mask(p, old_profile, plane)])} for plane in planes}
        sd, pd = domain(source_points), domain(p)
        results[str(fraction)] = {
            'domain': {'sourceToProfile': skin.stats(to_model[sd]), 'profileToSource': skin.stats(to_source[pd])},
            'outside': {'sourceToProfile': skin.stats(to_model[~sd]), 'profileToSource': skin.stats(to_source[~pd])},
            'windows': windows}
        for name, pp, error, mask in [('profileToSource', p, to_source, pd), ('sourceToProfile', source_points, to_model, sd)]:
            ids = np.flatnonzero(mask); k = ids[np.argmax(error[mask])]
            witnesses.append({'fraction': fraction, 'direction': name, 'LASmm': pp[k].tolist(), 'errorMm': float(error[k])})
        if fraction == .5:
            midpoint, midpoint_errors = p, to_source
    accepted = all(v['pass'] for result in results.values() for v in result['domain'].values())
    descriptor = {'format': 'RG16F XY, global periodic polar phi', 'dimensions': [RAYS, len(levels)],
                  'pitchZMm': SKIN_STEP, 'originZMm': float(origin[2]), 'phiRange': [0, 2*np.pi],
                  'sourceBodySha256': metadata['bodySourceSha256'], 'rawBytes': len(raw),
                  'gzipBytes': file.stat().st_size, 'sha256Raw': skin.lib.sha(raw),
                  'sha256Gzip': skin.lib.sha(file.read_bytes()), 'file': file.name,
                  'cpuSkinPointReads': 4, 'cpuProbeFrameQueries': 5, 'gpuOptionalSamplerCount': 1}
    skin.lib.save(out/'skin.json', {'descriptor': descriptor, 'domainZMm': Z_DOMAIN, 'phiFullCircle': True,
                                  'fractions': results, 'witnesses': witnesses, 'multiplicity': multiplicity,
                                  'accepted': accepted, 'clinicalValidation': False})
    # SDF nativo completo: no recortar la máscara antes de EDT, pues crearía tapas falsas.
    started = time.perf_counter()
    native = ndi.distance_transform_edt(body).astype(np.float32)*-1.5+.75
    exterior = ndi.distance_transform_edt(~body).astype(np.float32)*1.5-.75
    native[~body] = exterior[~body]
    del exterior
    axes, zi = depth_axes(body, origin)
    sdf = native[np.ix_(*[np.clip(a, 0, body.shape[i]-1) for i, a in enumerate(axes)])].astype('<f2')
    sdf_origin = origin+np.array([a[0] for a in axes])*1.5
    # Hardware GL XYZ requiere almacenamiento ZYX.
    sdf_raw = np.ascontiguousarray(sdf.transpose(2, 1, 0)).tobytes()
    sdf_file = out/'body-depth.gzip.bin'; sdf_file.write_bytes(gzip.compress(sdf_raw, compresslevel=9, mtime=0))
    decoded = np.frombuffer(gzip.decompress(sdf_file.read_bytes()), '<f2').reshape(sdf.shape[::-1]).transpose(2, 1, 0).astype(np.float32)
    if not np.array_equal(decoded, sdf.astype(np.float32)):
        raise ValueError('Profundidad no recuperada')
    depth_results = []
    pp = source_points[domain(source_points)].astype(float)
    cy = np.interp(pp[:, 2], np.arange(-400, 121, 40), old_profile[:, 0])
    radial = pp[:, :2]-np.column_stack([np.zeros(len(pp)), cy])
    radial /= np.linalg.norm(radial, axis=1)[:, None]
    offsets = [-30, -12, -6, -3, -1.5, 0, 1.5, 3, 6, 12, 30]
    for offset in offsets:
        probe = pp.copy(); probe[:, :2] += offset*radial
        reference = scalar_sample(native, probe, origin, 1.5)
        actual, within = depth_policy(decoded, probe, sdf_origin)
        error = np.abs(actual-reference)
        reference_available = np.all((probe >= origin) & (probe <= origin+(np.array(body.shape)-1)*1.5), axis=1)
        consumed = (reference <= 6) & reference_available
        eligible = (np.abs(reference) > 1.5) & reference_available
        sign_errors = int(np.count_nonzero((np.sign(actual) != np.sign(reference)) & eligible))
        depth_results.append({'radialOffsetMm': offset, **skin.stats(error[reference_available]),
                              'referenceUnavailableSamples': int(np.count_nonzero(~reference_available)),
                              'referencePolicy': 'no numeric accuracy claim outside native CT grid; unresolved coverage remains a failed gate',
                              'signErrorsBeyond1p5mm': sign_errors,
                              'consumedError': consumed_stats(error[consumed]),
                              'consumedOutsideBox': int(np.count_nonzero(consumed & ~within)),
                              'outsideTextureBox': int(np.count_nonzero(~within)),
                              'insideTextureError': skin.stats(error[within & reference_available]),
                              'farExteriorMagnitudeDiagnostic': skin.stats(error[~within & reference_available]) if np.any(~within & reference_available) else None,
                              'nativeAbsSurfaceResidual': skin.stats(np.abs(reference)) if offset == 0 else None})
    interior_results = []
    # Bloques axiales para no duplicar la EDT completa ni generar un cubo temporal.
    for phase in [0., .5]:
        errors = []
        sign_errors = 0
        step = 1 if phase == 0 else 2
        for k in range(int(zi[0]), int(zi[-1])+1, step):
            ij = np.argwhere(body[::step, ::step, k])*step
            points = origin+np.column_stack([ij, np.full(len(ij), k)])*1.5+phase*1.5
            points = points[domain(points)]
            ref = scalar_sample(native, points, origin, 1.5)
            actual, within = depth_policy(decoded, points, sdf_origin)
            if not np.all(within):
                raise ValueError('Tejido fuera de caja')
            errors.append(np.abs(actual-ref))
            sign_errors += int(np.count_nonzero((np.sign(actual) != np.sign(ref)) & (np.abs(ref)>1.5)))
        interior_results.append({'phaseVoxel': phase, **skin.stats(np.concatenate(errors)), 'signErrorsBeyond1p5mm': sign_errors})
    boundaries = []
    for axis in [0, 1]:
        others = [i for i in range(3) if i != axis]
        for side in [0, 1]:
            grid = np.meshgrid(*[sdf_origin[i]+np.arange(sdf.shape[i])*3 for i in others], indexing='ij')
            points = np.empty((grid[0].size, 3)); points[:, axis] = sdf_origin[axis]+side*(sdf.shape[axis]-1)*3
            for i, g in zip(others, grid): points[:, i] = g.ravel()
            points = points[domain(points)]
            lower=points.copy(); upper=points.copy(); lower[:, axis]-=1e-6; upper[:, axis]+=1e-6
            a, _ = depth_policy(decoded, lower, sdf_origin); b, _ = depth_policy(decoded, upper, sdf_origin)
            ref=scalar_sample(native, points, origin, 1.5)
            available = np.all((points >= origin) & (points <= origin+(np.array(body.shape)-1)*1.5), axis=1)
            boundaries.append({'axis':axis,'side':side,'minReferenceDepthMm':float(ref[available].min()) if np.any(available) else None, 'referenceUnavailableSamples':int(np.count_nonzero(~available)),
                               'minReturnedDepthMm':float(np.minimum(a,b).min()),'maxJumpMm':float(np.max(np.abs(a-b))),
                               'entireFaceBeyondConsumedRegion':bool(np.all(available) and np.all(ref>6))})
    fine_results = {}
    for fraction in [.25, .5, .75]:
        points = interpolate_xy(recovered, levels[:-1]+fraction*SKIN_STEP, .37, origin[2])
        e = source_tree.query(points)[0]; inverse = cKDTree(points).query(source_points)[0]
        fine_results[str(fraction)] = {'profileToSource':skin.stats(e[domain(points)]), 'sourceToProfile':skin.stats(inverse[domain(source_points)])}
    skin_record = json.loads((out/'skin.json').read_text()); skin_record['fineStepDiagnostics'] = fine_results
    skin.lib.save(out/'skin.json', skin_record)
    depth_descriptor = {'format': 'R16F signed EDT, negative inside; 3mm hardware linear',
                        'dimensions': list(sdf.shape), 'originMm': sdf_origin.tolist(), 'pitchMm': 3.,
                        'rawBytes': len(sdf_raw), 'gzipBytes': sdf_file.stat().st_size,
                        'sha256Raw': skin.lib.sha(sdf_raw), 'sha256Gzip': skin.lib.sha(sdf_file.read_bytes()),
                        'file': sdf_file.name, 'sourceBodySha256': metadata['bodySourceSha256']}
    skin.lib.save(out/'depth.json', {'descriptor': depth_descriptor, 'offsets': depth_results, 'interior': interior_results, 'boundaryFaces': boundaries,
             'seconds': time.perf_counter()-started, 'accepted': all(r['referenceUnavailableSamples'] == 0 and r['consumedError']['pass'] and r['consumedOutsideBox'] == 0 and r['signErrorsBeyond1p5mm'] == 0 for r in depth_results) and all(r['pass'] and r['signErrorsBeyond1p5mm']==0 for r in interior_results) and all(r['entireFaceBeyondConsumedRegion'] and r['maxJumpMm']<.001 for r in boundaries),
             'gradientHardwareReads': 6, 'depthHardwareReads': 1, 'samplersAdded': 0,
             'outsidePolicy': 'clamped EDT plus distance to box; far exterior magnitude approximate, positive outside XY; no pose clamp',
             'metricChange': 'Euclidean EDT approximation inside D instead of legacy radial depth; wall thickness revalidation required in P1',
             'runtimeInstalled': False, 'clinicalValidation': False})
    figures = out.parent/'figures'; figures.mkdir(exist_ok=True)
    fig, axes_fig = plt.subplots(1, 2, figsize=(13, 5))
    pick = np.arange(0, len(midpoint), 4)
    scatter = axes_fig[0].scatter(midpoint[pick, 0], midpoint[pick, 2], c=midpoint_errors[pick], s=1, cmap='magma', vmin=0, vmax=6)
    axes_fig[0].axhspan(*Z_DOMAIN, alpha=.1, color='cyan'); fig.colorbar(scatter, ax=axes_fig[0], label='mm a piel nativa')
    axes_fig[0].set_title('Piel polar / medio Z; banda prefijada −210 a +60')
    axes_fig[1].plot(offsets, [r['p95Mm'] for r in depth_results], 'o-', label='p95')
    axes_fig[1].plot(offsets, [r['maxMm'] for r in depth_results], 'o-', label='máximo')
    axes_fig[1].axhline(1.5, color='orange', linestyle='--'); axes_fig[1].axhline(3, color='red', linestyle='--')
    axes_fig[1].set_xlabel('Desplazamiento radial de la piel (mm)'); axes_fig[1].set_ylabel('Error frente a EDT nativa (mm)'); axes_fig[1].legend()
    axes_fig[1].set_title('Profundidad R16F 3 mm / dominio completo')
    fig.suptitle('P0e: mismo s0028, sin validación clínica'); fig.tight_layout(); fig.savefig(figures/'skin-depth-domain.png', dpi=140); plt.close(fig)
    print(json.dumps({'skinAccepted': accepted, 'skin': descriptor, 'depth': depth_descriptor, 'depthResults': depth_results}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'model', 'out']:
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    run(args.source, args.model, args.out)
