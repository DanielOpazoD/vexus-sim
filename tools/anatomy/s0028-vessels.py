"""P5 r1: grafos vasculares offline. Sin instalación, ecografía ni inferencia de flujo desde HU.

Las aristas son segmentos entre muestras de la línea central, en LAS/mm. Un ciclo o una identidad U
no recibe flujo; no se rellena un hueco y no se resuelve un contacto por orden de etiquetas.
"""
import argparse
from collections import deque
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

FORMAT = 's0028-vascular-graph-v1'
N26 = np.ones((3, 3, 3), bool)
NODE = struct.Struct('<ffffHHHBB')
EDGE = struct.Struct('<IIbBH')
DOWNLOAD_LIMIT = 25_000_000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name+'.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def binary(value):
    a = np.asarray(value)
    if a.ndim != 3 or not np.isin(a, [0, 1]).all():
        raise ValueError('máscara binaria 3D requerida')
    return a.astype(bool)


def connected_identities(candidate, seeds):
    """Todos los contactos 26 de cada componente, incluidos los contradictorios. Sin nearest-owner."""
    candidate = binary(candidate)
    labels, count = ndi.label(candidate, N26)
    sizes = np.bincount(labels.ravel(), minlength=count+1)
    owners = [[] for _ in range(count+1)]
    for name in sorted(seeds):
        seed = binary(seeds[name])
        if seed.shape != candidate.shape:
            raise ValueError('rejillas diferentes')
        for k in np.unique(labels[ndi.binary_dilation(seed, N26)]):
            if k:
                owners[k].append(name)
    rows = [{'label': k, 'voxels': int(sizes[k]), 'roots': owners[k],
             'certainty': 'D' if len(owners[k]) == 1 else 'U',
             'reason': 'single-root-connectivity' if len(owners[k]) == 1 else 'identity-conflict' if owners[k] else 'unrooted'}
            for k in range(1, count+1)]
    return {'labels': labels, 'components': rows}


def source_conflicts(masks):
    """Conserva AMBOS lados del contacto entre etiquetas fuente diferentes, incluido el solape."""
    masks = {k: binary(a) for k, a in masks.items()}
    if not masks or len({a.shape for a in masks.values()}) != 1:
        raise ValueError('máscaras fuente sin rejilla común')
    result = np.zeros(next(iter(masks.values())).shape, bool)
    names = sorted(masks)
    for i, a in enumerate(names):
        for b in names[i+1:]:
            result |= masks[a] & ndi.binary_dilation(masks[b], N26)
            result |= masks[b] & ndi.binary_dilation(masks[a], N26)
    return result


def frame_affine(affine):
    a = np.asarray(affine, float)
    if a.shape != (4, 4) or not np.isfinite(a).all() or not np.array_equal(a[3], [0, 0, 0, 1]):
        raise ValueError('affine inválido')
    pitch = np.linalg.norm(a[:3, :3], axis=0)
    if min(pitch) <= 0 or not np.allclose(pitch, pitch[0], atol=1e-6, rtol=0) or not np.allclose(a[:3,:3].T@a[:3,:3], np.eye(3)*pitch[0]**2, atol=1e-6, rtol=0):
        raise ValueError('rejilla isotrópica ortogonal requerida')
    return a, float(pitch[0])


