"""Cinco paneles físicos por ventana: TAC, candidato, procedural en s0028, diferencia y modelo antiguo.

El quinto panel usa SU propio marco y contornos; no se superpone otra persona al TAC. Las láminas no son eco.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgb
import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

spec=importlib.util.spec_from_file_location('vascular',Path(__file__).with_name('s0028-vessels.py'))
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
BITS={'ivc':1,'aorta':2,'portal':4,'hepaticVein':8,'renalVein':16,'renalArtery':32,'other':64,'U':128}
COLORS={1:'#3693ff',2:'#ff5757',4:'#dc66ff',8:'#4ce7b3',16:'#60dddd',32:'#ffad6b',64:'#aaaaaa',128:'#ffdc40'}
WINDOWS={'subxiphoid','epigastric','intercostal','subcostal','flank','portal','portalTrunk','renal','hepatorenal','portalSubcostal'}


def plane_points(plane):
    f=plane['frame'];u=plane['u0']+np.arange(plane['width'])*plane['pitchMm'];r=plane['r0']+np.arange(plane['height'])*plane['pitchMm']
    U,R=np.meshgrid(u,r)
    return np.asarray(f['face'])+U[...,None]*f['lateral']+R[...,None]*f['axial']


def reslice(volume, affine, points, order=1):
    coords=nib.affines.apply_affine(np.linalg.inv(affine),points)
    if order==0:
        ijk=np.floor(coords+.5).astype(int)
        valid=np.all((ijk>=0)&(ijk<np.asarray(volume.shape)),axis=-1)
        result=np.full(ijk.shape[:-1],np.nan)
        result[valid]=volume[tuple(ijk[valid].T)]
        return result
    return ndi.map_coordinates(volume,coords.reshape(-1,3).T,order=order,mode='constant',cval=np.nan).reshape(coords.shape[:-1])


def raster_graph(plane,nodes,edges,groups):
    """Corte exacto del modelo candidato lineal/circular: distancia al segmento 3D y radio interpolado.

    No colorea la máscara fuente en lugar de los bytes del grafo. Los cruces conservan OR de identidades.
    """
    f=plane['frame'];basis=np.asarray([f['lateral'],f['axial'],f['elevation']]);face=np.asarray(f['face'])
    if not np.allclose(basis@basis.T,np.eye(3),atol=1e-8,rtol=0):raise ValueError('plano no ortonormal')
    pos=(np.asarray([n['p'] for n in nodes])-face)@basis.T
    radii=np.asarray([n['r'] for n in nodes])
    result=np.zeros((plane['height'],plane['width']),np.uint16)
    linked=set()
    segments=[]
    for edge in edges:
        a,b=edge['nodes'];linked.update((a,b))
        segments.append((a,b,edge['group'],edge['certainty']=='U' or nodes[a]['certainty']=='U' or nodes[b]['certainty']=='U'))
    segments.extend((i,i,n['group'],n['certainty']=='U') for i,n in enumerate(nodes) if i not in linked)
    for ai,bi,gi,unknown in segments:
        a,b=pos[ai],pos[bi];radius=max(radii[ai],radii[bi])
        if min(a[2],b[2])>radius or max(a[2],b[2]) < -radius:continue
        low=np.floor((np.minimum(a[:2],b[:2])-radius-[plane['u0'],plane['r0']])/plane['pitchMm']).astype(int)
        high=np.ceil((np.maximum(a[:2],b[:2])+radius-[plane['u0'],plane['r0']])/plane['pitchMm']).astype(int)+1
        low=np.maximum(low,0);high=np.minimum(high,[plane['width'],plane['height']])
        if np.any(high<=low):continue
        u=plane['u0']+np.arange(low[0],high[0])*plane['pitchMm']
        r=plane['r0']+np.arange(low[1],high[1])*plane['pitchMm'];U,R=np.meshgrid(u,r)
        delta=b-a;length2=float(delta@delta)
        t=np.clip(((U-a[0])*delta[0]+(R-a[1])*delta[1]-a[2]*delta[2])/length2,0,1) if length2 else np.zeros(U.shape)
        d2=(U-a[0]-t*delta[0])**2+(R-a[1]-t*delta[1])**2+(a[2]+t*delta[2])**2
        local_radius=radii[ai]+t*(radii[bi]-radii[ai]);inside=d2<local_radius**2
        group=groups[gi]
        bit=BITS.get(group['system'],64) if group['id'].startswith('source-') else BITS['U']
        if unknown:bit |= BITS['U']
        result[low[1]:high[1],low[0]:high[0]][inside] |= bit
    return result


def overlay(code):
    rgb=np.zeros((*code.shape,4));count=np.zeros(code.shape,int)
    for bit,color in COLORS.items():
        hit=(code&bit)>0;rgb[hit,:3]+=to_rgb(color);count+=hit
    active=count>0;rgb[active,:3]/=count[active,None];rgb[active,3]=.95
    rgb[count>1,:3]=1  # conflicto visible; nunca precedencia
    rgb[(code&128)>0,:3]=to_rgb(COLORS[128])  # U visible aunque coexista con una etiqueta fuente
    return rgb


def graph_with_attachments(descriptor,nodes,edges):
    """Los caminos U del manifiesto también se dibujan; no ocultar uniones sólo porque estén fuera del binario."""
    nodes=list(nodes);edges=list(edges);groups=list(descriptor['groups'])
    affine=np.asarray(descriptor['rasToLASmm'])@np.asarray(descriptor['affineRASmm'])
    for k,connection in enumerate(descriptor.get('connections',[])):
        if connection['status']!='connected-support':continue
        start=len(nodes);group=len(groups)
        groups.append({'id':f'attachment-{k}','system':None})
        for ijk,radius in zip(connection['pathIJK'],connection['radiiMm']):
            nodes.append({'p':nib.affines.apply_affine(affine,ijk).tolist(),'r':radius,'group':group,'certainty':'U'})
        edges.extend({'nodes':[i,i+1],'group':group,'certainty':'U','flow':0} for i in range(start,len(nodes)-1))
    return nodes,edges,groups


def read_planes(directory,person):
    directory=Path(directory);data=json.loads((directory/'planes.json').read_bytes())
    if data.get('person')!=person:raise ValueError('plano de otra persona')
    if data['frameId']!=('s0028-audit-las-v1' if person=='s0028' else 'registered-las-v1'):raise ValueError('marco de otra persona')
    if len(data['planes'])!=10 or {p['id'] for p in data['planes']}!=WINDOWS:raise ValueError('faltan/sobran ventanas vigentes')
    required={f'procedural-{p["id"]}.u16':p['width']*p['height']*2 for p in data['planes']}
    if person=='current':required.update({f'context-{p["id"]}.u8':p['width']*p['height'] for p in data['planes']})
    if set(data['hashes'])!=set(required):raise ValueError('inventario de comparadores incompleto')
    for filename,digest in data['hashes'].items():
        raw=(directory/filename).read_bytes()
        if Path(filename).name!=filename or len(raw)!=required[filename] or v.sha(raw)!=digest:raise ValueError('comparador corrupto')
    return data


def extent(p):
    h=p['pitchMm']/2
    return [p['u0']-h,p['u0']+(p['width']-1)*p['pitchMm']+h,
            p['r0']+(p['height']-1)*p['pitchMm']+h,p['r0']-h]


def make_plates(case_dir,extraction,planes_dir,old_dir,out):
    out=Path(out).resolve()
    if out.is_relative_to(Path(__file__).resolve().parents[2]):raise ValueError('láminas TAC deben quedar fuera de Git')
    out.mkdir(parents=True,exist_ok=True)
    export=v.module('s0028-vessels-export');case=json.loads(Path(__file__).with_name('s0028-case.json').read_bytes())
    ct,masks,affine,frame=export.load(case_dir,case)
    d,nodes,edges=v.verify_package(Path(extraction)/'candidate',frame,case)
    display_nodes,display_edges,display_groups=graph_with_attachments(d,nodes,edges)
    planes=read_planes(planes_dir,'s0028');old=read_planes(old_dir,'current');old_by_id={p['id']:p for p in old['planes']}
    if planes['ctSha256']!=case['ctSha256']:raise ValueError('TAC distinto en el plano')
    report=[];checklists=[]
    for p in planes['planes']:
        ident=p['id'];points=plane_points(p);gray=reslice(ct,affine,points)
        candidate=raster_graph(p,display_nodes,display_edges,display_groups)
        ijk=np.floor(nib.affines.apply_affine(np.linalg.inv(affine),points)+.5).astype(int)
        for conflict in d.get('sourceConflictVoxels',[]):candidate[np.all(ijk==conflict['ijk'],axis=-1)] |= BITS['U']
        procedural=np.fromfile(Path(planes_dir)/f'procedural-{ident}.u16',dtype='<u2').reshape(gray.shape)
        op=old_by_id[ident]
        old_vessels=np.fromfile(Path(old_dir)/f'procedural-{ident}.u16',dtype='<u2').reshape(op['height'],op['width'])
        old_context=np.fromfile(Path(old_dir)/f'context-{ident}.u8',dtype='u1').reshape(old_vessels.shape)
        liver=reslice(masks['liver'],affine,points,0)>.5
        source=np.zeros(gray.shape,np.uint16)
        for name,bit in [('inferior_vena_cava',1),('aorta',2),('portal_vein_and_splenic_vein',4)]:
            source[reslice(masks[name],affine,points,0)>.5]|=bit
        new=candidate>0;previous=procedural>0
        diff=np.zeros((*gray.shape,4));diff[new&~previous]=(*to_rgb('#22d7ff'),1);diff[previous&~new]=(*to_rgb('#ff54c5'),1)
        diff[new&previous]=(1,1,1,1)
        fig,axs=plt.subplots(1,5,figsize=(23,6.9),sharey=False)
        titles=['TAC s0028\nHU [-40, 180]', 'Grafo candidato s0028\nradios/nodos del paquete',
                'Procedurales vigentes\nen ESTE plano s0028','Diferencia geométrica\ncian candidato · rosa procedural','Modelo antiguo\nSU propia ventana; sin TAC']
        for ax,title in zip(axs,titles):ax.set_title(title,fontsize=11);ax.set_xlabel('u lateral, mm',fontsize=9)
        for ax in axs[:4]:
            ax.imshow(gray,cmap='gray',vmin=-40,vmax=180,extent=extent(p),interpolation='nearest',alpha=1 if ax==axs[0] else .45)
            ax.set_facecolor('#151922')
            if liver.any():ax.contour(liver,levels=[.5],colors=['#dba35a'],linewidths=.55,extent=extent(p),origin='upper')
        axs[1].imshow(overlay(candidate),extent=extent(p),interpolation='nearest')
        if source.any():axs[1].contour(source>0,levels=[.5],colors=['#eeeeee'],linewidths=.65,linestyles='dotted',extent=extent(p),origin='upper')
        axs[2].imshow(overlay(procedural),extent=extent(p),interpolation='nearest')
        axs[3].imshow(diff,extent=extent(p),interpolation='nearest')
        context=np.zeros((*old_context.shape,3));context[:]=to_rgb('#151922')
        context[(old_context&1)>0]=to_rgb('#5d4b38');context[(old_context&6)>0]=to_rgb('#474558')
        axs[4].imshow(context,extent=extent(op),interpolation='nearest')
        axs[4].imshow(overlay(old_vessels),extent=extent(op),interpolation='nearest')
        for bit in (1,2,4):
            if (old_context&bit).any():axs[4].contour((old_context&bit)>0,levels=[.5],colors=['#aaaaaa'],linewidths=.5,extent=extent(op),origin='upper')
        axs[0].set_ylabel('r profundidad en plano, mm',fontsize=9)
        for ax in axs:ax.tick_params(labelsize=8);ax.set_aspect('equal')
        fig.suptitle(f'{ident} — {p["label"]} | P5 r1 OFFLINE · mismo plano en columnas 1–4 · comparación de personas en columna 5',fontsize=13,y=.96)
        fig.text(.035,.20,'Azul: VCI · rojo: aorta · violeta: porta/esplénica · verde: suprahepática procedural · amarillo: candidatos U. Blanco punteado: máscara vascular fuente.',fontsize=10)
        fig.text(.035,.165,'Evidencia: nombres de las 3 suprahepáticas U; conexión a cava/porta conservada donde existe. Renales U. Vía biliar no separada. Radios EDT, no diámetros ecográficos.',fontsize=9)
        fig.text(.035,.115,'Propietario (sin rellenar):  [ ] Sí  [ ] No — ¿La VCI coincide con el TAC donde aparece?     [ ] Sí  [ ] No — ¿Se reconocen tres suprahepáticas que confluyen?',fontsize=10)
        fig.text(.035,.075,'[ ] Sí  [ ] No — ¿La porta entra por el hilio?     [ ] Sí  [ ] No — ¿Ramas portales y conductos biliares se reconocen juntos? (Conductos no extraídos en r1.)',fontsize=10)
        fig.text(.035,.035,'No es una imagen ecográfica ni validación clínica. Sin HU a brillo eco, sin reajustar poses y sin copiar geometría de la columna 5 al candidato.',fontsize=9)
        fig.subplots_adjust(left=.035,right=.99,top=.86,bottom=.26,wspace=.17)
        filename=f'{ident}.png';fig.savefig(out/filename,dpi=140,facecolor='white');plt.close(fig)
        per_source={}
        for label,bit in [('ivc',1),('aorta',2),('portalSplenic',4)]:
            a=(candidate&bit)>0;b=(source&bit)>0;both=int((a&b).sum());den=int(a.sum()+b.sum())
            per_source[label]={'graphPixels':int(a.sum()),'sourcePixels':int(b.sum()),'intersection':both,
                               'dice':2*both/den if den else None,'meaning':'circular graph vs native label in this fixed plane; not acceptance'}
        row={'id':ident,'file':filename,'sha256':v.sha((out/filename).read_bytes()),'sizeBytes':(out/filename).stat().st_size,
             'candidatePixels':int(new.sum()),'proceduralPixels':int(previous.sum()),'overlapPixels':int((new&previous).sum()),
             'unknownCandidatePixels':int(((candidate&128)>0).sum()),'ctUnavailablePixels':int(np.isnan(gray).sum()),
             'sourceComparison':per_source,'oldFrame':op['frame'],'s0028Frame':p['frame'],'ownerReview':'pending'}
        report.append(row)
        checklists.append(f'## {ident}\n\n![{ident}]({filename})\n\n- [ ] Sí / [ ] No: VCI coincide con TAC donde aparece.\n- [ ] Sí / [ ] No: se reconocen tres suprahepáticas que confluyen en VCI (r1: identidad nominal U).\n- [ ] Sí / [ ] No: porta entra por el hilio.\n- [ ] Sí / [ ] No: ramas portales con conductos biliares acompañantes (r1: no separados).\n\nCandidato {row["candidatePixels"]} píxeles; procedural en plano s0028 {row["proceduralPixels"]}; intersección geométrica {row["overlapPixels"]}. U {row["unknownCandidatePixels"]}.\n')
        print(ident,row['sha256'],flush=True)
    (out/'plates.json').write_bytes(v.canonical({'candidateManifestSha256':v.sha((Path(extraction)/'candidate/manifest.json').read_bytes()),
            'planesSha256':v.sha((Path(planes_dir)/'planes.json').read_bytes()),'oldPlanesSha256':v.sha((Path(old_dir)/'planes.json').read_bytes()),
            'plates':report,'ownerReview':'pending','openedByAgent':False})+b'\n')
    (out/'OWNER-CHECKLIST.md').write_text('# P5 r1 — revisión pendiente del propietario\n\nLas casillas permanecen sin rellenar. La columna 5 tiene otra persona y su propia ventana.\n\n'+'\n'.join(checklists))
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('case-dir','extraction','planes','old-planes','out'):parser.add_argument('--'+name,type=Path,required=True)
    a=parser.parse_args();make_plates(a.case_dir,a.extraction,a.planes,a.old_planes,a.out)


if __name__=='__main__':main()
