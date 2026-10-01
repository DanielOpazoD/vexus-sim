"""Build the inspected BodyParts3D profile. No mesh download or clinical scaling.
Source angles are LPS (+Y posterior); runtime LAS angles reverse their sign.
Null source rays stay null in the JSON; periodic interpolation is an explicit approximation.
"""
import json, math, pathlib, struct
root = pathlib.Path(__file__).resolve().parents[2]
source = json.loads((root / 'docs/anatomy/reference-skin-source.json').read_text())
values = []
for row in source['rows']:
    radii = row['radiiMm']
    observed = [i for i, r in enumerate(radii) if r is not None]
    filled = []
    for i, radius in enumerate(radii):
        if radius is None:
            before = min(observed, key=lambda j: (i-j) % 64)
            after = min(observed, key=lambda j: (j-i) % 64)
            f = ((i-before) % 64) / ((after-before) % 64)
            radius = radii[before] + f*(radii[after]-radii[before])
        filled.append(radius)
    values.append(row['centreYmm'])
    values.extend(filled[(-i) % 64] for i in range(64))
(root / 'src/anatomy/reference-body.bin').write_bytes(struct.pack('<520f', *values))
