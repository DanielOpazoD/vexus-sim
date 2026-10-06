"""Install a reviewed offline candidate, pinning identical CPU/GPU/3D input bytes.
Does not download, regenerate or certify anatomy. Run field/contact audit before this step.
"""
import argparse,gzip,hashlib,json
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate-dir',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
manifest=json.loads((args.candidate_dir/'abdominal-atlas-manifest.json').read_text())
compressed=(args.candidate_dir/'abdominal-atlas.bin.gz').read_bytes()
if manifest['rawBytes']>96*1024*1024 or len(compressed)>6*1024*1024:raise ValueError('Candidate exceeds its declared memory/transfer contract')
raw=gzip.decompress(compressed)
for data,key in [(compressed,'sha256Gzip'),(raw,'sha256Raw')]:
 if hashlib.sha256(data).hexdigest()!=manifest[key]:raise ValueError('Candidate hash mismatch')
if len(raw)!=manifest['rawBytes']:raise ValueError('Candidate size mismatch')
fields=[{k:f[k]for k in ['name','originMm','dimensions','offset','pitchMm']}for f in manifest['fields']]
body=json.loads((args.candidate_dir/'abdominal-body-provenance.json').read_text())
bodyRaw=(args.candidate_dir/'abdominal-body.bin').read_bytes()
if len(bodyRaw)!=14*65*4 or len(bodyRaw)!=body['bytes'] or hashlib.sha256(bodyRaw).hexdigest()!=body['sha256']:raise ValueError('Candidate body hash/size mismatch')
metadata={k:manifest[k]for k in ['textureDimensions','rawBytes','gzipBytes','sha256Gzip','sha256Raw']}
(root/'src/anatomy/abdominal-body.bin').write_bytes(bodyRaw)
(root/'docs/anatomy/abdominal-body-provenance.json').write_text(json.dumps(body,indent=2)+'\n')
(root/'src/anatomy/abdominal-atlas.gzip.bin').write_bytes(compressed)
(root/'docs/anatomy/abdominal-atlas-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
text='/** Generated registered atlas descriptors; full provenance in docs/anatomy. */\n'
for name,value in [('ABDOMINAL_ATLAS',metadata),('ABDOMINAL_FIELDS',fields),('ABDOMINAL_BODY',{'bytes':body['bytes'],'sha256':body['sha256']})]:text+='export const '+name+' = '+json.dumps(value)+' as const;\n'
(root/'src/anatomy/abdominalAtlasData.ts').write_text(text)
