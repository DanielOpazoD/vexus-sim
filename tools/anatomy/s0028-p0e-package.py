"""P0e: paquete elegido B, descarga gzip real y residencia separada del pico, fuera de producto."""
import argparse
import gzip
import importlib.util
import itertools
import json
import math
from pathlib import Path
import shutil

import numpy as np

SPEC = importlib.util.spec_from_file_location('direct', Path(__file__).with_name('s0028-direct.py'))
lib = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lib)
SPEC = importlib.util.spec_from_file_location('domain', Path(__file__).with_name('s0028-p0e-domain.py'))
domain_lib = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(domain_lib)


RESIDENT_LIMITS = {'abdominal': 139921010, 'thoracic': 60413664}
DOWNLOAD_LIMIT = 19510002


def require_budget(download, memory):
    if download > DOWNLOAD_LIMIT or any(r['residentAccountedBytes'] > RESIDENT_LIMITS[r['name']] for r in memory):
        raise ValueError('Paquete B excede presupuesto; detener fase antes de cargar')


def overlaps(p, d, q, e):
    return all(p[i] < q[i]+e[i] and q[i] < p[i]+d[i] for i in range(3))


def depth_hole(dimensions, fields, depth_dimensions):
    axes = [{0} | {f['offset'][i]+f['dimensions'][i] for f in fields} for i in range(3)]
    choices = []
    for z, y, x in itertools.product(*[sorted(a) for a in axes[::-1]]):
        p = [x,y,z]
        if x+depth_dimensions[0] > dimensions[0] or y+depth_dimensions[1] > dimensions[1]:
            continue
        if any(overlaps(p, depth_dimensions, f['offset'], f['dimensions']) for f in fields):
            continue
        d = max(dimensions[2], z+depth_dimensions[2])
        choices.append((d, z, y, x))
    d,z,y,x = min(choices)
    return [dimensions[0], dimensions[1], d], [x,y,z]


def reopen_blob(folder, descriptor, dimensions, bytes_per_node, label):
    if not dimensions or any(type(d) is not int or d <= 0 for d in dimensions):
        raise ValueError(label+' dimensiones inválidas')
    compressed = (folder/descriptor['file']).read_bytes()
    raw = gzip.decompress(compressed)
    if len(raw) != math.prod(dimensions)*bytes_per_node or len(raw) != descriptor.get('rawBytes') or len(compressed) != descriptor.get('gzipBytes'):
        raise ValueError(label+' tamaño RAW/gzip distinto de dimensiones/formato')
    if lib.sha(raw) != descriptor.get('sha256Raw') or lib.sha(compressed) != descriptor.get('sha256Gzip'):
        raise ValueError(label+' hash RAW/gzip distinto')
    return raw


def verify_domain(source, domain):
    metadata = json.loads((source/'fields.json').read_text())
    body_sha = lib.sha((source/'body-source.npz').read_bytes())
    if body_sha != metadata['bodySourceSha256']:
        raise ValueError('Auxiliares: procedencia corporal fuente alterada')
    with np.load(source/'body-source.npz') as body_data:
        body, origin = body_data['body'], body_data['origin']
    skin = json.loads((domain/'skin.json').read_text())['descriptor']
    depth = json.loads((domain/'depth.json').read_text())['descriptor']
    for descriptor in [skin, depth]:
        if descriptor.get('sourceBodySha256') != body_sha:
            raise ValueError('Auxiliar de otra procedencia corporal')
    levels = np.count_nonzero(origin[2]+np.arange(body.shape[2])*1.5 <= 120)
    axes, _ = domain_lib.depth_axes(body, origin)
    skin_frame = {'format': 'RG16F XY, global periodic polar phi',
                  'dimensions': [domain_lib.RAYS, (int(levels)-1)*2+1],
                  'pitchZMm': domain_lib.SKIN_STEP, 'originZMm': float(origin[2]), 'phiRange': [0, 2*np.pi]}
    depth_frame = {'format': 'R16F signed EDT, negative inside; 3mm hardware linear',
                   'dimensions': [len(a) for a in axes], 'pitchMm': 3.,
                   'originMm': (origin+np.array([a[0] for a in axes])*1.5).tolist()}
    for descriptor, expected in [(skin, skin_frame), (depth, depth_frame)]:
        if any(descriptor.get(k) != v for k, v in expected.items()):
            raise ValueError('Auxiliar de otro marco físico corporal')
    skin_raw = reopen_blob(domain, skin, skin['dimensions'], 4, 'Piel')
    depth_raw = reopen_blob(domain, depth, depth['dimensions'], 2, 'Profundidad')
    return skin, depth, skin_raw, depth_raw


