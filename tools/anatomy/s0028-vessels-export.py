"""Extrae el candidato P5 r1 del TAC/máscaras fijados. Sólo escribe evidencia externa.

Frangi multiescala (scikit-image, BSD-3-Clause) + HU suavizado identifican candidatos, nunca brillo eco.
La pertenencia vascular depende de TODAS las conexiones; identidad individual no demostrada permanece U.
"""
import argparse
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import platform

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from skimage.filters import frangi

spec = importlib.util.spec_from_file_location('vascular', Path(__file__).with_name('s0028-vessels.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

PARAMS = {'format': v.FORMAT, 'smoothSigmaVoxels': .6, 'filterSigmaVoxels': [1.2, 1.8, 2.5], 'filter': 'frangi', 'alpha': .5, 'beta': .5, 'gamma': 15.,
          'hepaticMinimumHU': 115., 'filterMinimum': .04, 'hepaticInteriorDistanceVoxels': 1.5,
          'rootHaloVoxels': 2, 'componentMinimumVoxels': 27, 'renalMinimumHU': 100., 'renalMaximumHU': 220.,
          'sensitivity': {'huDelta': 5., 'filterDelta': .02}, 'radius': 'EDT-center-to-background-minus-half-pitch',
          'identityRule': 'all-26-connected-roots; no precedence; exact branch name remains U',
          'model': None, 'ultrasoundIntensityFromHU': False}
SOURCE_NAMES = ['aorta','inferior_vena_cava','portal_vein_and_splenic_vein','liver','heart','kidney_right','kidney_left',
                'spleen','pancreas','stomach','colon','small_bowel','duodenum','gallbladder','adrenal_gland_left','adrenal_gland_right']


def load(case_dir, manifest):
    source = v.module('s0028-source')
    reference = v.module('ct_vascular_reference')
    case_dir = Path(case_dir).resolve()
    if manifest['person'] != 's0028': raise ValueError('persona distinta')
    transform = np.asarray(manifest['rasToLASmm'], float)
    v.frame_affine(transform@np.asarray(manifest['affineRASmm'], float))
    if not np.array_equal(transform[:3,:3], np.diag([-1.,1.,1.])) or not np.array_equal(transform[3],[0,0,0,1]):
        raise ValueError('requiere reflexión y traslación únicas')
    path = case_dir/'ct.nii.gz'
    if source.digest(path) != manifest['ctSha256']: raise ValueError('hash TAC distinto')
    im = nib.load(path); source.geometry(im,manifest,'TAC'); reference.physical_affine(im,manifest['millimeterEvidence'])
    ct = np.asarray(im.dataobj,dtype=np.float32)
    if not np.isfinite(ct).all(): raise ValueError('TAC no finito')
    masks = {}
    for name in SOURCE_NAMES:
        entry = manifest['masks'][name]; path = (case_dir/entry['path']).resolve()
        if entry['person'] != 's0028' or not path.is_relative_to(case_dir): raise ValueError('donante/ruta distinta')
        if source.digest(path) != entry['sha256']: raise ValueError('hash máscara distinto: '+name)
        image = nib.load(path); source.geometry(image,manifest,name)
        reference.geometry_matches(image,im,manifest['millimeterEvidence'])
        masks[name] = reference.binary_mask(image)
    return ct,masks,transform@im.affine,source.physical_id(manifest)


def crop_box(mask, margin=2):
    q = np.argwhere(mask)
    lo = np.maximum(q.min(0)-margin,0);hi = np.minimum(q.max(0)+margin+1,mask.shape)
    return lo,tuple(slice(a,b) for a,b in zip(lo,hi))


def connectivity_candidates(hu, domain, seeds, params, minimum_hu, maximum_hu=None):
    smooth = ndi.gaussian_filter(hu,params['smoothSigmaVoxels'])
    response = frangi(hu,sigmas=params['filterSigmaVoxels'],alpha=params['alpha'],beta=params['beta'],gamma=params['gamma'],black_ridges=False)
    base_domain = domain.copy()
    for mask in seeds.values(): base_domain &= ~mask
    if maximum_hu is not None: base_domain &= smooth <= maximum_hu
    results=[]
    tests=[(minimum_hu,params['filterMinimum']),
           (minimum_hu-params['sensitivity']['huDelta'],params['filterMinimum']),
           (minimum_hu+params['sensitivity']['huDelta'],params['filterMinimum']),
           (minimum_hu,params['filterMinimum']-params['sensitivity']['filterDelta']),
           (minimum_hu,params['filterMinimum']+params['sensitivity']['filterDelta'])]
    signatures=[]
    seed_names=sorted(seeds)
    base=None
    for ht,vt in tests:
        candidate=base_domain & (smooth>=ht) & (response>=vt)
        result=v.connected_identities(candidate,seeds)
        table=np.zeros(len(result['components'])+1,np.uint16)
        for row in result['components']:
            table[row['label']]=sum(1<<seed_names.index(k) for k in row['roots'])
        signature=table[result['labels']]
        signatures.append(signature)
        if base is None:base=result
        results.append({'minimumHU':ht,'filterMinimum':vt,'candidateVoxels':int(candidate.sum()),
                        'components':result['components']})
    stable=np.logical_and.reduce([s==signatures[0] for s in signatures[1:]]) & (signatures[0]>0)
    return base,stable,results,response


def environment():
    return {'python':platform.python_version(), 'packages':{p:importlib.metadata.version(p) for p in
            ['numpy','scipy','nibabel','scikit-image','matplotlib']},'learnedModel':None,
            'filterLicense':'scikit-image BSD-3-Clause; no TotalSegmentator inference/model executed'}


def baseline(repo):
    paths=sorted((repo/'src/anatomy/s0028').glob('*.bin'))+[repo/'src/anatomy/abdominal-body.bin']
    rows=[{'path':str(p.relative_to(repo)),'bytes':p.stat().st_size,'sha256':v.sha(p.read_bytes())} for p in paths]
    return rows,sum(r['bytes'] for r in rows)


def export(case_dir, manifest, out, params=PARAMS):
    out=Path(out).resolve();repo=Path(__file__).resolve().parents[2]
    if out.is_relative_to(repo):raise ValueError('TAC/candidato/evidencia deben quedar fuera de Git')
    out.mkdir(parents=True,exist_ok=True)
    ct,m,affine,frame=load(case_dir,manifest)
    nodes,edges,groups,connections=[],[],[],[]
    sparse={};sources=v.source_conflicts({k:m[k] for k in SOURCE_NAMES[:3]})

    def add_group(name, mask, lo, system, exact_id, identity, root_mode=None, root_seed=None, flow='unknown',
                  known=None, evidence=None):
        if not mask.any():return
        if len(groups)>255:raise ValueError('más de 256 grupos: no truncar silenciosamente')
        transform=affine.copy();transform[:3,3]=nib.affines.apply_affine(affine,lo)
        graph=v.centerline(mask,transform,root_mode,flow,known,root_seed)
        gi=len(groups);a=len(nodes);c=len(edges)
        for n in graph['nodes']:
            n['ijk']=(np.asarray(n['ijk'])+lo).tolist();n['group']=gi;nodes.append(n)
        for e in graph['edges']:
            e['nodes']=[i+a for i in e['nodes']];e['group']=gi;edges.append(e)
        for r in graph['roots']:r['node']+=a
        diam=[2*n['r'] for n in graph['nodes']]
        length=sum(float(np.linalg.norm(np.asarray(nodes[e['nodes'][0]]['p'])-nodes[e['nodes'][1]]['p'])) for e in graph['edges'])
        contacts=[]
        if root_seed is not None:
            witnesses=np.argwhere(mask & ndi.binary_dilation(root_seed,v.N26))
            cl,n=ndi.label(mask&ndi.binary_dilation(root_seed,v.N26),v.N26)
            for k in range(1,n+1):
                q=np.argwhere(cl==k)+lo
                contacts.append({'voxels':len(q),'nativeIJK':q[0].tolist(),'centerLASmm':nib.affines.apply_affine(affine,q.mean(0)).tolist()})
        row={'id':name,'system':system,'identityCertainty':identity,'physiologyId':exact_id,
             'systemCertainty':'D' if system is not None and all(n['certainty']=='D' for n in graph['nodes']) else 'U',
             'geometryProvenance':'D','geometryCertainty':'D' if name.startswith('source-') else 'U',
             'radiusCertainty':'D' if name.startswith('source-') else 'U',
             'nodeRange':[a,len(nodes)],'edgeRange':[c,len(edges)],'roots':graph['roots'],
             'positiveFlow':flow,'rootContacts':contacts,'evidence':evidence,
             'nodes':len(graph['nodes']),'segments':len(graph['edges']),'lengthMm':length,
             'diameterMm':{'min':min(diam),'mean':float(np.mean(diam)),'max':max(diam)} if diam else None,
             'DNodes':sum(n['certainty']=='D' for n in graph['nodes']),
             'UNodes':sum(n['certainty']=='U' for n in graph['nodes']),
             'cycleComponents':graph['cycleComponents'],'unrepresentedVoxels':graph['unrepresentedVoxels'],
             'unrepresentedComponents':graph['unrepresentedComponents'],
             'maskVoxels':int(mask.sum()),'maskVolumeMm3':float(mask.sum()*manifest['pitchMm']**3)}
        groups.append(row)
        sparse[name]=np.argwhere(mask).astype(np.uint16)+np.asarray(lo,dtype=np.uint16)
        print(f'{name}: {row["nodes"]} nodos, {row["segments"]} segmentos, {row["cycleComponents"]} componentes cíclicas',flush=True)
        return row

    for name,system,exact,identity,root,flow in [
        ('inferior_vena_cava','ivc',None,'U','superior','toward-root'),
        ('aorta','aorta','aorta','D','superior','away-from-root'),
        ('portal_vein_and_splenic_vein','portal',None,'U',None,'unknown')]:
        mask=m[name].copy();known=mask & ~sources
        evidence={'sourceLabel':name,'sourceSha256':manifest['masks'][name]['sha256'],'sourceCertainty':'O',
                  'conflictingVoxels':int((mask & sources).sum()),'scope':'entire-source-mask'}
        if name=='aorta':
            top=int(np.argwhere(m['liver'])[:,2].max())
            mask[:,:,top+1:]=False;known &=mask;known[:,:,top-2:]=False
            evidence.update({'scope':'abdominal-descending; cranial cut at source liver superior bound',
                             'cranialCutNativeK':top,'cutBandUVoxels':int((mask&~known).sum())})
        if name=='inferior_vena_cava':
            contact=mask & ndi.binary_dilation(m['heart'],v.N26)
            evidence.update({'heartContactVoxels':int(contact.sum()),'rightAtriumIdentity':'U; source heart is not chamber-labelled',
                             'cranialNativeK':int(np.argwhere(mask)[:,2].max()),'inferiorTruncation':True})
        if name=='portal_vein_and_splenic_vein':
            evidence['partition']='U: source jointly labels portal/splenic; no automatic pvTrunk or direction'
        lo,box=crop_box(mask)
        add_group('source-'+name,mask[box],lo,system,exact,identity,root_mode=root,flow=flow,known=known[box],evidence=evidence)

    lo,box=crop_box(m['liver'],4);l=m['liver'][box]
    seeds={'cava':m['inferior_vena_cava'][box],'portal':m['portal_vein_and_splenic_vein'][box]}
    inner=ndi.distance_transform_edt(l)>params['hepaticInteriorDistanceVoxels']
    domain=l & (inner|ndi.binary_dilation(seeds['cava']|seeds['portal'],v.N26,iterations=params['rootHaloVoxels']))
    liver,stable,sensitivity,response=connectivity_candidates(ct[box],domain,seeds,params,params['hepaticMinimumHU'])
    counters={};retained=[]
    for row in liver['components']:
        if row['voxels']<params['componentMinimumVoxels']:continue
        roots=row['roots'];kind=roots[0] if len(roots)==1 else 'conflict' if roots else 'unrooted'
        counters[kind]=counters.get(kind,0)+1;name=f'hepatic-{kind}-{counters[kind]:02}'
        a=liver['labels']==row['label'];known=a & stable if len(roots)==1 else np.zeros_like(a)
        evidence={**row,'stableVoxels':int(known.sum()),'branchNameCertainty':'U',
                  'reasonForU':'threshold-sensitive identity; exact named branch unverified' if roots else 'enhancing tubular candidate without source root'}
        group=add_group(name,a,lo,'hepaticVein' if kind=='cava' else 'portal' if kind=='portal' else None,None,'U',
                  root_mode='seed' if len(roots)==1 else None,root_seed=seeds[roots[0]] if len(roots)==1 else None,
                  flow='toward-root' if kind=='cava' else 'away-from-root' if kind=='portal' else 'unknown',
                  known=known,evidence=evidence)
        if len(roots)==1 and group['nodes']:
            parent_name='source-inferior_vena_cava' if kind=='cava' else 'source-portal_vein_and_splenic_vein'
            target_group=next(g for g in groups if g['id']==parent_name)
            target_nodes={tuple(np.asarray(nodes[i]['ijk'])-lo):i for i in range(*target_group['nodeRange'])}
            support=a|seeds[roots[0]]
            radius=ndi.distance_transform_edt(np.pad(support,1),sampling=manifest['pitchMm'])[1:-1,1:-1,1:-1]-.5*manifest['pitchMm']
            for anchor in group['roots']:
                start=nodes[anchor['node']]['ijk']
                path=v.attachment_path(support,np.asarray(start)-lo,target_nodes)
                connection={'fromGroup':name,'toGroup':parent_name,'fromNode':anchor['node'],
                            'supportBounds':{'lo':lo.tolist(),'shape':list(support.shape)},
                            'identityCertainty':'D','geometryCertainty':'U','flowCertainty':'U',
                            'referenceDirection':1 if kind=='cava' else -1,
                            'meaning':'observed 26-connected drainage/origin; voxel path joins separately extracted skeletons, not accepted lumen/flow'}
                if path is None:
                    connection.update({'status':'unresolved-gap','toNode':None,'pathIJK':[],'radiiMm':[]})
                else:
                    connection.update({'status':'connected-support','toNode':target_nodes[path[-1]],
                                       'pathIJK':(np.asarray(path)+lo).tolist(),'radiiMm':[float(radius[q]) for q in path]})
                connections.append(connection)
        retained.append(row)
    np.savez_compressed(out/'hepatic-review.npz',lo=lo,labels=liver['labels'],stable=stable,response=response)
    (out/'hepatic-sensitivity.json').write_bytes(v.canonical(sensitivity)+b'\n')

    # Exploración hiliar renal acotada por los riñones de esta persona; no extrapolar interlobares.
    kidney=m['kidney_left']|m['kidney_right'];lo,box=crop_box(kidney,4)
    domain=np.ones(ct[box].shape,bool)
    renal_seeds={'aorta':m['aorta'][box],'cava':m['inferior_vena_cava'][box],
                 'kidneyLeft':m['kidney_left'][box],'kidneyRight':m['kidney_right'][box]}
    for name in SOURCE_NAMES[3:]:domain &= ~m[name][box]
    renal,stable,renal_sensitivity,response=connectivity_candidates(ct[box],domain,renal_seeds,params,params['renalMinimumHU'],params['renalMaximumHU'])
    renal_rows=[]
    for row in renal['components']:
        if row['voxels']<params['componentMinimumVoxels'] or not any(k.startswith('kidney') for k in row['roots']):continue
        central=set(row['roots']) & {'aorta','cava'};sides=set(row['roots']) & {'kidneyLeft','kidneyRight'}
        name=f'renal-candidate-{len(renal_rows)+1:02}';a=renal['labels']==row['label']
        # Incluso con dos extremos compatibles, no se atribuye nombre renal sin estabilidad y continuidad revisadas.
        family='renalArtery' if central=={'aorta'} and len(sides)==1 else 'renalVein' if central=={'cava'} and len(sides)==1 else None
        add_group(name,a,lo,family,None,'U',known=np.zeros_like(a),evidence={**row,'stableVoxels':int((a&stable).sum()),
                    'reasonForU':'hilar enhancement not separately validated; competing roots remain conflict'})
        renal_rows.append(row)
    np.savez_compressed(out/'renal-review.npz',lo=lo,labels=renal['labels'],stable=stable)
    (out/'renal-sensitivity.json').write_bytes(v.canonical(renal_sensitivity)+b'\n')
    np.savez_compressed(out/'candidate-masks.npz',**sparse)
    payload,info=v.pack(nodes,edges)
    assets,download=baseline(repo)
    conflict_rows=[]
    for q in np.argwhere(sources):
        box=tuple(slice(max(0,int(i)-1),min(size,int(i)+2)) for i,size in zip(q,sources.shape))
        conflict_rows.append({'ijk':q.tolist(),'certainty':'U',
                              'identities':[name for name in SOURCE_NAMES[:3] if m[name][box].any()]})
    descriptor={'format':v.FORMAT,'person':'s0028','frameId':manifest['frameId'],'physicalFrameSha256':frame,
                'ctSha256':manifest['ctSha256'],'affineRASmm':manifest['affineRASmm'],'rasToLASmm':manifest['rasToLASmm'],
                'nativeShape':manifest['shape'],'units':'mm','source':manifest['source'],'sourceConflictVoxels':conflict_rows,
                'sourceMasks':{k:manifest['masks'][k] for k in SOURCE_NAMES},'parameters':params,'parametersSha256':v.sha(v.canonical(params)),
                'environment':environment(),'toolsSha256':{name:v.sha(Path(__file__).with_name(name).read_bytes()) for name in ['s0028-vessels.py','s0028-vessels-export.py','s0028-vessels-requirements.txt']},'geometry':info,'groups':groups,'connections':connections,'baselineAssets':assets,'baselineDownloadBytes':download,
                'runtimeInstalled':False,'ownerReview':'pending','clinicalValidation':False,
                'physiologyContract':{'doNotDeriveFromCT':['refRadius','profileN','wallMm','flowFactor','caliberLaw','waveform'],
                   'unknownIdentityBlocksPW':True,'flowSignIsReferenceNotInstantaneous':True,
                   'preserveNegatives':['wrongGateVessel','hepaticGateDropout','portalGateDropout','portalBranchShift','renalArterialGate']},
                'limitations':['No verified hvRight/hvMiddle/hvLeft partition; cava-connected candidates only',
                               'Portal/splenic/SMV partition and exact intrahepatic branch names remain U',
                               'Right atrium not separately labelled; cava ends at observed source boundary',
                               'Renal veins/arteries not accepted as separately identified; interlobars absent',
                               'Biliary ducts not separable in this extraction; no fabricated portal triads',
                               'Voxel skeleton lengths include stair steps/spurs; EDT radii are not cross-sectional or ultrasound diameters',
                               'No geometry donated from procedural tree; no HU to echo conversion'],
                'segmentationAccounting':{'hepaticCandidateVoxels':sum(r['voxels'] for r in liver['components']),
                     'hepaticRetainedVoxels':sum(r['voxels'] for r in retained),
                     'hepaticSmallUnrepresentedVoxels':sum(r['voxels'] for r in liver['components'] if r['voxels']<params['componentMinimumVoxels']),
                     'renalCandidateVoxels':sum(r['voxels'] for r in renal['components']),
                     'renalRetainedVoxels':sum(r['voxels'] for r in renal_rows)}}
    receipt=v.write_package(out/'candidate',payload,descriptor,support={k:a.tolist() for k,a in sparse.items()})
    (out/'measurements.json').write_bytes(v.canonical({'groups':groups,'connections':connections,'receipt':receipt,'accounting':descriptor['segmentationAccounting']})+b'\n')
    print(json.dumps(receipt),flush=True)
    return descriptor


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case-dir',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--manifest',type=Path,default=Path(__file__).with_name('s0028-case.json'))
    args=parser.parse_args();export(args.case_dir,json.loads(args.manifest.read_text()),args.out)


if __name__=='__main__':main()
