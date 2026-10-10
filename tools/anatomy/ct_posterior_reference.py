"""Relaciones renales posteriores en el TAC original, sin registrar otro individuo.

Las distancias son entre centros de voxeles de frontera ocupados. No son espesores
fasciales ni medidas ecográficas; no se infiere grasa a partir de una separación.
Utiliza el contrato de rejilla/unidades de ct_vascular_reference.
"""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

from ct_vascular_reference import binary_mask, digest, geometry_matches, physical_affine, summarize


def surface_centers(mask, affine):
    """Frontera de 6 vecinos sin cerrar agujeros ni retirar componentes."""
    surface = mask & ~ndi.binary_erosion(mask)
    return nib.affines.apply_affine(affine, np.argwhere(surface))


def nearest_centers(a, b):
    if not len(a) or not len(b):
        return {"status": "empty-mask", "minimumMm": None}
    distances, indices = cKDTree(b).query(a)
    witness = int(np.argmin(distances))
    return {"status": "measured", "minimumMm": float(distances[witness]),
            "quantilesMm": np.quantile(distances, [0, .1, .5, .9, 1]).tolist(),
            "witnessRASmm": [a[witness].tolist(), b[indices[witness]].tolist()],
            "meaning": "Occupied boundary voxel centers, not subvoxel surfaces or fascia thickness"}


def posterior_rays(kidney, muscle, ct, affine):
    """Todos los rayos de columnas XZ con riñón y músculo posterior en este plano.

    Exige rejilla alineada a RAS: una fila oblicua no se llama anteroposterior.
    Cuenta celdas estrictamente interpuestas. La fracción de HU compatibles con
    grasa es descriptiva, no segmentación ni aceptación de un compartimento.
    """
    axes = affine[:3, :3]
    if not np.allclose(axes, np.diag(np.diag(axes)), atol=1e-8, rtol=0):
        raise ValueError("Rayos AP requieren rejilla RAS alineada, no ejes oblicuos")
    if np.any(np.diag(axes) <= 0):
        raise ValueError("Rayos AP requieren índices crecientes RAS; no invertir silenciosamente")
    pitch = float(axes[1, 1])
    rows, missing = [], 0
    for x, z in np.argwhere(kidney.any(axis=1)):
        posterior = int(np.flatnonzero(kidney[x, :, z])[0])
        hits = np.flatnonzero(muscle[x, :posterior, z])
        if not len(hits):
            missing += 1
            continue
        front = int(hits[-1])
        values = ct[x, front+1:posterior, z]
        rows.append({"kidneyBoundaryVoxel": [int(x), posterior, int(z)],
                     "muscleBoundaryVoxel": [int(x), front, int(z)],
                     "boundaryCenterSeparationMm": (posterior-front)*pitch,
                     "interposedCellCount": len(values), "interposedCellSpanMm": len(values)*pitch,
                     "gapAttenuationQuantiles": np.quantile(values, [.1, .5, .9]).tolist() if len(values) else None,
                     "fractionGapValuesMinus190ToMinus30": float(((values >= -190) & (values <= -30)).mean())
                     if len(values) else None})
    spans = [r["interposedCellSpanMm"] for r in rows]
    return {"rays": rows, "matchedColumns": len(rows), "noPosteriorMuscleHitColumns": missing,
            "adjacentLabelColumns": sum(r["interposedCellCount"] == 0 for r in rows),
            "spanQuantilesMm": np.quantile(spans, [0, .1, .5, .9, 1]).tolist() if spans else None,
            "meaning": "Exact source AP columns; all matches kept, no fat/fascia segmentation inferred",
            "attenuationLimit": "Minus190..minus30 HU is a descriptive fat-compatible range, not a mask or normal threshold"}


def audit(path):
    path = Path(path).resolve()
    manifest = json.loads(path.read_text())
    base, evidence = path.parent, manifest.get("millimeterEvidence")
    ct_path = (base/manifest["ct"]).resolve()
    image = nib.load(ct_path)
    affine = physical_affine(image, evidence)
    ct = np.asarray(image.dataobj)
    if not np.isfinite(ct).all():
        raise ValueError("TAC no finito")
    if digest(ct_path) != manifest["ctSha256"]:
        raise ValueError("SHA del TAC distinto del manifest")
    masks, centers, stats = {}, {}, {}
    for name, spec in manifest["masks"].items():
        label_path = (base/spec["path"]).resolve()
        if digest(label_path) != spec["sha256"]:
            raise ValueError("SHA de máscara distinto: "+name)
        image_mask = nib.load(label_path)
        geometry_matches(image_mask, image, evidence)
        mask = binary_mask(image_mask)
        masks[name], centers[name] = mask, surface_centers(mask, affine)
        stats[name] = {"sourceLabel": spec["sourceLabel"], "sha256": spec["sha256"],
                       **summarize(mask, affine, ct)}
    relationships = []
    for kidney in ["kidney_right", "kidney_left"]:
        for other in manifest["relationshipLabels"]:
            if other not in masks:
                raise ValueError("Etiqueta de relación ausente: "+other)
            relationships.append({"kidney": kidney, "other": other,
                                  "overlapVoxels": int((masks[kidney] & masks[other]).sum()),
                                  **nearest_centers(centers[kidney], centers[other])})
    rays = {}
    for side in ["right", "left"]:
        rays[side] = posterior_rays(masks["kidney_"+side], masks["iliopsoas_"+side], ct, affine)
    return {"schemaVersion": 1, "manifestSha256": digest(path), "source": manifest["source"],
            "ctSha256": manifest["ctSha256"], "shape": list(image.shape), "affineRASmm": affine.tolist(),
            "allMasksShareOriginalGrid": True, "masks": stats, "relationships": relationships,
            "posteriorRaysToIliopsoas": rays, "runtimeInstalled": False, "clinicalNormalityConfirmed": False,
            "fasciaIdentified": False, "quadratusLumborumIdentified": False,
            "limitations": ["One case is not a normal population, protocol or contrast phase is not verified.",
                            "Iliopsoas/autochthon labels are not isolated psoas/QL or separate erector muscles.",
                            "Missing fascia/QL masks are not inferred from adjacent fat or a gap.",
                            "The simulator has another individual; no per-organ registration or fitting.",
                            "1.5mm original sampling cannot certify thin fascial thickness or an acoustic interface."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Conservar evidencia previa; elegir salida nueva")
    result = audit(args.manifest)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"source": result["source"], "relationships": len(result["relationships"]),
                      "rays": {s: {k: v for k, v in r.items() if k != "rays"}
                               for s, r in result["posteriorRaysToIliopsoas"].items()},
                      "runtimeInstalled": False}))


if __name__ == "__main__":
    main()