def direct(source, original, domain, out):
    out.mkdir(parents=True, exist_ok=True)
    original_pack = json.loads((original/'packing.json').read_text())
    metadata, source_rows, fields = lib.load_fields(source)
    source_descriptors = {r['name']:r for r in source_rows}
    packed_names = [f['name'] for a in original_pack['assets'] for f in a['fields']]
    if len(packed_names) != 19 or set(packed_names) != set(source_descriptors)-{'digestiveGas'}:
        raise ValueError('Inventario directo incompleto o duplicado')
    if metadata['physicalFrameSha256'] != original_pack['sourcePhysicalFrameSha256']:
        raise ValueError('Packing de otro marco físico')
    fields['digestiveTract'] = lib.encode_gas(fields['digestiveTract'], fields['digestiveGas'])
    _, depth_meta, _, depth_raw = verify_domain(source, domain)
    depth = np.frombuffer(depth_raw, '<f2').reshape(depth_meta['dimensions'][::-1])
    assets = []
    for a in original_pack['assets']:
        raw = gzip.decompress((original/a['file']).read_bytes())
        if lib.sha(raw) != a['sha256Raw']:
            raise ValueError('P0c alterado')
        dims, offset = depth_hole(a['textureDimensions'], a['fields'], depth_meta['dimensions']) if a['name']=='abdominal' else (a['textureDimensions'], [0,0,0])
        atlas = np.zeros((*dims[::-1], 2), '<f2'); atlas[...,0] = 16
        old = np.frombuffer(raw, '<f2').reshape(*a['textureDimensions'][::-1], 2)
        dz,dy,dx = old.shape[:3]; atlas[:dz,:dy,:dx] = old
        if a['name']=='abdominal':
            x,y,z=offset; dx,dy,dz=depth_meta['dimensions']
            atlas[z:z+dz,y:y+dy,x:x+dx,0] = depth
            atlas[z:z+dz,y:y+dy,x:x+dx,1] = 0
        raw=atlas.tobytes(); file=out/(a['name']+'-direct.gzip.bin')
        file.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        decoded=np.frombuffer(gzip.decompress(file.read_bytes()),'<f2').reshape(atlas.shape)
        checks=[]
        for f in a['fields']:
            if any(f[k] != source_descriptors[f['name']][k] for k in ['originMm','dimensions','asset']):
                raise ValueError('Descriptor de otro marco físico')
            x,y,z=f['offset']; dx,dy,dz=f['dimensions']
            block=decoded[z:z+dz,y:y+dy,x:x+dx]
            if not np.array_equal(block.view('<u2'), fields[f['name']].view('<u2')):
                raise ValueError('Lector directo perdió campo')
            checks.append({'name':f['name'],'allNodesBitExact':True,'sourceStoredSha256':lib.sha(fields[f['name']].tobytes()),
                           'recoveredSha256':lib.sha(block.tobytes()),'internalSeams':0})
        assets.append({**a, 'textureDimensions':dims, 'depthOffset':offset, 'rawBytes':len(raw),
                       'file':file.name, 'gzipBytes':file.stat().st_size, 'sha256Raw':lib.sha(raw),
                       'sha256Gzip':lib.sha(file.read_bytes()), 'verification':checks,
                       'depthBytesInAtlas':depth.nbytes*2 if a['name']=='abdominal' else 0,
                       'rawLimitBytes':RESIDENT_LIMITS[a['name']],
                       'textureMarginBytes':RESIDENT_LIMITS[a['name']]-len(raw)})
    lib.save(out/'packing.json',{'revision':'s0028-p0e-P0c-direct-v1','logicalFields':20,'physicalFields':19,
              'pitchMm':1.5,'sourcePhysicalFrameSha256':metadata['physicalFrameSha256'],'assets':assets,'sourceP0cPackingSha256':lib.sha((original/'packing.json').read_bytes()),
              'gasNearestBitExact':True,'gasSdfStored':False,'runtimeInstalled':False,'clinicalValidation':False})


