"""Common-frame rib / existing organ field intersections, no hidden registration changes."""
import gzip,json,re,numpy as np
from scipy.ndimage import map_coordinates
from pathlib import Path
j=json.loads(Path('docs/anatomy/thoracic-atlas-manifest.json').read_text());m=j['meta']
d=np.frombuffer(gzip.decompress(Path('src/anatomy/thoracic-atlas.gzip.bin').read_bytes()),dtype='<f2').reshape((*m['textureDimensions'][::-1],2)).astype(float)
riblabels=[p['label']for p in j['parts']if ' rib' in p['name']]
indices=np.argwhere((d[...,0]<-.8)&np.isin(d[...,1],riblabels));ps=indices[:,::-1]*1.5+m['originMm']
s=Path('src/anatomy/abdominalAtlasData.ts').read_text()
dimensions=list(map(int,re.search(r'textureDimensions: \[(.*?)\]',s).group(1).split(',')))
raw=np.frombuffer(gzip.decompress(Path('src/anatomy/abdominal-atlas.gzip.bin').read_bytes()),dtype='<f2').reshape((*dimensions[::-1],2)).astype(float);result={}
for name,origin,dims,off in re.findall(r"name: '(.*?)', originMm: \[(.*?)\], dimensions: \[(.*?)\], offset: \[(.*?)\]",s):
 if name not in ['liver','kidneyRight','kidneyLeft','spleen','pancreas','digestiveTract','bladder','gallbladder']:continue
 o=np.array(list(map(float,origin.split(','))));n=np.array(list(map(int,dims.split(','))));t=np.array(list(map(int,off.split(','))));q=(ps-o)/1.5;valid=np.all((q>=0)&(q<=n-1),axis=1)
 values=map_coordinates(raw[...,0],(q[valid]+t).T[::-1],order=1);labels=d[tuple(indices[valid].T)][...,1];bad=values<0;deep=values<-1.5
 result[name]={'overlapVoxelCount':int(bad.sum()),'deepOverlapVoxelCount':int(deep.sum()),'maximumPenetrationMm':float(max(0,-values.min())) if len(values) else 0,'byRib':{p['name']:int(sum((labels==p['label'])&bad))for p in j['parts']if p['label']in riblabels and sum((labels==p['label'])&bad)}}
print(json.dumps(result,indent=2))
