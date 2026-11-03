"""Exportador P0 offline. Máscaras independientes, sin instalación ni prioridad.

Python -I; numpy/scipy/nibabel en entorno externo. Reutiliza la convención SDF,
colisiones por crops de aa6e492 y del arnés audit.
Exporta sólo los 20 campos lógicos de B; capacidad y packing se generan por separado.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

PITCH = 1.5


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def physical_id(manifest):
    keys = ['person','ctSha256','shape','affineRASmm','headerUnits','pitchMm','rasToLASmm','revision','masks']
    return hashlib.sha256(json.dumps({k:manifest[k] for k in keys},sort_keys=True,separators=(',',':')).encode()).hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')


def validate_labels(labels, allowed):
    if not np.isfinite(labels).all() or not np.isin(labels, list(allowed)).all() or not np.equal(labels, np.floor(labels)).all():
        raise ValueError('Etiqueta categórica inválida; interpolación nearest obligatoria')


def geometry(image, manifest, label):
    if list(image.shape) != manifest['shape']:
        raise ValueError('rejilla distinta: '+label)
    if not np.array_equal(image.affine, manifest['affineRASmm']):
        raise ValueError('affine distinto: '+label)
    if list(image.header.get_xyzt_units()) != manifest['headerUnits']:
        raise ValueError('unidades distintas: '+label)
    if image.header.get_xyzt_units()[0] == 'unknown' and not manifest.get('millimeterEvidence'):
        raise ValueError('unidades desconocidas sin evidencia mm')
    for matrix, code in [image.get_qform(coded=True), image.get_sform(coded=True)]:
        if code and not np.allclose(matrix, image.affine, atol=1e-5, rtol=0):
            raise ValueError('affine qform/sform contradictorio: '+label)
    if not np.allclose(np.linalg.norm(image.affine[:3, :3], axis=0), manifest['pitchMm'], atol=1e-6, rtol=0):
        raise ValueError('pitch distinto')


def crop(mask):
    indices = np.nonzero(mask)
    if not len(indices[0]):
        return np.zeros(3, int), np.zeros((0, 0, 0), bool)
    lo = np.array([v.min() for v in indices])
    hi = np.array([v.max()+1 for v in indices])
    return lo, mask[tuple(slice(a, b) for a, b in zip(lo, hi))].copy()


def intersection(a, b):
    alo, aa = a
    blo, bb = b
    lo = np.maximum(alo, blo)
    hi = np.minimum(alo+aa.shape, blo+bb.shape)
    if np.any(lo >= hi):
        return 0, None
    overlap = (aa[tuple(slice(x, y) for x, y in zip(lo-alo, hi-alo))] &
               bb[tuple(slice(x, y) for x, y in zip(lo-blo, hi-blo))])
    n = int(overlap.sum())
    return n, (lo+np.argwhere(overlap)[0]).tolist() if n else None


def load_case(case_dir, manifest):
    case_dir = Path(case_dir).resolve()
    transform = np.asarray(manifest['rasToLASmm'],float)
    if transform.shape != (4,4) or not np.isfinite(transform).all() or not np.array_equal(transform[:3,:3],np.diag([-1.,1.,1.])) or not np.array_equal(transform[3],[0,0,0,1]):
        raise ValueError('registro requiere reflexión RAS-LAS y traslación única, sin escala/rotación por órgano')
    ct_path = case_dir/'ct.nii.gz'
    if digest(ct_path) != manifest['ctSha256']:
        raise ValueError('hash TAC distinto')
    image = nib.load(ct_path)
    geometry(image, manifest, 'CT')
    ct = np.asarray(image.dataobj)
    if not np.isfinite(ct).all():
        raise ValueError('TAC no finito')
    if set(manifest['requiredMasks']) != set(manifest['masks']):
        raise ValueError('máscara faltante en manifiesto')
    masks, stats = {}, {}
    for name, spec in manifest['masks'].items():
        if spec['person'] != manifest['person']:
            raise ValueError('donante mezclado: '+name)
        path = (case_dir/spec['path']).resolve()
        if not path.is_relative_to(case_dir):
            raise ValueError('donante/ruta fuera del caso: '+name)
        if not path.is_file():
            raise ValueError('máscara faltante: '+name)
        if digest(path) != spec['sha256']:
            raise ValueError('hash máscara distinto: '+name)
        mask_image = nib.load(path)
        geometry(mask_image, manifest, name)
        raw = np.asarray(mask_image.dataobj)
        validate_labels(raw, {0, 1})
        # Una sola reflexión de convención; no registro por órgano ni resampling.
        lo, data = crop((raw > 0)[::-1])
        masks[name] = (lo, data)
        cc, components = ndi.label(data)
        sizes = np.bincount(cc.ravel())[1:]
        stats[name] = {'voxels': int(data.sum()), 'volumeCm3': float(data.sum()*PITCH**3/1000),
                       'components6': components, 'componentSizes': sorted(sizes.tolist(), reverse=True),
                       'loVoxelLAS': lo.tolist(), 'dimensions': list(data.shape), 'sha256': spec['sha256']}
    return image, ct[::-1], masks, stats


def conflicts(masks):
    result = []
    for i, (name, a) in enumerate(masks.items()):
        for other, b in list(masks.items())[i+1:]:
            count, witness = intersection(a, b)
            if count:
                result.append({'a': name, 'b': other, 'voxels': count,
                               'cm3': count*PITCH**3/1000, 'witnessVoxelLAS': witness})
    return result


def inventory(case_dir, manifest, out=None):
    _, _, masks, stats = load_case(case_dir, manifest)
    result = {'person': manifest['person'], 'frameId': manifest['frameId'], 'masks': stats,
              'conflicts': conflicts(masks), 'priorityApplied': False, 'runtimeInstalled': False, 'physicalFrameSha256': physical_id(manifest)}
    if 'historicalConflictMasks' in manifest:
        result['historicalConflicts'] = conflicts({n: masks[n] for n in manifest['historicalConflictMasks']})
    if out:
        out = Path(out)
        (out/'masks').mkdir(exist_ok=False)
        for name, (lo, mask) in masks.items():
            raw = mask.transpose(2,1,0).astype(np.uint8).tobytes()
            compressed = gzip.compress(raw,compresslevel=9,mtime=0)
            (out/'masks'/(name+'.u8.gz')).write_bytes(compressed)
            stats[name]['independentCropSha256'] = hashlib.sha256(raw).hexdigest()
        save(out/'inventory.json', result)
    return result


def merge_disjoint(masks, labels):
    result = np.zeros(masks[0].shape, np.uint8)
    for mask, label in zip(masks, labels, strict=True):
        validate_labels(mask, {0, 1})
        mask = mask.astype(bool)
        if np.any(mask & (result != 0)):
            raise ValueError('overlap independiente requiere frontera revisada')
        result[mask] = label
    return result


def signed_field(mask, labels):
    validate_labels(labels, set(np.unique(labels)))
    outside, nearest = ndi.distance_transform_edt(~mask, sampling=PITCH, return_indices=True)
    inside = ndi.distance_transform_edt(mask, sampling=PITCH)
    distance = np.where(mask, -inside+PITCH/2, outside-PITCH/2)
    return np.stack([np.clip(distance, -64, 16), labels[tuple(nearest)]], -1).astype('<f2')


def encode_field(out, name, lo, labels, origin, asset, status, support_for):
    if not np.any(labels):
        raise ValueError('Campo/reserva vacío: '+name)
    occupied = labels > 0
    # Padding incluso en caras de cobertura: el cierre es artificial y queda declarado.
    pad = 6
    labels = np.pad(labels, pad)
    lo = lo-pad
    field = signed_field(labels > 0, labels)
    if not np.array_equal(field[..., 0] < 0, labels > 0):
        raise ValueError('Pérdida de ocupación en SDF')
    validate_labels(field[..., 1], set(np.unique(labels)))
    raw = field.transpose(2, 1, 0, 3).tobytes()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    (out/(name+'.gzip.bin')).write_bytes(compressed)
    row = {'name': name, 'asset': asset, 'status': status, 'supportFor': support_for,
           'originMm': (origin+lo*PITCH).tolist(), 'dimensions': list(field.shape[:3]),
           'pitchMm': PITCH, 'rawBytes': len(raw), 'gzipBytes': len(compressed),
           'sha256Raw': hashlib.sha256(raw).hexdigest(), 'sha256Gzip': hashlib.sha256(compressed).hexdigest(),
           'labelValues': sorted(np.unique(labels).tolist()), 'occupiedVoxels': int(occupied.sum()), 'sourceOccupancyExact': True,
           'gzipFutureGuaranteed': status != 'reservation-proxy',
           'gzipIncompressibleBoundBytes': len(raw)+(len(raw)//16383+1)*5+32}
    print(json.dumps({k: row[k] for k in ['name', 'rawBytes', 'gzipBytes', 'status']}), flush=True)
    return row


def assemble(masks, names):
    chosen = [(n, masks[n]) for n in names if masks[n][1].any()]
    lo = np.min([p for _, (p, _) in chosen], axis=0)
    hi = np.max([p+v.shape for _, (p, v) in chosen], axis=0)
    labels = np.zeros(hi-lo, np.uint8)
    for i, (_, (p, v)) in enumerate(chosen, 1):
        area = labels[tuple(slice(a, b) for a, b in zip(p-lo, p-lo+v.shape))]
        if np.any((area > 0) & v):
            raise ValueError('overlap dentro del campo; no ocultar con prioridad')
        area[v] = i
    return lo, labels


def trunk_mask(ct):
    # Derivación del arnés audit: cuerpo mayor por corte, sin mesa/miembros separados.
    body = np.zeros(ct.shape, bool)
    details = []
    for z in range(ct.shape[2]):
        components, count = ndi.label(ct[:, :, z] > -400)
        sizes = np.bincount(components.ravel())
        sizes[0] = 0
        if count:
            body[:, :, z] = ndi.binary_fill_holes(components == sizes.argmax())
        details.append({'slice': z, 'components': count, 'largestVoxels': int(sizes.max())})
    return body, details


def export_fields(case_dir, manifest, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    image, ct, masks, stats = load_case(case_dir, manifest)
    origin_ras = nib.affines.apply_affine(image.affine, [image.shape[0]-1, 0, 0])
    origin = nib.affines.apply_affine(np.array(manifest['rasToLASmm']), origin_ras)
    result = {'person': manifest['person'], 'frameId': manifest['frameId'], 'masks': stats,
              'conflicts': conflicts(masks), 'historicalConflicts': conflicts({n: masks[n] for n in manifest['historicalConflictMasks']}),
              'priorityApplied': False, 'originLASmm': origin.tolist(), 'runtimeInstalled': False}
    save(out/'inventory.json', result)
    rows = []
    for spec in manifest['fieldGroups']:
        lo, labels = assemble(masks, spec['masks'])
        row = encode_field(out, spec['name'], lo, labels, origin, spec['asset'], 'source', spec['masks'])
        row['sourceLabels'] = {str(i): name for i, name in enumerate([n for n in spec['masks'] if masks[n][1].any()], 1)}
        rows.append(row)
    body, body_details = trunk_mask(ct)
    np.savez_compressed(out/'body-source.npz', body=body, origin=origin)
    save(out/'body-extraction.json', {'method': 'audit: largest >-400HU component/slice, fill internal holes',
                                      'slices': body_details, 'armsAtConnectedShoulderNotManuallyReviewed': True,
                                      'cutFaces': [int(np.take(body, k, axis=d).sum()) for d in range(3) for k in [0, body.shape[d]-1]]})
    gas_masks = {}
    for name in ['stomach', 'duodenum', 'small_bowel', 'colon']:
        p, a = masks[name]
        hus = ct[tuple(slice(x, x+d) for x, d in zip(p, a.shape))]
        gas_masks[name] = (p, a & (hus < -500))
    gas_lo, gas = assemble(gas_masks, list(gas_masks))
    rows.append(encode_field(out, 'digestiveGas', gas_lo, gas, origin, 'abdominal', 'derived-proxy',
                             ['HU<-500 inside independent digestive masks; components retained']))
    save(out/'fields.json', {'person': manifest['person'], 'frameId': manifest['frameId'], 'fields': rows,
                            'noSmoothing': True, 'noDownsampling': True, 'maskResolutionMm': PITCH})
    return rows


def verify_exports(out, manifest, case_dir):
    """Reabre los bytes guardados; verifica bricks y ocupación, no confía en el log."""
    out = Path(out)
    rows = json.loads((out/'fields.json').read_text())['fields']
    inv = json.loads((out/'inventory.json').read_text())
    original = json.loads((out.parent/'independent/inventory.json').read_text())
    if digest(Path(case_dir)/'ct.nii.gz') != manifest['ctSha256']:
        raise ValueError('TAC distinto al verificar exports')
    image = nib.load(Path(case_dir)/'ct.nii.gz')
    geometry(image,manifest,'CT')
    source_origin = nib.affines.apply_affine(np.array(manifest['rasToLASmm']),
        nib.affines.apply_affine(image.affine, [image.shape[0]-1, 0, 0]))
    if not np.array_equal(inv['originLASmm'], source_origin):
        raise ValueError('Inventario candidato de otro marco físico TAC')
    for name,spec in manifest['masks'].items():
        if original['masks'][name]['sha256'] != spec['sha256']:
            raise ValueError('Inventario fuente de otro hash')
    original.setdefault('physicalFrameSha256',physical_id(manifest))
    save(out.parent/'independent/inventory.json',original)
    if original['physicalFrameSha256'] != physical_id(manifest):
        raise ValueError('Inventario independiente de otro marco/donante')
    body_verified = False
    if (out/'body-source.npz').exists():
        stored = np.load(out/'body-source.npz')
        rebuilt,_ = trunk_mask(np.asarray(image.dataobj)[::-1])
        if not np.array_equal(stored['body'],rebuilt) or not np.array_equal(stored['origin'],source_origin):
            raise ValueError('Piel fuente no deriva del mismo TAC/marco')
        body_verified = True
    groups = {g['name']:g for g in manifest['fieldGroups']}
    if {r['name'] for r in rows if r['status'] == 'source'} != set(groups):
        raise ValueError('Inventario de campos fuente incompleto')
    results = []
    for r in rows:
        compressed = (out/(r['name']+'.gzip.bin')).read_bytes()
        raw = gzip.decompress(compressed)
        if len(raw) != r['rawBytes'] or hashlib.sha256(raw).hexdigest() != r['sha256Raw']:
            raise ValueError('hash/tamaño de brick cambiado')
        f = np.frombuffer(raw,'<f2').reshape(-1,2)
        validate_labels(f[:,1],r['labelValues'])
        count = int(np.count_nonzero(f[:,0]<0))
        if count != r['occupiedVoxels']:
            raise ValueError('ocupación de brick cambiada')
        if r['status'] == 'source' and count != sum(inv['masks'][n]['voxels'] for n in r['sourceLabels'].values()):
            raise ValueError('máscara fuente perdida/oculta')
        if r['status'] == 'source':
            expected = {str(i): n for i,n in enumerate([n for n in groups[r['name']]['masks'] if inv['masks'][n]['voxels']],1)}
            if r['sourceLabels'] != expected:
                raise ValueError('Identidad categórica cambiada: '+r['name'])
            grid = f.reshape(*r['dimensions'][::-1],2).transpose(2,1,0,3)
            base = source_origin
            for label, name in expected.items():
                stats = original['masks'][name]
                binary = gzip.decompress((out.parent/'independent/masks'/(name+'.u8.gz')).read_bytes())
                if hashlib.sha256(binary).hexdigest() != stats['independentCropSha256']:
                    raise ValueError('crop independiente alterado')
                mask = np.frombuffer(binary,np.uint8).reshape(*stats['dimensions'][::-1]).transpose(2,1,0)>0
                local = (base+np.array(stats['loVoxelLAS'])*PITCH-np.array(r['originMm']))/PITCH
                if not np.allclose(local,np.round(local),atol=1e-8,rtol=0):
                    raise ValueError('origen fuera de rejilla fuente')
                lo = np.round(local).astype(int)
                hit = grid[tuple(slice(a,a+d) for a,d in zip(lo,mask.shape))]
                restored = (hit[...,0]<0)&(hit[...,1]==int(label))
                if not np.array_equal(restored,mask) or np.count_nonzero((grid[...,0]<0)&(grid[...,1]==int(label))) != stats['voxels']:
                    raise ValueError('Geometría/identidad de máscara perdida: '+name)
        results.append({'field':r['name'],'hashVerified':True,'categorical':True,'occupiedVoxels':count})
    metadata = json.loads((out/'fields.json').read_text())
    metadata['physicalFrameSha256'] = physical_id(manifest)
    if body_verified:
        metadata['bodySourceSha256'] = digest(out/'body-source.npz')
    save(out/'fields.json',metadata)
    inv['physicalFrameSha256'] = physical_id(manifest)
    save(out/'inventory.json',inv)
    save(out/'export-verification.json',{'physicalFrameSha256':physical_id(manifest),'derivedBodyVerifiedAgainstCT':body_verified,'perMaskGeometryAndIdentityVerified':True,'fields':results,'allIndependentBricksReopenedExact':True,
        'priorityApplied':False,'runtimeInstalled':False})


def interpolated_conflicts(out):
    """Recuento independiente de ceros trilineales a 0.75mm, sin clasificador."""
    out = Path(out)
    metadata = json.loads((out/'fields.json').read_text())['fields']
    inventory_data = json.loads((out/'inventory.json').read_text())
    mapping = {n: row for row in metadata if row['status'] == 'source' for n in row['sourceLabels'].values()}
    loaded = {}
    rows = []
    for pair in inventory_data['historicalConflicts']:
        a, b = mapping[pair['a']], mapping[pair['b']]
        values = []
        for row in [a, b]:
            if row['name'] not in loaded:
                data = np.frombuffer(gzip.decompress((out/(row['name']+'.gzip.bin')).read_bytes()), '<f2')
                loaded[row['name']] = data.reshape(*row['dimensions'][::-1],2).transpose(2,1,0,3).astype(np.float32)
        alo = np.array(a['originMm']); blo = np.array(b['originMm'])
        lo = np.maximum(alo,blo); hi = np.minimum(alo+(np.array(a['dimensions'])-1)*PITCH,blo+(np.array(b['dimensions'])-1)*PITCH)
        axes = [np.arange(l,h+.01,.75) for l,h in zip(lo,hi)]
        points = np.stack(np.meshgrid(*axes,indexing='ij'),-1).reshape(-1,3)
        for row in [a,b]:
            grid = loaded[row['name']]
            q = (points-np.array(row['originMm']))/PITCH
            sdf = ndi.map_coordinates(grid[...,0],q.T,order=1,prefilter=False,mode='constant',cval=16)
            label = ndi.map_coordinates(grid[...,1],q.T,order=0,prefilter=False,mode='constant',cval=0)
            wanted = next(int(k) for k,v in row['sourceLabels'].items() if v in [pair['a'],pair['b']])
            values.append((sdf < 0)&(label == wanted))
        count = int(np.count_nonzero(values[0]&values[1]))
        rows.append({**pair,'interpolatedSamplesAt075mm':count,'sampledOverlapCm3':count*.75**3/1000})
    save(out/'interpolated-conflicts.json',{'pairs':rows,'stepMm':.75,'independent':True,
         'meaning':'sampled trilinear SDF intersections, nearest labels; not analytic intersection volume or corrected boundary'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inventory', 'export', 'conflicts', 'verify'])
    parser.add_argument('--case-dir', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('s0028-case.json'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    if args.command == 'verify':
        verify_exports(args.out, manifest, args.case_dir)
    elif args.command == 'conflicts':
        interpolated_conflicts(args.out)
    elif args.command == 'export':
        export_fields(args.case_dir, manifest, args.out)
    else:
        args.out.mkdir(parents=True, exist_ok=False)
        inventory(args.case_dir, manifest, args.out)


if __name__ == '__main__':
    main()
