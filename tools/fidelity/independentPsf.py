"""Offline PyMUST RF -> IQ -> DAS reference; never imported by the application.

Requires the separately pinned reference environment. Produces a synthetic
reference, not scanner calibration or human/clinical evidence. The reference
uses a generic central convex subaperture; the element discretization, uniform
receive apodization and pulse are explicit differences from VExUS's reduced PSF.
Sources: https://github.com/creatis-ULTIM/PyMUST (LGPL-2.1),
https://doi.org/10.1016/j.cmpb.2022.106726.
"""

import argparse
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import time

# Set before loading BLAS/PyMUST; this reference never starts a worker pool.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np
import pymust


PROTOCOL = "convex-c35-pymust-point-v2"
PFIELD_SHA256 = "a999ae8ffa4934968ea01e8ab57136aadad6beafc4ceaddf48edd031e2c33576"
CASES = {
    "near": (60.0, 90.0),
    "focal": (90.0, 90.0),
    "deep": (150.0, 90.0),
    "focus75": (90.0, 75.0),
    "focus120": (90.0, 120.0),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def registered_field_model(package):
    # PyMUST 0.1.9 selects its 2-D model for an explicit all-zero Y array.
    # Height/focus are supplied parameters, but that branch does not apply them.
    if digest(package / "pfield.py") != PFIELD_SHA256:
        raise ValueError("Protocol v2 requires the registered unmodified pfield source; a different field model needs a new protocol")
    return {"dimensionality": 2, "elevationFocusing": False, "sourcePlaneYMm": 0}


def dump(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def acquire(depth_mm, focus_mm, spacing_scale):
    # The 65 element centres span a 26 mm chord on a 60 mm radius. This is
    # the active subaperture, NOT the complete physical footprint of the probe.
    p = pymust.utils.Param()
    p.fc = 3.5e6
    p.fs = 8 * p.fc
    p.c = 1540.0
    p.radius = 0.060
    p.Nelements = 65
    half_angle = np.arcsin(0.026 / (2 * p.radius))
    p.pitch = 2 * p.radius * np.sin(half_angle / (p.Nelements - 1))
    p.width = 0.9 * p.pitch
    p.height = 0.013
    p.focus = 0.080
    p.bandwidth = 45.0
    p.TXnow = 1.0
    p.attenuation = 0.601
    p.baffle = "soft"
    p.fnumber = 2.5
    p.TXapodization = np.hanning(p.Nelements).reshape((1, -1))
    xe, ze, normals, _ = p.getElementPositions()
    apex = float(np.max(ze))
    target_z = apex + depth_mm / 1000
    delays = pymust.txdelay(0.0, apex + focus_mm / 1000, p)
    options = pymust.utils.Options()
    options.ParPool = False
    options.FullFrequencyDirectivity = True
    options.FrequencyStep = 1.0
    options.dBThresh = -100.0
    source_x = np.array([0.0])
    # Under this registered engine this selects 2-D, not a focused 3-D Y=0 slice.
    source_y = np.array([0.0])
    source_z = np.array([target_z])
    rf, rf_spectrum = pymust.simus(source_x, source_y, source_z, np.array([1.0]), delays, p, options)
    # Explicit carrier, no carrier estimated from the observed signal.
    iq = pymust.rf2iq(rf, p.fs, p.fc)
    lateral_mm = np.linspace(-8, 8, int(80 / spacing_scale) + 1)
    axial_mm = np.linspace(-3, 3, int(600 / spacing_scale) + 1)
    matrix = pymust.dasmtx(iq, np.zeros_like(axial_mm), target_z + axial_mm / 1000, delays, p)
    axial_iq = matrix @ iq.flatten(order="F")
    lateral_iq = np.empty(lateral_mm.size, dtype=complex)
    control_iq = np.empty(lateral_mm.size, dtype=complex)
    originals = dict(rf=rf, rfSpectrum=rf_spectrum, iq=iq, axialBeamformed=axial_iq,
                     lateralMm=lateral_mm, axialMm=axial_mm, delaysS=delays)
    matrix_cache = {}
    for index, offset in enumerate(lateral_mm):
        if offset == 0:
            offset_rf, offset_iq = rf, iq
        else:
            offset_rf, _ = pymust.simus(np.array([offset / 1000]), source_y, source_z,
                                        np.array([1.0]), delays, p, options)
            offset_iq = pymust.rf2iq(offset_rf, p.fs, p.fc)
        # Same RF/IQ feeds both receive policies. Keep each original RF.
        originals[f"lateralRf{index:03d}"] = offset_rf
        for fnumber, result in ((2.5, lateral_iq), (0.0, control_iq)):
            key = (offset_iq.shape, fnumber)
            if key not in matrix_cache:
                receiver = p.copy()
                receiver.fnumber = fnumber
                matrix_cache[key] = pymust.dasmtx(offset_iq, np.array([0.0]),
                                                 np.array([target_z]), delays, receiver)
            result[index] = (matrix_cache[key] @ offset_iq.flatten(order="F"))[0]
    originals["lateralBeamformed"] = lateral_iq
    originals["fullReceiveBeamformed"] = control_iq
    if not all(np.all(np.isfinite(v)) for v in (rf, iq, axial_iq, lateral_iq, control_iq)) or not np.max(np.abs(lateral_iq)) > 0:
        raise ValueError("Non-finite or empty independent acquisition")
    profiles = {
        "lateral": {"positionMm": lateral_mm.tolist(), "envelope": np.abs(lateral_iq).tolist()},
        "axial": {"positionMm": axial_mm.tolist(), "envelope": np.abs(axial_iq).tolist()},
    }
    control = {"rxFNumber": 0, "chordMm": 26,
               "scope": "Same RF and IQ; full receive aperture instead of element-normal F-number mask",
               "lateral": {"positionMm": lateral_mm.tolist(), "envelope": np.abs(control_iq).tolist()}}
    distances = np.hypot(-xe, target_z - ze)
    admitted = np.abs(np.arcsin(-xe / distances) - normals) <= np.arctan(1 / (2 * p.fnumber))
    accepted_x = xe[admitted]
    aperture = {"elementCountAtTarget": int(np.count_nonzero(admitted)),
                "chordAtTargetMm": float(np.ptp(accepted_x) * 1000),
                "criterion": "PyMUST F-number relative to each convex element normal"}
    return profiles, originals, apex, aperture, control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="New output directory outside checkout")
    parser.add_argument("--runtime-manifest", type=Path, required=True)
    parser.add_argument("--cases", default="all", help="all, or comma-separated registered case IDs")
    parser.add_argument("--spacing-scale", type=float, choices=(1.0, 0.5), default=1.0,
                        help="0.5 repeats acquisition with twice the profile sampling density")
    args = parser.parse_args()
    checkout = Path(__file__).resolve().parents[2]
    out = args.out.resolve()
    if out.is_relative_to(checkout):
        parser.error("Raw evidence must be outside the checkout")
    ids = list(CASES) if args.cases == "all" else args.cases.split(",")
    if not ids or len(ids) != len(set(ids)) or any(i not in CASES for i in ids):
        parser.error("Unknown or duplicate case IDs")
    if metadata.version("PyMUST") != "0.1.9":
        parser.error("This protocol requires PyMUST 0.1.9")
    runtime = args.runtime_manifest.resolve()
    wheels = json.loads(runtime.read_text())
    for wheel in wheels:
        if metadata.version(wheel["name"]) != wheel["version"]:
            parser.error("Installed reference dependency differs from wheel manifest")
        actual = runtime.parent / "wheels" / wheel["wheel"]
        if digest(actual) != wheel["sha256"]:
            parser.error("Reference wheel hash differs")
    package = Path(pymust.__file__).parent
    field_model = registered_field_model(package)
    out.mkdir(parents=False, exist_ok=False)
    started = time.perf_counter()
    report = {
        "schemaVersion": 1, "protocolId": PROTOCOL, "origin": "synthetic", "role": "development",
        "lateralMethod": "source-offset-fixed-transmit-and-receive-at-nominal-depth",
        "fieldModel": field_model,
        "engine": {"name": "PyMUST", "version": "0.1.9",
                   "licenseFile": "LGPL-2.1", "licenseMetadata": "LGPL-3.0",
                   "licenseNote": "Upstream wheel LICENSE and METADATA disagree; originals preserved, no upstream code bundled into the application.",
                   "source": "https://github.com/creatis-ULTIM/PyMUST",
                   "runtimeManifestSha256": digest(runtime),
                   "packages": {w["name"]: w["version"] for w in wheels}},
        "generatorSha256": digest(Path(__file__).resolve()),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "parameters": {"frequencyMHz": 3.5, "samplingFrequencyMHz": 28,
                       "soundSpeedMS": 1540, "attenuationDbCmMHz": 0.601,
                       "pulseEchoBandwidthPercent": 45, "curvatureRadiusMm": 60,
                       "activeChordMm": 26, "elements": 65, "elementFillFraction": 0.9,
                       "elevationHeightMm": 13, "elevationFocusMm": 80,
                       "txApodization": "Hann", "rxApodization": "uniform",
                       "rxFNumber": 2.5, "txCycles": 1,
                       "spacingScale": args.spacing_scale},
        "comparability": [
            "Independent synthetic calculation; not measured scanner calibration or clinical validation.",
            "Central convex subaperture with estimated element count/fill; no commercial probe is claimed.",
            "PyMUST uses uniform receive aperture; production uses an equivalent k=1.3 receive width.",
            "PyMUST limits reception by angle to each convex element normal; production uses depth/F-number chord. Effective aperture is reported per target.",
            "PyMUST simulates its specified pulse/bandpass and DAS; production uses a reduced Gaussian PSF.",
            "The all-zero Y input selects PyMUST's 2-D field: supplied elevation height/focus are inactive; no elevation or slice-thickness validation.",
            "Only point-target profiles in the central elevation plane; no heterogeneous medium or speckle validation.",
        ],
        "cases": [],
    }
    dump(out / "engine-source-hashes.json", {
        str(p.relative_to(package)): digest(p) for p in sorted(package.rglob("*.py"))
    })
    report["engineSourceHashesSha256"] = digest(out / "engine-source-hashes.json")
    try:
        for case_id in ids:
            depth, focus = CASES[case_id]
            profiles, originals, apex, aperture, control = acquire(depth, focus, args.spacing_scale)
            original = out / f"{case_id}.npz"
            np.savez_compressed(original, **originals)
            report["cases"].append({"id": case_id, "depthMm": depth, "focusMm": focus,
                                    "apexAboveChordMm": apex * 1000,
                                    "receiveAperture": aperture,
                                    "fullReceiveControl": control,
                                    "raw": {"path": original.name, "sha256": digest(original)},
                                    "profiles": profiles})
            print(f"Acquired {case_id}: depth={depth:g} mm, focus={focus:g} mm", flush=True)
        report["elapsedSeconds"] = time.perf_counter() - started
        dump(out / "reference.json", report)
    except Exception as exc:
        dump(out / "failed.json", {"error": repr(exc), "partial": report})
        raise


if __name__ == "__main__":
    main()
