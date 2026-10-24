"""Verify saved point profiles against original PyMUST beamformed arrays.

Uses NumPy only. Does not rerun the physical calculation or authenticate origin.
Run: python independentPsfVerify.py /outside/checkout/reference.json
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np


def verify(reference_path):
    reference_path = Path(reference_path).resolve(strict=True)
    root = reference_path.parent
    report = json.loads(reference_path.read_text())
    if report["protocolId"] != "convex-c35-pymust-point-v2":
        raise ValueError("Unsupported point-reference protocol")
    verified = []
    for case in report["cases"]:
        relative = Path(case["raw"]["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe original path")
        raw = (root / relative).resolve(strict=True)
        if not raw.is_relative_to(root) or not raw.is_file() or raw.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("Invalid original")
        if hashlib.sha256(raw.read_bytes()).hexdigest() != case["raw"]["sha256"]:
            raise ValueError("Original hash differs")
        with np.load(raw, allow_pickle=False) as arrays:
            lateral = arrays["lateralMm"]
            axial = arrays["axialMm"]
            lateral_iq = arrays["lateralBeamformed"]
            axial_iq = arrays["axialBeamformed"]
            control_iq = arrays["fullReceiveBeamformed"]
            if any(a.ndim != 1 for a in (lateral_iq, axial_iq, control_iq)) or lateral_iq.size != lateral.size or axial_iq.size != axial.size or control_iq.size != lateral.size:
                raise ValueError("Original profile dimensions differ")
            expected = {"lateral": (lateral, np.abs(lateral_iq)),
                        "axial": (axial, np.abs(axial_iq))}
            for axis, (positions, envelope) in expected.items():
                stated = case["profiles"][axis]
                if not np.array_equal(positions, stated["positionMm"]) or not np.array_equal(envelope, stated["envelope"]):
                    raise ValueError(f"Profile differs from original IQ: {case['id']}/{axis}")
            control = case["fullReceiveControl"]["lateral"]
            if not np.array_equal(lateral, control["positionMm"]) or not np.array_equal(np.abs(control_iq), control["envelope"]):
                raise ValueError("Full-aperture control differs from original IQ")
            for index in range(lateral.size):
                rf = arrays[f"lateralRf{index:03d}"]
                if rf.ndim != 2 or rf.shape[1] != 65 or not np.all(np.isfinite(rf)):
                    raise ValueError("Missing or invalid original lateral RF")
        verified.append({"id": case["id"], "rawSha256": case["raw"]["sha256"]})
    return {"protocolId": "convex-c35-pymust-raw-verification-v2",
            "referenceSha256": hashlib.sha256(reference_path.read_bytes()).hexdigest(),
            "verifiedCases": verified,
            "scope": "raw-array/profile consistency, not authentication or calibration"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: independentPsfVerify.py reference.json")
    print(json.dumps(verify(sys.argv[1]), indent=2))
