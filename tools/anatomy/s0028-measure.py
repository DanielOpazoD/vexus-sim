"""Prepara piel fuente y perfil auxiliar para congelar las huellas históricas P0.

El perfil 14×65 es sólo el marco del comparador; no representa la piel elegida B.
"""
import argparse
import gzip
import importlib.util
import json
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi

SPEC = importlib.util.spec_from_file_location('source', Path(__file__).with_name('s0028-source.py'))
lib = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lib)


def prepare_profile(out):
    meta=json.loads((out/'fields.json').read_text())
    if meta.get('bodySourceSha256') != lib.digest(out/'body-source.npz'):
        raise ValueError('Piel no verificada; ejecutar verify primero')
    data = np.load(out/'body-source.npz')
    body, origin = data['body'], data['origin']
    rows, notes = [], []
    radii = np.arange(0, 400.125, .25)
    for z in np.arange(-400, 121, 40):
        zi = int(np.clip(round((z-origin[2])/1.5), 0, body.shape[2]-1))
        source_z = origin[2]+zi*1.5
        section = body[:, :, zi]
        occupied = np.argwhere(section)
        if not len(occupied):
            raise ValueError('Corte corporal vacío')
        cy = origin[1]+(occupied[:, 1].min()+occupied[:, 1].max())*.75
        row = [cy]
        missed, multiple = [], []
        for i, phi in enumerate(np.arange(64)*2*np.pi/64):
            p = np.array([radii*np.cos(phi), cy+radii*np.sin(phi)])
            samples = ndi.map_coordinates(section.astype(float), (p-origin[:2, None])/1.5,
                                          order=1, mode='constant', cval=0)
            occupied_ray = samples >= .5
            hits = np.flatnonzero(occupied_ray)
            starts = np.count_nonzero(occupied_ray[1:] & ~occupied_ray[:-1])
            if starts > 0:
                multiple.append(i)
            if not len(hits):
                missed.append(i)
                row.append(40.)
            else:
                k = hits[-1]
                # Cruce lineal de la isofrontera 0.5 entre muestras de 0.25mm.
                radius = radii[k]+(.5-samples[k])*.25/(samples[k+1]-samples[k])
                row.append(radius)
        rows.extend(row)
        notes.append({'zMm': int(z), 'sourceSliceZMm': float(source_z), 'outsideCoverage': bool(z < origin[2] or z > origin[2]+1.5*(body.shape[2]-1)),
                      'missingRays': missed, 'nonStarRays': multiple, 'centerY': cy})
    profile = np.array(rows, '<f4')
    profile.tofile(out/'profile.bin')
    points = []
    for zi in range(body.shape[2]):
        z = origin[2]+zi*1.5
        if z > 120:
            continue
        section = np.pad(body[:, :, zi], 1)
        # Caras de píxeles a mitad de celda: recoge concavidades, no sólo radio exterior.
        for axis in [0, 1]:
            edges = np.argwhere(np.diff(section.astype(np.int8), axis=axis) != 0).astype(float)-1
            edges[:, axis] += .5
            xy = origin[:2]+edges*1.5
            points.append(np.column_stack([xy, np.full(len(xy), z)]))
    skin = np.concatenate(points).astype('<f4')
    skin.tofile(out/'skin-points.f32')
    lib.save(out/'profile-source.json', {'nodes': notes, 'rawBytes': profile.nbytes,
             'gzipBytes': len(gzip.compress(profile.tobytes(), compresslevel=9, mtime=0)),
             'skinSamples': len(skin), 'skinReference': 'XY voxel face centers at native Z; includes concavities; no end caps',
             'referenceDiscretizationMm': .75, 'sourceExtractionUnreviewedConnectedShoulder': True})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    prepare_profile(a.out)
