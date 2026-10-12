"""Admisión local de una pareja TRUSTED; no descarga ni registra pacientes.

Mismo paciente no implica planos coincidentes. La salida conserva dos marcos y
no convierte una máscara de ambos riñones del TAC en una etiqueta lateral.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

import nibabel as nib
import numpy as np

from ct_vascular_reference import geometry_matches, physical_affine


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_file(base, spec):
    expected = spec.get("sha256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("SHA-256 requerido por archivo")
    path = (base / spec["path"]).resolve()
    if file_hash(path) != expected:
        raise ValueError("Contenido distinto del manifiesto: " + path.name)
    return path


def inspect_volume(path, evidence):
    image = nib.load(path)
    affine = physical_affine(image, evidence)
    data = np.asanyarray(image.dataobj)
    if not np.isfinite(data).all():
        raise ValueError("Volumen con valores no finitos")
    values = [float(data.min()), float(data.max())]
    if values[0] == values[1]:
        raise ValueError("Volumen constante: no hay imagen evaluable")
    return image, {
        "shape": list(image.shape), "dtypeStored": str(image.get_data_dtype()),
        "spacingMm": np.linalg.norm(affine[:3, :3], axis=0).tolist(),
        "voxelToWorldMm": affine.tolist(), "axisCodes": list(nib.aff2axcodes(affine)),
        "worldMeaning": "Marco propio de esta adquisición; no alineado con la otra modalidad",
        "intensityRange": values, "storedFileBytes": path.stat().st_size,
        "decodedArrayBytes": int(data.nbytes), "sha256": file_hash(path),
        "qformCode": int(image.header["qform_code"]),
        "sformCode": int(image.header["sform_code"]),
        "unitsDeclared": image.header.get_xyzt_units()[0],
        "millimeterEvidence": evidence,
    }


def inspect_annotation(path, image, foreground, evidence):
    if foreground not in (1, 255):
        raise ValueError("Codificación de máscara debe declarar 1 o 255")
    label = nib.load(path)
    geometry_matches(label, image, evidence)
    values = np.asanyarray(label.dataobj)
    if not np.isfinite(values).all() or not np.isin(values, [0, foreground]).all():
        raise ValueError("Máscara contradice su codificación; no umbralizar silenciosamente")
    count = int(np.count_nonzero(values == foreground))
    if not count:
        raise ValueError("Máscara vacía")
    return {"sha256": file_hash(path), "foregroundValue": foreground,
            "occupiedVoxels": count, "gridMatchesImage": True}


def audit(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    spec = json.loads(manifest_path.read_text())
    if spec.get("schemaVersion") != 1 or spec.get("dataset") != "TRUSTED":
        raise ValueError("Manifiesto TRUSTED versión 1 requerido")
    patient, side = spec["patientId"], spec["side"]
    if not isinstance(patient, str) or not re.fullmatch(r"[0-9]+", patient) or side not in ("L", "R"):
        raise ValueError("Identidad o lado inválido")
    if spec.get("role") not in ("development", "held-out"):
        raise ValueError("Separar desarrollo y evaluación reservada")
    if not spec.get("source") or not spec.get("accessEvidence"):
        raise ValueError("Procedencia y contexto de acceso explícitos requeridos")
    results = {}
    for modality in ("ct", "us"):
        item = spec[modality]
        if item.get("patientId") != patient or (modality == "us" and item.get("side") != side):
            raise ValueError("Pareja mezcla paciente o lado")
        path = verified_file(manifest_path.parent, item)
        expected = patient + (side if modality == "us" else "") + "_img" + modality.upper() + ".nii.gz"
        if path.name != expected:
            raise ValueError("Nombre TRUSTED contradice paciente/lado: " + path.name)
        evidence = item.get("millimeterEvidence")
        image, info = inspect_volume(path, evidence)
        annotations = {}
        for name, annotation in item.get("annotations", {}).items():
            if name not in ("annotator1", "annotator2", "consensus"):
                raise ValueError("Anotador desconocido")
            annotations[name] = inspect_annotation(
                verified_file(manifest_path.parent, annotation), image,
                annotation["foregroundValue"], evidence)
        results[modality] = {**info, "annotations": annotations,
                            "annotationScope": "both-kidneys" if modality == "ct" else side,
                            "annotationStatus": "complete" if len(annotations) == 3 else "incomplete"}
    return {"schemaVersion": 1, "manifestSha256": file_hash(manifest_path),
            "dataset": "TRUSTED", "patientId": patient, "side": side, "role": spec["role"],
            "source": spec["source"], "accessEvidence": spec["accessEvidence"],
            "pair": results, "samePatientDeclaredAndFilenamesChecked": True,
            "registered": False, "clinicalAcceptance": False, "runtimeInstalled": False,
            "limitations": ["Identidad proviene del manifiesto y nombres del dataset, no de datos DICOM identificatorios.",
                            "Las coordenadas de las dos adquisiciones no son intercambiables.",
                            "Un caso sin lesión declarada no certifica anatomía normal.",
                            "Los gráficos del equipo dentro del US deben excluirse de métricas acústicas."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Conservar evidencia previa: elegir salida nueva")
    result = audit(args.manifest)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"patient": result["patientId"], "side": result["side"],
                      "registered": False, "clinicalAcceptance": False}))


if __name__ == "__main__":
    main()