def centerline(mask, affine, root_mode=None, flow='unknown', certainty=None, root_seed=None):
    """Lee 3D, centros de vóxel originales, radio EDT menos medio paso. Conserva todas las aristas 26.

    No elimina ciclos mediante un árbol de expansión: una componente cíclica conserva geometría, pero TODAS
    sus aristas quedan U/sin flujo. La raíz geométrica de un fragmento no se presenta como ancla anatómica.
    """
    mask = binary(mask)
    affine, pitch = frame_affine(affine)
    if flow not in ('toward-root', 'away-from-root', 'unknown') or root_mode not in (None, 'superior', 'inferior', 'seed'):
        raise ValueError('raíz/sentido inválido')
    if certainty is None:
        certainty = mask
    certainty = binary(certainty)
    if certainty.shape != mask.shape:
        raise ValueError('certeza con otra rejilla')
    if root_mode == 'seed' and (root_seed is None or not np.any(root_seed) or np.shape(root_seed) != mask.shape):
        raise ValueError('raíz seed ausente o rejilla distinta')
    ijk = np.argwhere(skeletonize(mask, method='lee'))
    source_components, source_count = ndi.label(mask, N26)
    sizes = np.bincount(source_components.ravel(), minlength=source_count+1)
    represented = set(np.unique(source_components[tuple(ijk.T)])) if len(ijk) else set()
    missing = [k for k in range(1, source_count+1) if k not in represented]
    lost = int(sum(sizes[k] for k in missing))
    if mask.any() and not len(ijk):
        # Lee puede borrar un bloque de sección par: no inventar su centro, conservarlo como no representado.
        return {'nodes': [], 'edges': [], 'roots': [], 'unrepresentedVoxels': lost,
                'unrepresentedComponents': len(missing), 'cycleComponents': 0}
    distance = ndi.distance_transform_edt(np.pad(mask, 1), sampling=pitch)[1:-1, 1:-1, 1:-1]
    positions = nib.affines.apply_affine(affine, ijk)
    nodes = [{'ijk': q.tolist(), 'p': p.tolist(), 'r': float(distance[tuple(q)]-.5*pitch),
              'certainty': 'D' if certainty[tuple(q)] else 'U'} for q, p in zip(ijk, positions)]
    index = {tuple(q): k for k, q in enumerate(ijk)}
    adjacency = [[] for _ in nodes]
    pairs = []
    for i, q in enumerate(ijk):
        for offset in np.ndindex(3, 3, 3):
            neighbor = tuple(q+np.asarray(offset)-1)
            j = index.get(neighbor, -1)
            if j > i:
                pairs.append((i, j)); adjacency[i].append(j); adjacency[j].append(i)
    seed_distance = ndi.distance_transform_edt(~binary(root_seed)) if root_mode == 'seed' else None
    seen, roots, cyclic = set(), [], set()
    component_of, depths = {}, {}
    for start in range(len(nodes)):
        if start in seen: continue
        queue, component = [start], []
        seen.add(start)
        for i in queue:
            component.append(i)
            for j in adjacency[i]:
                if j not in seen: seen.add(j); queue.append(j)
        comp = len(roots)
        if root_mode == 'seed':
            root = min(component, key=lambda i: (seed_distance[tuple(ijk[i])], -nodes[i]['r'], i))
        elif root_mode in ('superior', 'inferior'):
            sign = -1 if root_mode == 'superior' else 1
            root = min(component, key=lambda i: (sign*nodes[i]['p'][2], -nodes[i]['r'], i))
        else:
            root = min(component)
        is_cycle = sum(len(adjacency[i]) for i in component)//2 >= len(component)
        if is_cycle: cyclic.add(comp)
        roots.append({'node': root, 'component': comp, 'kind': 'geometric-fragment' if root_mode is None else root_mode,
                      'certainty': 'U' if root_mode is None or is_cycle else 'D', 'cycle': is_cycle})
        queue = [root]; depths[root] = 0
        for i in queue:
            component_of[i] = comp
            for j in adjacency[i]:
                if j not in depths: depths[j] = depths[i]+1; queue.append(j)
    edges = []
    for a, b in pairs:
        known = nodes[a]['certainty'] == nodes[b]['certainty'] == 'D' and component_of[a] not in cyclic
        direction = 0
        if known and root_mode is not None and flow != 'unknown':
            delta = depths[b]-depths[a]
            direction = int(np.sign(delta))*(1 if flow == 'away-from-root' else -1)
        edges.append({'nodes': [a, b], 'flow': direction, 'certainty': 'D' if known else 'U'})
    return {'nodes': nodes, 'edges': edges, 'roots': roots, 'unrepresentedVoxels': lost,
            'unrepresentedComponents': len(missing), 'cycleComponents': len(cyclic)}


