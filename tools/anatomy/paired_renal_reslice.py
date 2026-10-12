"""Corte de TAC en el plano físico de una adquisición US, con soporte explícito.

Una inicialización rígida no demuestra que las estructuras coincidan. Este visor
conserva esa incertidumbre; no convierte intensidades TAC en ecografía sintética.
"""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy.ndimage import map_coordinates

from paired_renal_reference import file_hash, verified_file


def rigid_matrix(value):
    matrix = np.asarray(value, dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise ValueError("Transformación 4×4 finita requerida")
    rotation = matrix[:3, :3]
    if (not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-8, rtol=0)
            or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-8, rtol=0)
            or not np.isclose(np.linalg.det(rotation), 1, atol=1e-8, rtol=0)):
        raise ValueError("Registro debe conservar escala, orientación y forma")
    return matrix


def plane_spacing(affine, axes):
    """La figura rectangular no puede representar una rejilla US con cizalla."""
    basis = np.asarray(affine)[:3, axes]
    spacing = np.linalg.norm(basis, axis=0)
    if not np.isfinite(basis).all() or np.any(spacing <= 0):
        raise ValueError("Base física del plano inválida")
    # Tolerancia al redondeo float32 del NIfTI; no precisión anatómica.
    cosine = np.dot(basis[:, 0], basis[:, 1]) / np.prod(spacing)
    if abs(cosine) > 1e-6:
        raise ValueError("Plano US no ortogonal: no dibujar cizalla como píxeles rectangulares")
    return spacing


def reslice(ct, ct_affine, us_shape, us_affine, transform, axis, index):
    """Devuelve los otros dos ejes US en su orden nativo; centros de voxel, sin resize."""
    if len(ct.shape) != 3 or len(us_shape) != 3 or axis not in (0, 1, 2):
        raise ValueError("Volúmenes 3D y eje 0/1/2 requeridos")
    if not isinstance(index, int) or index < 0 or index >= us_shape[axis]:
        raise ValueError("Índice US fuera del volumen")
    transform = rigid_matrix(transform)
    others = [i for i in range(3) if i != axis]
    shape = [us_shape[i] for i in others]
    grid = np.indices(shape, dtype=float)
    points = np.zeros((*shape, 3)); points[..., axis] = index
    for i, other in enumerate(others): points[..., other] = grid[i]
    mapping = np.linalg.inv(ct_affine) @ transform @ us_affine
    ct_points = nib.affines.apply_affine(mapping, points)
    valid = np.all((ct_points >= 0) & (ct_points <= np.array(ct.shape)-1), axis=-1)
    # Cast antes del muestreo: scipy conserva dtype de entrada por defecto y redondearía HU.
    sampled = map_coordinates(ct, np.moveaxis(ct_points, -1, 0), output=np.float32,
                              order=1, mode="constant", cval=np.nan, prefilter=False)
    sampled[~valid] = np.nan
    return sampled, valid, others


def review(manifest_path):
    path = Path(manifest_path).resolve(); spec = json.loads(path.read_text())
    if spec.get("schemaVersion") != 1: raise ValueError("Manifiesto versión 1 requerido")
    admission_path = verified_file(path.parent, spec["admission"])
    registration_path = verified_file(path.parent, spec["registration"])
    source_path = verified_file(path.parent, spec["sourceManifest"])
    admission = json.loads(admission_path.read_text())
    registration = json.loads(registration_path.read_text())
    source = json.loads(source_path.read_text())
    if (registration.get("admissionSha256") != spec["admission"]["sha256"]
            or admission.get("manifestSha256") != spec["sourceManifest"]["sha256"]):
        raise ValueError("Registro, admisión y fuente no pertenecen a la misma cadena")
    if registration.get("status") != "rigid-initialization-only":
        raise ValueError("Inicialización rígida explícita requerida")
    for key in ["patientId", "side", "role"]:
        if admission[key] != registration[key] or admission[key] != source[key]:
            raise ValueError("Identidad o rol contradictorio")
    images = {}
    for modality in ["ct", "us"]:
        if source[modality]["sha256"] != admission["pair"][modality]["sha256"]:
            raise ValueError("Imagen distinta de la admitida")
        image_path = verified_file(source_path.parent, source[modality])
        images[modality] = nib.load(image_path)
    ct, us = images["ct"], images["us"]
    axis, index = spec["axis"], spec["index"]
    if axis not in (0, 1, 2): raise ValueError("Eje US 0/1/2 requerido")
    spacing = plane_spacing(us.affine, [i for i in range(3) if i != axis])
    ct_slice, valid, others = reslice(np.asanyarray(ct.dataobj), ct.affine, us.shape, us.affine,
                                    registration["usWorldToCtWorldMm"], axis, index)
    selection = [slice(None)]*3; selection[axis] = index
    us_slice = np.asarray(us.dataobj[tuple(selection)])
    metadata = {"schemaVersion": 1, "manifestSha256": file_hash(path),
                "admissionSha256": spec["admission"]["sha256"],
                "registrationSha256": spec["registration"]["sha256"],
                "patientId": admission["patientId"], "side": admission["side"], "role": admission["role"],
                "usAxis": axis, "usIndex": index, "inPlaneUsAxes": others,
                "pixelSpacingMm": spacing.tolist(), "ctValidFraction": float(valid.mean()),
                "toolSha256": file_hash(Path(__file__)),
                "usVoxelToWorldMm": us.affine.tolist(), "ctVoxelToWorldMm": ct.affine.tolist(),
                "usWorldToCtWorldMm": registration["usWorldToCtWorldMm"],
                "ctInterpolationOrder": 1, "usResampled": False,
                "imageSha256": {m: admission["pair"][m]["sha256"] for m in ["ct", "us"]},
                "pelvisTreMm": registration["pelvisTreMm"], "evaluationRmsMm": registration["evaluationRmsMm"],
                "registeredPlaneMeaning": "Plano según inicialización rígida; correspondencia anatómica aún por revisar",
                "clinicalAcceptance": False, "runtimeInstalled": False,
                "limits": ["Fuera de soporte TAC = NaN; no tejido oscuro.",
                           "El US contiene rótulos del equipo: no usar esta salida sin máscara para métricas acústicas.",
                           "Los ejes US pertenecen a la adquisición, no se nombran axial/coronal/sagital del paciente.",
                           "Interpolación lineal del TAC; la imagen US conserva muestras originales."]}
    return us_slice, ct_slice, valid, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="Carpeta nueva: arrays .npz y procedencia .json")
    args = parser.parse_args()
    if args.output.exists(): raise ValueError("Conservar evidencia: carpeta de salida debe ser nueva")
    us, ct, valid, metadata = review(args.manifest)
    args.output.mkdir(parents=True)
    np.savez_compressed(args.output/"plane.npz", ultrasound=us, ct=ct, ct_valid=valid)
    (args.output/"plane.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({k: metadata[k] for k in ["ctValidFraction", "pelvisTreMm", "clinicalAcceptance"]}))


if __name__ == "__main__": main()
