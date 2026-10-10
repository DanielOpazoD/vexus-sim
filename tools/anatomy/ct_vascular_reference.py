"""Audita un TAC y máscaras del mismo caso en su rejilla física original.

Herramienta offline de referencia; no convierte HU en ecografía ni instala anatomía.
Dependencias: numpy, nibabel y scipy. Datos/etiquetas fuera del repositorio.
"""
from pathlib import Path
import argparse
import hashlib
import json

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi


GEOMETRY_TOLERANCE_MM = 1e-4  # Redondeo del sform NIFTI; no tolerancia anatómica.


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def physical_affine(image, units_evidence=None):
    if len(image.shape) != 3:
        raise ValueError("Solo volúmenes 3D; no seleccionar silenciosamente una fase")
    affine = np.asarray(image.affine, dtype=float)
    if not np.isfinite(affine).all() or abs(np.linalg.det(affine[:3, :3])) < 1e-12:
        raise ValueError("Affine físico inválido")
    units = image.header.get_xyzt_units()[0]
    if units != "mm" and not (units == "unknown" and units_evidence):
        raise ValueError("Unidades: exigir mm declarados o evidencia explícita si faltan")
    q, qc = image.get_qform(coded=True)
    s, sc = image.get_sform(coded=True)
    if not qc and not sc:
        raise ValueError("Transformación física ausente; el affine de respaldo no orienta al paciente")
    if qc and sc and not np.allclose(q, s, atol=GEOMETRY_TOLERANCE_MM, rtol=0):
        raise ValueError("qform/sform contradictorios; revisar la fuente")
    return affine


def binary_mask(image):
    data = np.asarray(image.dataobj)
    if not np.isfinite(data).all() or not np.isin(data, [0, 1]).all():
        raise ValueError("Máscara binaria requerida: no unir clases o valores por >0")
    return data.astype(bool)


def geometry_matches(image, reference, units_evidence=None):
    affine = physical_affine(image, units_evidence)
    reference_affine = physical_affine(reference, units_evidence)
    if image.shape != reference.shape or not np.allclose(
            affine, reference_affine, atol=GEOMETRY_TOLERANCE_MM, rtol=0):
        raise ValueError("Máscara y TAC no comparten rejilla; no registrar por órgano")


def summarize(mask, affine, ct):
    count = int(mask.sum())
    result = {"voxels": count, "volumeMm3": count * abs(float(np.linalg.det(affine[:3, :3])))}
    if not count:
        return {**result, "empty": True, "components26": 0, "centroidRASmm": None}
    indices = np.argwhere(mask)
    positions = nib.affines.apply_affine(affine, indices)
    lo, hi = indices.min(axis=0), indices.max(axis=0)
    crop = mask[tuple(slice(a, b+1) for a, b in zip(lo, hi))]
    components, n = ndi.label(crop, structure=ndi.generate_binary_structure(3, 3))
    sizes = np.bincount(components.ravel())[1:]
    internal = ndi.binary_erosion(crop, iterations=1)
    internal_values = ct[tuple(slice(a, b+1) for a, b in zip(lo, hi))][internal]
    return {**result, "empty": False, "centroidRASmm": positions.mean(axis=0).tolist(),
        "occupiedCenterBoundsRASmm": [positions.min(axis=0).tolist(), positions.max(axis=0).tolist()],
        "boundsMeaning": "Centros ocupados, no bordes subvoxel ni diámetro ecográfico",
        "components26": int(n), "componentSizesDescending": sorted(map(int, sizes), reverse=True),
        "touchesImageFaces": [bool(np.take(mask, k, axis=d).any())
            for d in range(3) for k in [0, mask.shape[d]-1]],
        "ctQuantiles": np.quantile(ct[mask], [.1, .5, .9]).tolist(),
        "erodedOneVoxelCtQuantiles": np.quantile(internal_values, [.1, .5, .9]).tolist()
            if len(internal_values) else None,
        "attenuationMeaning": "Intensidades originales según procedencia declarada; erosión de un voxel, no espesor físico constante ni clasificador de fase"}


def audit(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text())
    base = manifest_path.parent
    evidence = manifest.get("millimeterEvidence")
    ct_path = (base / manifest["ct"]).resolve()
    image = nib.load(ct_path)
    affine = physical_affine(image, evidence)
    ct = np.asarray(image.dataobj)
    if not np.isfinite(ct).all():
        raise ValueError("TAC no finito")
    masks, results = {}, {}
    for name, spec in manifest["masks"].items():
        path = (base / spec["path"]).resolve()
        label = nib.load(path)
        geometry_matches(label, image, evidence)
        mask = binary_mask(label)
        masks[name] = mask
        results[name] = {"sha256": digest(path), "sourceLabel": spec["sourceLabel"],
            "identityStatus": spec["identityStatus"], **summarize(mask, affine, ct)}
    intersections = []
    names = list(masks)
    for i, a in enumerate(names):
        for b in names[i+1:]:
            intersections.append({"a": a, "b": b, "overlapVoxels": int(np.count_nonzero(masks[a] & masks[b]))})
    vascular_names = manifest["vascularLabels"]
    if any(name not in masks for name in vascular_names):
        raise ValueError("Etiqueta vascular declarada ausente")
    vascular_present = [name for name in vascular_names if results[name]["voxels"]]
    return {"schemaVersion": 1, "source": manifest["source"], "manifestSha256": digest(manifest_path),
        "ctSha256": digest(ct_path), "shape": list(image.shape), "affineRASmm": affine.tolist(),
        "unitsDeclared": image.header.get_xyzt_units()[0], "millimeterEvidence": evidence,
        "intensityUnits": manifest["intensityUnits"], "contrastPhase": manifest.get("contrastPhase", "unknown"),
        "geometryToleranceMm": GEOMETRY_TOLERANCE_MM,
        "allMasksShareOriginalGrid": True, "masks": results, "intersections": intersections,
        "vascularLabelsPresent": vascular_present,
        "missingRequiredIdentities": [name for name in manifest["requiredIdentities"]
            if not any(spec["identityStatus"] == "separate-source-label" and key == name and results[key]["voxels"]
                for key, spec in manifest["masks"].items())],
        "nativeRASToVExUSAxisConvention": [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "axisTransformMeaning": "Solo convención LAS; no registra otro individuo ni mueve órganos",
        "runtimeInstalled": False, "clinicalNormalityConfirmed": False, "ultrasoundValidated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.manifest)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"sharedGrid": True, "vascularLabels": result["vascularLabelsPresent"],
        "missingRequiredIdentities": result["missingRequiredIdentities"], "runtimeInstalled": False}))


if __name__ == "__main__":
    main()