def attachment_path(domain, start, targets):
    """Conexión 26 dentro del soporte observado, nunca una recta al vaso más cercano a través de un hueco.

    Camino mínimo en pasos de la rejilla, sólo para documentar la unión entre esqueletos extraídos por separado;
    no es una línea central aceptada ni elimina la U de la segmentación.
    """
    domain=binary(domain);start=tuple(start);targets={tuple(q) for q in targets}
    if not targets or not domain[start]:return None
    shape=np.array(domain.shape)
    targets={q for q in targets if all(0<=q[k]<shape[k] for k in range(3)) and domain[q]}
    if not targets:return None
    offsets=[tuple(np.array(q)-1) for q in np.ndindex(3,3,3) if q!=(1,1,1)]
    queue=deque([start]);parent={start:None}
    while queue:
        q=queue.popleft()
        if q in targets:
            path=[]
            while q is not None:path.append(q);q=parent[q]
            return list(reversed(path))
        for delta in offsets:
            n=tuple(q[k]+delta[k] for k in range(3))
            if n in parent or any(n[k]<0 or n[k]>=shape[k] for k in range(3)) or not domain[n]:continue
            parent[n]=q;queue.append(n)
    return None


def validate_graph(nodes, edges):
    for n in nodes:
        if len(n['p']) != 3 or not np.isfinite(n['p']).all() or not np.isfinite(n['r']) or n['r'] <= 0:
            raise ValueError('posición/radio inválido')
        if len(n['ijk']) != 3 or any(type(x) is not int or not 0 <= x <= 65535 for x in n['ijk']):
            raise ValueError('índice nativo inválido')
        if type(n['group']) is not int or not 0 <= n['group'] <= 255 or n['certainty'] not in ('D', 'U'):
            raise ValueError('grupo/certeza inválido')
    seen = set()
    parent = list(range(len(nodes)))
    def representative(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in edges:
        if len(e['nodes']) != 2 or any(type(x) is not int or not 0 <= x < len(nodes) for x in e['nodes']):
            raise ValueError('referencia de nodo inválida')
        a, b = e['nodes']; key = tuple(sorted([a, b]))
        if a == b or key in seen or np.array_equal(nodes[a]['p'], nodes[b]['p']):
            raise ValueError('arista duplicada/nula')
        seen.add(key)
        if e['group'] != nodes[a]['group'] or e['group'] != nodes[b]['group']:
            raise ValueError('arista entre grupos sin unión acreditada')
        if e['flow'] not in (-1, 0, 1) or e['certainty'] not in ('D', 'U'):
            raise ValueError('sentido/certeza inválido')
        if (e['certainty'] == 'U' and e['flow'] != 0) or (e['certainty'] == 'D' and any(nodes[i]['certainty'] == 'U' for i in (a,b))):
            raise ValueError('promoción indebida de U')
        if e['certainty'] == 'D':
            ra, rb = representative(a), representative(b)
            if ra == rb:
                raise ValueError('ciclo D sin resolver')
            parent[ra] = rb
    # Un único enlace U no sanea el resto de un ciclo: toda la componente debe permanecer U/sin flujo.
    for e in edges:
        a,b=e['nodes'];ra,rb=representative(a),representative(b)
        if ra!=rb:parent[ra]=rb
    counts={}
    for i in range(len(nodes)):
        root=representative(i);counts.setdefault(root,[0,0]);counts[root][0]+=1
    for e in edges:counts[representative(e['nodes'][0])][1]+=1
    for e in edges:
        nn,ne=counts[representative(e['nodes'][0])]
        if ne>=nn and e['certainty']!='U':raise ValueError('componente con ciclo parcialmente D')


def pack(nodes, edges):
    validate_graph(nodes, edges)
    payload = bytearray(b'VXV1'+struct.pack('<II', len(nodes), len(edges)))
    for n in nodes:
        payload.extend(NODE.pack(*n['p'], n['r'], *n['ijk'], n['group'], int(n['certainty'] == 'D')))
    for e in edges:
        payload.extend(EDGE.pack(*e['nodes'], e['flow'], int(e['certainty'] == 'D'), e['group']))
    data = bytes(payload)
    return data, {'encodedBytes': len(data), 'sha256': sha(data), 'nodeCount': len(nodes), 'edgeCount': len(edges),
                  'headerBytes': 12, 'nodeBytes': NODE.size, 'edgeBytes': EDGE.size, 'endian': 'little'}


def unpack(data, info):
    if len(data) != info['encodedBytes'] or sha(data) != info['sha256'] or data[:4] != b'VXV1' or len(data)<12:
        raise ValueError('payload corrupto/tamaño/hash')
    nn, ne = struct.unpack_from('<II', data, 4)
    if (nn, ne) != (info['nodeCount'], info['edgeCount']) or len(data) != 12+nn*NODE.size+ne*EDGE.size:
        raise ValueError('cuentas/tamaño inconsistente')
    nodes, edges = [], []
    for k in range(nn):
        n = NODE.unpack_from(data, 12+k*NODE.size)
        if n[8] not in (0, 1): raise ValueError('certeza binaria inválida')
        nodes.append({'p': list(n[:3]), 'r': n[3], 'ijk': list(n[4:7]), 'group': n[7], 'certainty': 'D' if n[8] else 'U'})
    for k in range(ne):
        e = EDGE.unpack_from(data, 12+nn*NODE.size+k*EDGE.size)
        if e[3] not in (0, 1): raise ValueError('certeza binaria inválida')
        edges.append({'nodes': list(e[:2]), 'flow': e[2], 'certainty': 'D' if e[3] else 'U', 'group': e[4]})
    validate_graph(nodes, edges)
    return nodes, edges


def write_package(out, payload, descriptor, support=None):
    """Contrato y recibo separados: el recibo fija hash de TODOS los bytes descargables."""
    out = Path(out)
    unpack(payload, descriptor['geometry'])
    descriptor=dict(descriptor)
    files={}
    if support is not None:
        support_raw=canonical(support)
        descriptor['support']={'encoding':'native-ijk-json-gzip-v1','encodedBytes':len(support_raw),'sha256':sha(support_raw)}
        files['support.gzip.bin']=gzip.compress(support_raw,compresslevel=9,mtime=0)
    raw = canonical(descriptor)+b'\n'
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    files.update({'manifest.json': raw, 'vessels.gzip.bin': compressed})
    receipt = {'format': FORMAT, 'files': {k: {'bytes':len(b),'sha256':sha(b)} for k,b in files.items()},
               'candidateDownloadBytes': sum(map(len, files.values())), 'baselineDownloadBytes': descriptor['baselineDownloadBytes'],
               'downloadLimitBytes': DOWNLOAD_LIMIT, 'runtimeInstalled': False}
    receipt['totalDownloadBytes'] = receipt['candidateDownloadBytes']+receipt['baselineDownloadBytes']
    if receipt['totalDownloadBytes'] > DOWNLOAD_LIMIT:
        raise ValueError('presupuesto de descarga excedido')
    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items(): (out/name).write_bytes(data)
    (out/'receipt.json').write_bytes(canonical(receipt)+b'\n')
    verify_package(out, expected_frame=descriptor['physicalFrameSha256'])
    return receipt


def verify_package(out, expected_frame, expected_case=None):
    out = Path(out); receipt = json.loads((out/'receipt.json').read_bytes())
    d = json.loads((out/'manifest.json').read_bytes())
    required={'manifest.json','vessels.gzip.bin'}|({'support.gzip.bin'} if 'support' in d else set())
    if set(receipt['files']) != required or receipt['downloadLimitBytes'] != DOWNLOAD_LIMIT:
        raise ValueError('inventario/presupuesto inválido')
    for name, spec in receipt['files'].items():
        data = (out/name).read_bytes()
        if len(data) != spec['bytes'] or sha(data) != spec['sha256']:
            raise ValueError('archivo corrupto: '+name)
    if d['format'] != FORMAT or d['person'] != 's0028' or d['runtimeInstalled'] is not False or d['physicalFrameSha256'] != expected_frame:
        raise ValueError('persona/marco/formato/runtime distinto')
    if expected_case is not None:
        if module('s0028-source').physical_id(expected_case) != expected_frame:
            raise ValueError('caso esperado con otro marco')
        for key in ('ctSha256', 'affineRASmm', 'rasToLASmm'):
            if d[key] != expected_case[key]: raise ValueError('registro/fuente distintos')
        if d['nativeShape'] != expected_case['shape']:
            raise ValueError('dimensiones nativas distintas')
        if any(entry != expected_case['masks'][name] for name,entry in d['sourceMasks'].items()):
            raise ValueError('máscara de otro caso')
    amount = sum(s['bytes'] for s in receipt['files'].values())
    if (receipt['candidateDownloadBytes'] != amount or receipt['baselineDownloadBytes'] != d['baselineDownloadBytes'] or
            receipt['totalDownloadBytes'] != amount+d['baselineDownloadBytes'] or receipt['totalDownloadBytes'] > DOWNLOAD_LIMIT):
        raise ValueError('contabilidad de bytes inconsistente')
    nodes, edges = unpack(gzip.decompress((out/'vessels.gzip.bin').read_bytes()), d['geometry'])
    if 'affineRASmm' in d:
        a, _ = frame_affine(np.asarray(d['rasToLASmm'])@np.asarray(d['affineRASmm']))
        for n in nodes:
            if any(i >= size for i,size in zip(n['ijk'],d['nativeShape'])):
                raise ValueError('nodo fuera de la rejilla')
            # Float32 del payload, no tolerancia anatómica: < 0,0001 mm a esta escala.
            if not np.allclose(n['p'], nib.affines.apply_affine(a,n['ijk']), atol=1e-4, rtol=0):
                raise ValueError('nodo no corresponde al único registro LAS')
    next_node = next_edge = 0
    for gi,g in enumerate(d['groups']):
        a,b = g['nodeRange']; c,e = g['edgeRange']
        if a != next_node or c != next_edge or not a <= b <= len(nodes) or not c <= e <= len(edges):
            raise ValueError('rangos de grupo inválidos')
        next_node, next_edge = b, e
        if any(n['group'] != gi for n in nodes[a:b]) or any(x['group'] != gi for x in edges[c:e]):
            raise ValueError('grupo no corresponde al payload')
        if g['identityCertainty'] not in ('D', 'U') or (g['identityCertainty'] == 'U' and g['physiologyId'] is not None):
            raise ValueError('identidad U promovida a fisiología')
        for root in g.get('roots', []):
            if not a <= root['node'] < b: raise ValueError('raíz fuera de grupo')
        validate_root_flow(g,nodes,edges[c:e])
    if next_node != len(nodes) or next_edge != len(edges):
        raise ValueError('nodos/aristas sin grupo')
    by_id={g['id']:g for g in d['groups']}
    if len(by_id)!=len(d['groups']):raise ValueError('grupo duplicado')
    support={}
    if 'support' in d:
        raw=gzip.decompress((out/'support.gzip.bin').read_bytes());spec=d['support']
        if spec['encoding']!='native-ijk-json-gzip-v1' or len(raw)!=spec['encodedBytes'] or sha(raw)!=spec['sha256']:
            raise ValueError('soporte corrupto')
        support=json.loads(raw)
        if set(support)!=set(by_id):raise ValueError('soporte incompleto')
        for ident,points in support.items():
            q=np.asarray(points)
            if q.shape!=(len(points),3) or not np.isfinite(q).all() or not np.equal(q,np.floor(q)).all() or np.any(q<0) or np.any(q>=d['nativeShape']):
                raise ValueError('soporte fuera de rejilla')
            if len({tuple(p) for p in points})!=len(points):raise ValueError('soporte duplicado')
            a,b=by_id[ident]['nodeRange'];occupied={tuple(p) for p in points}
            if any(tuple(n['ijk']) not in occupied for n in nodes[a:b]):raise ValueError('nodo fuera de soporte')
    for connection in d.get('connections',[]):
        source=by_id[connection['fromGroup']];target=by_id[connection['toGroup']]
        start=connection['fromNode'];end=connection['toNode'];path=connection['pathIJK'];radii=connection['radiiMm']
        if not source['nodeRange'][0]<=start<source['nodeRange'][1]:raise ValueError('ancla fuera de rama')
        if connection['geometryCertainty']!='U' or connection['flowCertainty']!='U' or connection['referenceDirection'] not in (-1,1):
            raise ValueError('puente de soporte promovido a luz/flujo aceptados')
        if connection['status']=='unresolved-gap':
            if end is not None or path or radii:raise ValueError('hueco rellenado')
        elif connection['status']=='connected-support':
            if not support:raise ValueError('conexión sin soporte conservado')
            if end is None or not target['nodeRange'][0]<=end<target['nodeRange'][1] or len(path)<2 or len(path)!=len(radii):
                raise ValueError('conexión con extremos/cuentas inválidos')
            q=np.asarray(path)
            if q.shape!=(len(path),3) or not np.isfinite(q).all() or not np.equal(q,np.floor(q)).all() or np.any(q<0) or np.any(q>=d['nativeShape']):
                raise ValueError('camino fuera de la rejilla')
            if path[0]!=nodes[start]['ijk'] or path[-1]!=nodes[end]['ijk']:
                raise ValueError('camino no une los nodos declarados')
            steps=np.abs(np.diff(q,axis=0))
            if np.any(steps.max(axis=1)!=1) or not np.isfinite(radii).all() or min(radii)<=0:
                raise ValueError('salto/radio inválido en unión')
            bounds=connection['supportBounds'];lo=np.asarray(bounds['lo']);shape=np.asarray(bounds['shape'])
            if lo.shape!=(3,) or shape.shape!=(3,) or not np.isfinite([lo,shape]).all() or not np.equal(lo,np.floor(lo)).all() or not np.equal(shape,np.floor(shape)).all() or np.any(lo<0) or np.any(shape<1) or np.any(lo+shape>d['nativeShape']):
                raise ValueError('caja de soporte inválida')
            lo=lo.astype(int);shape=shape.astype(int);domain=np.zeros(shape,bool)
            voxels=np.asarray(support[source['id']]+support[target['id']],int)-lo
            inside=np.all((voxels>=0)&(voxels<shape),axis=1);domain[tuple(voxels[inside].T)]=True
            local=q.astype(int)-lo
            if np.any(local<0) or np.any(local>=shape) or not domain[tuple(local.T)].all():
                raise ValueError('camino atraviesa un hueco fuera del soporte')
            _,pitch=frame_affine(np.asarray(d['rasToLASmm'])@np.asarray(d['affineRASmm']))
            edt=ndi.distance_transform_edt(np.pad(domain,1),sampling=pitch)[1:-1,1:-1,1:-1]-.5*pitch
            if not np.allclose(radii,edt[tuple(local.T)],atol=1e-6,rtol=0):raise ValueError('radio de unión no corresponde al EDT del soporte')
        else:raise ValueError('estado de conexión desconocido')
    return d, nodes, edges


def validate_root_flow(group,nodes,edges):
    """Cada arista dirigida debe avanzar por su árbol hacia/desde su única raíz declarada."""
    mode=group.get('positiveFlow','unknown')
    if mode not in ('unknown','toward-root','away-from-root'):raise ValueError('sentido de grupo inválido')
    roots=group.get('roots',[]);adjacency={i:[] for i in range(*group['nodeRange'])}
    for e in edges:
        a,b=e['nodes'];adjacency[a].append(b);adjacency[b].append(a)
    depths={};root_of={}
    for root in roots:
        start=root['node']
        if start in depths:raise ValueError('dos raíces en una componente')
        queue=[start];depths[start]=0
        for i in queue:
            root_of[i]=root
            for j in adjacency[i]:
                if j not in depths:depths[j]=depths[i]+1;queue.append(j)
    if roots and len(depths)!=len(adjacency):raise ValueError('componente sin raíz')
    for e in edges:
        if not e['flow']:continue
        a,b=e['nodes'];root=root_of.get(a)
        if mode=='unknown' or root is None or root['certainty']!='D' or root['kind']=='geometric-fragment' or root['cycle']:
            raise ValueError('flujo sin raíz/sentido acreditados')
        direction=int(np.sign(depths[b]-depths[a]))*(1 if mode=='away-from-root' else -1)
        if e['flow']!=direction:raise ValueError('flujo contrario a raíz declarada')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=Path, required=True)
    parser.add_argument('--frame', required=True)
    parser.add_argument('--case-manifest', type=Path, default=Path(__file__).with_name('s0028-case.json'))
    args = parser.parse_args()
    d, nodes, edges = verify_package(args.verify, args.frame, json.loads(args.case_manifest.read_bytes()))
    print(json.dumps({'nodes':len(nodes), 'segments':len(edges), 'sha256':d['geometry']['sha256'], 'runtimeInstalled':False}))


if __name__ == '__main__': main()
