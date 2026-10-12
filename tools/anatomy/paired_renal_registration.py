"""Inicialización rígida US→TAC con error en hitos no usados para ajustar.

El piloto conserva escala y forma: no deforma el riñón para mejorar una captura.
No constituye aceptación clínica ni reproduce la inicialización de similitud del paper.
"""
import argparse
import json
import re
from pathlib import Path

import nibabel as nib
import numpy as np

from paired_renal_reference import file_hash, verified_file


FIT_IDS = (3, 4, 5)  # IDs 1-based del paper; la pelvis (#1) queda reservada.


def landmarks(values):
    points = np.asarray(values, dtype=float)
    if points.shape != (7, 3) or not np.isfinite(points).all():
        raise ValueError("Se requieren siete hitos 3D finitos y ordenados")
    return points


def rigid_initialization(us, ct):
    us, ct = landmarks(us), landmarks(ct)
    ix = np.array(FIT_IDS) - 1
    a, b = us[ix], ct[ix]
    ca, cb = a.mean(axis=0), b.mean(axis=0)
    a, b = a-ca, b-cb
    for points in (a, b):
        sv = np.linalg.svd(points, compute_uv=False)
        # Condición numérica, no precisión anatómica; tres puntos deben formar triángulo.
        if sv[0] <= 0 or sv[1] / sv[0] < 1e-6:
            raise ValueError("Hitos de ajuste colineales o degenerados")
    u, _, vh = np.linalg.svd(a.T @ b)
    proper = np.eye(3); proper[2, 2] = np.linalg.det(vh.T @ u.T)
    rotation = vh.T @ proper @ u.T
    transform = np.eye(4); transform[:3, :3] = rotation
    transform[:3, 3] = cb - rotation @ ca
    moved = nib.affines.apply_affine(transform, us)
    errors = np.linalg.norm(moved-ct, axis=1)
    reserved = [i for i in range(7) if i not in ix]
    return {
        "usWorldToCtWorldMm": transform.tolist(), "ctWorldToUsWorldMm": np.linalg.inv(transform).tolist(),
        "fitLandmarkIds": list(FIT_IDS), "evaluationLandmarkIds": [i+1 for i in reserved],
        "fitRmsMm": float(np.sqrt(np.mean(errors[ix]**2))),
        "evaluationRmsMm": float(np.sqrt(np.mean(errors[reserved]**2))),
        "pelvisTreMm": float(errors[0]), "landmarkErrorsMm": errors.tolist(),
        "scale": 1, "rotationDeterminant": float(np.linalg.det(rotation)),
        "status": "rigid-initialization-only", "clinicalAcceptance": False,
        "limits": ["Error del ajuste no es error independiente.",
                   "Hitos no usados para ajustar pertenecen a los mismos anotadores; no son panel externo.",
                   "Respiración, presión y postura pueden impedir un registro rígido fiel.",
                   "El paper inicializa con similitud; este piloto fija escala para no esconder errores de tamaño."]}


def audit(manifest_path):
    path = Path(manifest_path).resolve(); spec = json.loads(path.read_text())
    if spec.get("schemaVersion") != 1:
        raise ValueError("Manifiesto de registro versión 1 requerido")
    admission_path = verified_file(path.parent, spec["admission"])
    admitted = json.loads(admission_path.read_text())
    if admitted.get("schemaVersion") != 1 or admitted.get("dataset") != "TRUSTED":
        raise ValueError("Admisión TRUSTED requerida")
    if not admitted.get("samePatientDeclaredAndFilenamesChecked"):
        raise ValueError("Identidad de la pareja no verificada")
    points, sources = {}, {}
    for modality in ("ct", "us"):
        entry = spec[modality]; image = admitted["pair"][modality]
        if entry.get("patientId") != admitted["patientId"] or entry.get("side") != admitted["side"]:
            raise ValueError("Hitos de paciente/lado diferente")
        if entry.get("frame") != "image-world-RAS-mm" or entry.get("imageSha256") != image["sha256"]:
            raise ValueError("Marco de hitos sin vinculación a la imagen admitida")
        source = verified_file(path.parent, entry)
        # TRUSTED 1/2 identifica al anotador, no una adquisición distinta:
        # IRCAD/trusted_code_nsd, dataprocessing/estimate_gtldks.py.
        # La imagen admitida conserva su propio hash, obligatorio arriba.
        expected = re.escape(admitted["patientId"] + admitted["side"]) + r"[12]?_ldk" + modality.upper() + r"\.txt"
        if not re.fullmatch(expected, source.name):
            raise ValueError("Nombre de hitos contradice paciente/lado/modalidad")
        points[modality] = landmarks(np.loadtxt(source))
        affine = np.asarray(image["voxelToWorldMm"])
        voxels = nib.affines.apply_affine(np.linalg.inv(affine), points[modality])
        if np.any(voxels < -.5) or np.any(voxels >= np.asarray(image["shape"])-.5):
            raise ValueError("Hitos fuera del volumen; revisar marco y unidades")
        sources[modality] = {"landmarksSha256": entry["sha256"], "imageSha256": image["sha256"],
                             "frame": entry["frame"], "voxelCoordinates": voxels.tolist()}
    return {"schemaVersion": 1, "manifestSha256": file_hash(path),
            "admissionSha256": spec["admission"]["sha256"], "patientId": admitted["patientId"],
            "side": admitted["side"], "role": admitted["role"], "sources": sources,
            **rigid_initialization(points["us"], points["ct"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists(): raise ValueError("Conservar evidencia previa: elegir salida nueva")
    result = audit(args.manifest)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({k: result[k] for k in ["status", "fitRmsMm", "pelvisTreMm", "evaluationRmsMm"]}))


if __name__ == "__main__": main()