def package(out, domain, capacity_dir, source):
    packing=json.loads((out/'packing.json').read_text())
    if sorted(a['name'] for a in packing['assets']) != ['abdominal', 'thoracic']:
        raise ValueError('Se requieren ambos atlas B una sola vez')
    source_frame = json.loads((source/'fields.json').read_text())['physicalFrameSha256']
    if packing['sourcePhysicalFrameSha256'] != source_frame:
        raise ValueError('Packing de otro marco físico fuente')
    skin, depth, skin_raw, _ = verify_domain(source, domain)
    atlas_sizes = {}
    for a in packing['assets']:
        if len(a['textureDimensions']) != 3:
            raise ValueError('Atlas dimensiones inválidas')
        raw = reopen_blob(out, a, a['textureDimensions'], 4, 'Atlas '+a['name'])
        atlas_sizes[a['name']] = len(raw)
        del raw
    capacity=json.loads((capacity_dir/'capacity.json').read_text())
    capacity_raw = (capacity_dir/'annotation-capacity.bin').read_bytes()
    if len(capacity_raw) != capacity['rawBytes'] or lib.sha(capacity_raw) != capacity['sha256']:
        raise ValueError('Capacidad alterada')
    capacity_file = out/'annotation-capacity.gzip.bin'
    capacity_file.write_bytes(gzip.compress(capacity_raw, compresslevel=9, mtime=0))
    if gzip.decompress(capacity_file.read_bytes()) != capacity_raw:
        raise ValueError('Capacidad no recuperada')
    capacity = {**capacity, 'file':capacity_file.name, 'downloadBytes':capacity_file.stat().st_size,
                'sha256Gzip':lib.sha(capacity_file.read_bytes()), 'compressionCredit':len(capacity_raw)-capacity_file.stat().st_size,
                'downloadRule':'measure actual gzip again after every annotation phase'}
    shutil.copyfile(domain/skin['file'],out/skin['file'])
    files=[out/a['file'] for a in packing['assets']]+[capacity_file,out/skin['file']]
    records=[{'file':f.name,'bytes':f.stat().st_size,'sha256':lib.sha(f.read_bytes())} for f in files]
    manifest={'revision':'s0028-p0-close-B-v1','packing':{**{k:v for k,v in packing.items() if k != 'sourceP0cPackingSha256'}, 'assets':[{k:v for k,v in a.items() if k not in ['verification','offsets','packingSeconds']} for a in packing['assets']]},'skin':skin,'depth':depth,'capacity':capacity,
              'files':records,'domain':{'zMm':[-210,60],'phi':'full periodic circle'},
              'depthInAbdominalAtlas':True,'samplersAdded':0,'runtimeInstalled':False,'clinicalValidation':False}
    lib.save(out/'candidate-manifest.json',manifest)
    manifest_bytes=(out/'candidate-manifest.json').stat().st_size
    tables=20*3*16
    memory=[]
    for a in packing['assets']:
        abd=a['name']=='abdominal'
        extras=len(skin_raw)+manifest_bytes+tables if abd else 0
        texture_bytes = atlas_sizes[a['name']]
        counted=texture_bytes+capacity[a['name']+'Bytes']+extras
        limit=RESIDENT_LIMITS[a['name']]
        memory.append({'name':a['name'],'textureBytes':texture_bytes,'textureDimensions':a['textureDimensions'],
                       'capacityBytes':capacity[a['name']+'Bytes'],'skinCPUBytes':len(skin_raw) if abd else 0,
                       'manifestAndDescriptorsBytes':manifest_bytes+tables if abd else 0,'depthBytesIncludedInTexture':a['depthBytesInAtlas'],
                       'residentAccountedBytes':counted,'limitBytes':limit,'marginBytes':limit-counted,
                       'authorizedBLimitBytes':limit})
    download=sum(f.stat().st_size for f in files)+manifest_bytes
    report={'files':records,'manifestBytes':manifest_bytes,'nominalDescriptorBytes':tables,
            'totalDownloadBytes':download,'downloadLimitBytes':DOWNLOAD_LIMIT,'downloadMarginBytes':DOWNLOAD_LIMIT-download,
            'memory':memory,'allCurrentBudgetsPass':download<=DOWNLOAD_LIMIT and all(r['marginBytes']>=0 for r in memory),
            'residentIsNotBrowserPeak':True,'CPUWorkerGPUCopiesNotMeasured':True}
    lib.save(out/'package.json',report)
    require_budget(download, memory)
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['out','domain','capacity-dir']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--original',type=Path)
    a=p.parse_args()
    if a.original:direct(a.source,a.original,a.domain,a.out)
    package(a.out,a.domain,a.capacity_dir,a.source)
