"""Optional offline PyMUST elevation reference; synthetic development evidence only.

Uses an explicitly zero-reflectivity off-plane point to select the intact 3-D
engine at Y=0. No engine patches or app dependencies. See independent-elevation.md.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import sys
import time

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np
import pymust

PROTOCOL = "convex-c35-pymust-elevation-v1"
PFIELD_SHA256 = "a999ae8ffa4934968ea01e8ab57136aadad6beafc4ceaddf48edd031e2c33576"
SIMUS_SHA256 = "17f30a1d1677f8289c814d10afe4f57cc75964a80db692cb603c6260c8fe5fe0"
DAS_SHA256 = "7da9ffcabcc0efd488870bb4bf70e6a5f25268ec77fefde7ef235bb7b7f2748a"
CASES = {"near": (60, .5, 1), "focal": (80, .5, 1), "deep": (150, .5, 1),
         "focal-spacing": (80, .25, 1), "focal-frequency": (80, .5, .5)}
CONTROLS = {
    "zero-2d": {"y_mm": 0, "sentinel": None}, "zero-3d": {"y_mm": 0},
    "offplane-alone": {"y_mm": .5, "sentinel": None}, "offplane-sentinel": {"y_mm": .5},
    "sentinel-far": {"y_mm": 0, "sentinel": .001},
    "limit-plus1": {"y_mm": .001, "sentinel": None}, "limit-minus1": {"y_mm": -.001, "sentinel": None},
    "limit-plus2": {"y_mm": .002, "sentinel": None}, "limit-minus2": {"y_mm": -.002, "sentinel": None},
    "focus50-2d": {"y_mm": 0, "focus": 50, "sentinel": None}, "focus50-3d": {"y_mm": 0, "focus": 50},
    "height6-2d": {"y_mm": 0, "height": 6.5, "sentinel": None}, "height6-3d": {"y_mm": 0, "height": 6.5},
}
PARAMETERS = {"frequencyMHz": 3.5, "samplingFrequencyMHz": 28, "soundSpeedMS": 1540,
              "attenuationDbCmMHz": .601, "pulseEchoBandwidthPercent": 45,
              "curvatureRadiusMm": 60, "activeChordMm": 26, "elements": 65,
              "elementFillFraction": .9, "elevationHeightMm": 13, "elevationFocusMm": 80,
              "lateralTxFocusMm": 90, "rxFNumber": 2.5, "txCycles": 1,
              "txApodization": "Hann", "rxApodization": "uniform", "sentinelYMm": .001,
              "sentinelReflectivity": 0, "parallel": False}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def array_digest(value):
    return hashlib.sha256(np.ascontiguousarray(value).tobytes()).hexdigest()


def dump(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def engine_sources():
    package = Path(pymust.__file__).parent
    expected = {"pfield.py": PFIELD_SHA256, "simus.py": SIMUS_SHA256, "dasmtx.py": DAS_SHA256}
    if metadata.version("PyMUST") != "0.1.9" or any(digest(package / p) != s for p, s in expected.items()):
        raise ValueError("Unregistered or modified PyMUST engine")
    return expected


def setup(depth=80, height=13, focus=80, frequency_step=1):
    p = pymust.utils.Param()
    p.fc = 3.5e6
    p.fs = 8 * p.fc
    p.c = 1540.
    p.radius = .060
    p.Nelements = 65
    half = np.arcsin(.026 / (2 * p.radius))
    p.pitch = 2 * p.radius * np.sin(half / (p.Nelements - 1))
    p.width = .9 * p.pitch
    p.height = height / 1000
    p.focus = focus / 1000
    p.bandwidth = 45.
    p.TXnow = 1.
    p.attenuation = .601
    p.baffle = "soft"
    p.fnumber = 2.5
    p.TXapodization = np.hanning(p.Nelements).reshape((1, -1))
    _, ze, _, _ = p.getElementPositions()
    apex = float(np.max(ze))
    delays = pymust.txdelay(0., apex + .090, p)
    options = pymust.utils.Options()
    options.ParPool = False
    options.FullFrequencyDirectivity = True
    options.FrequencyStep = frequency_step
    options.dBThresh = -100.
    return p, options, delays, apex + depth / 1000


def acquire(y_mm, depth=80, height=13, focus=80, sentinel=1e-6, frequency_step=1):
    p, options, delays, z = setup(depth, height, focus, frequency_step)
    ys = np.array([y_mm / 1000] if sentinel is None else [y_mm / 1000, sentinel])
    rc = np.array([1.] if sentinel is None else [1., 0.])
    trace = []
    pfield_path = (Path(pymust.__file__).parent / "pfield.py").resolve()

    def profile(frame, event, _arg):
        if event == "return" and frame.f_code.co_name == "pfield" and Path(frame.f_code.co_filename).resolve() == pfield_path:
            local = frame.f_locals
            frequencies = local["f"]
            trace.append({"elevationFocusing": bool(local["ElevationFocusing"]),
                          "isSIMUS": bool(local["isSIMUS"]), "points": int(local["y"].size),
                          "frequencyHash": array_digest(frequencies), "frequencyCount": int(frequencies.size),
                          "frequencyFirstHz": float(frequencies[0]), "frequencyLastHz": float(frequencies[-1])})

    previous = sys.getprofile()
    sys.setprofile(profile)
    try:
        rf, spectrum = pymust.simus(np.zeros(ys.size), ys, np.full(ys.size, z), rc, delays, p, options)
    finally:
        sys.setprofile(previous)
    iq = pymust.rf2iq(rf, p.fs, p.fc)
    matrix = pymust.dasmtx(iq, np.array([0.]), np.array([z]), delays, p)
    formed = np.asarray(matrix @ iq.flatten(order="F"))
    arrays = {"rf": rf, "spectrum": spectrum, "iq": iq, "beamformed": formed, "delaysS": delays}
    if len(trace) != 1 or not all(np.isfinite(a).all() for a in arrays.values()) or not np.max(np.abs(rf)) > 0:
        raise ValueError("Missing branch witness or invalid acquisition")
    return arrays, trace[0]


def relative(a, b):
    if a.shape != b.shape or not np.isfinite(a).all() or not np.isfinite(b).all() or not np.linalg.norm(a) > 0:
        raise ValueError("Nonfinite, empty or incompatible comparison")
    return float(np.linalg.norm(a - b) / np.linalg.norm(a))


def verify_spectrum(rf, spectrum):
    if (rf.ndim != 2 or spectrum.ndim != 2 or spectrum.shape[1] != 65 or spectrum.shape[0] < 2
            or not np.isrealobj(rf) or not np.isfinite(rf).all() or not np.isfinite(spectrum).all()):
        raise ValueError("Invalid RF or spectrum")
    # Registered SIMUS pads to fs/(2*fc)*(Nf-1), conjugates and retains half the IFFT.
    length = 4 * (spectrum.shape[0] - 1)
    reconstructed = np.fft.irfft(np.conj(spectrum), length, axis=0)[:(length + 1) // 2]
    peak = np.max(np.abs(reconstructed))
    # SIMUS suppresses tiny samples around 1e-5 of peak; at >=2e-5 its rounded
    # taper is exactly one. Bound that suppression plus floating-point rounding,
    # rather than requiring equality to an RF before the registered taper.
    tolerance = (2e-5 + 4 * np.finfo(reconstructed.dtype).eps) * peak
    if rf.shape != reconstructed.shape or not peak > 0 or np.max(np.abs(rf - reconstructed)) > tolerance:
        raise ValueError("RF differs from original spectrum reconstruction")


def control_errors(raw, records):
    if set(raw) != set(CONTROLS) or set(records) != set(CONTROLS):
        raise ValueError("Control inventory differs")
    for key, row in records.items():
        verify_spectrum(raw[key]["rf"], raw[key]["spectrum"])
        t = row["trace"]
        if row["parameters"] != CONTROLS[key] or not t["isSIMUS"] or t["elevationFocusing"] != (not key.endswith("2d")):
            raise ValueError("Control branch or parameters differ")
    pairs = {"sentinelOffplane": ("offplane-alone", "offplane-sentinel"),
             "sentinelLocation": ("zero-3d", "sentinel-far"),
             "focus2d": ("zero-2d", "focus50-2d"), "focus3d": ("zero-3d", "focus50-3d"),
             "height2d": ("zero-2d", "height6-2d"), "height3d": ("zero-3d", "height6-3d")}
    pairs.update({k: ("zero-3d", k) for k in CONTROLS if k.startswith("limit-")})
    errors = {}
    for key, (a, b) in pairs.items():
        ta, tb = records[a]["trace"], records[b]["trace"]
        if any(ta[field] != tb[field] for field in ("frequencyHash", "frequencyCount", "frequencyFirstHz", "frequencyLastHz")):
            raise ValueError("Frequency sampling changed between paired controls")
        errors[key] = {field: relative(raw[a][field], raw[b][field]) for field in ("rf", "spectrum")}
        values = errors[key].values()
        if key in ("focus3d", "height3d"):
            passed = min(values) > 1e-3
        else:
            passed = max(values) <= (1e-4 if key.startswith("limit-") else 1e-6)
        if not passed:
            raise ValueError(f"Control failed: {key}: {errors[key]}")
    return errors


def measure(position, envelope):
    if len(position) != len(envelope) or len(position) < 5 or not np.all(np.diff(position) > 0):
        raise ValueError("Invalid profile coordinates")
    if not np.isfinite(envelope).all() or np.min(envelope) < 0 or np.max(envelope) <= 0:
        raise ValueError("Invalid profile amplitude")
    peak = int(np.argmax(envelope))
    half = envelope[peak] / 2
    left = right = peak
    while left > 0 and envelope[left] > half:
        left -= 1
    while right < len(envelope) - 1 and envelope[right] > half:
        right += 1
    if left == peak or right == peak or envelope[left] > half or envelope[right] > half:
        raise ValueError("Central response truncated at half amplitude")
    symmetry = relative(envelope, envelope[::-1])
    if position[peak] != 0 or symmetry > 1e-5:
        raise ValueError("Asymmetric or displaced central response")

    def cross(a, b):
        return position[a] + (half - envelope[a]) / (envelope[b] - envelope[a]) * (position[b] - position[a])

    return {"widthMm": float(cross(right, right - 1) - cross(left, left + 1)),
            "peakPositionMm": float(position[peak]), "symmetryRelativeRms": symmetry,
            "edgeFraction": float(max(envelope[0], envelope[-1]) / envelope[peak])}


def save_raw(out, name, arrays):
    path = out / (name + ".npz")
    if path.exists():
        raise ValueError("Refusing to overwrite raw acquisition")
    np.savez_compressed(path, **arrays)
    return {"path": path.name, "sha256": digest(path)}


def acquire_reference(out, runtime):
    sources = engine_sources()
    wheels = json.loads(runtime.read_text())
    for wheel in wheels:
        if metadata.version(wheel["name"]) != wheel["version"] or digest(runtime.parent / "wheels" / wheel["wheel"]) != wheel["sha256"]:
            raise ValueError("Reference dependency differs from wheel manifest")
    out.mkdir(exist_ok=False)
    started = time.perf_counter()
    report = {"schemaVersion": 1, "protocolId": PROTOCOL, "origin": "synthetic", "role": "development",
              "method": "source-elevation-offset-fixed-transmit-and-receive-at-nominal-depth",
              "fieldModel": {"dimensionality": 3, "elevationFocusing": True, "selection": "zero-reflectivity-offplane-sentinel"},
              "engine": {"name": "PyMUST", "version": "0.1.9", "sources": sources},
              "parameters": PARAMETERS, "generatorSha256": digest(Path(__file__).resolve()),
              "runtimeManifestSha256": digest(runtime), "createdAt": datetime.now(timezone.utc).isoformat(),
              "controls": {}, "cases": []}
    raw_controls = {}
    try:
        for name, parameters in CONTROLS.items():
            arrays, trace = acquire(**parameters)
            raw_controls[name] = arrays
            report["controls"][name] = {"parameters": parameters, "trace": trace, "raw": save_raw(out, name, arrays)}
        report["controlErrors"] = control_errors(raw_controls, report["controls"])
        for name, (depth, spacing, frequency) in CASES.items():
            positions = np.linspace(-12, 12, round(24 / spacing) + 1)
            formed, traces, raw = [], [], {}
            for index, offset in enumerate(positions):
                arrays, trace = acquire(float(offset), depth=depth, frequency_step=frequency)
                if not trace["elevationFocusing"] or not trace["isSIMUS"]:
                    raise ValueError("Non-3D profile sample")
                for field in ("rf", "spectrum"):
                    raw[f"{field}{index:03d}"] = arrays[field]
                formed.append(arrays["beamformed"][0])
                traces.append(trace)
            formed = np.asarray(formed)
            envelope = np.abs(formed)
            raw.update(positionMm=positions, beamformed=formed, delaysS=arrays["delaysS"])
            report["cases"].append({"id": name, "depthMm": depth, "spacingMm": spacing, "frequencyStep": frequency,
                                    "profile": {"positionMm": positions.tolist(), "envelope": envelope.tolist()},
                                    "measurement": measure(positions, envelope), "trace": traces, "raw": save_raw(out, name, raw)})
            print(f"Acquired {name}: {len(positions)} offsets", flush=True)
        focal = report["cases"][1]["measurement"]["widthMm"]
        report["convergence"] = {key: abs(report["cases"][index]["measurement"]["widthMm"] - focal) / focal
                                 for key, index in (("spacing", 3), ("frequency", 4))}
        if max(report["convergence"].values()) > .01:
            raise ValueError("Profile convergence exceeds 1%")
        report["elapsedSeconds"] = time.perf_counter() - started
        dump(out / "reference.json", report)
    except Exception as error:
        dump(out / "failed.json", {"error": repr(error), "partial": report})
        raise


def load_raw(base, descriptor):
    name = descriptor["path"]
    if not isinstance(name, str) or Path(name).name != name or not name.endswith(".npz"):
        raise ValueError("Invalid original path")
    path = (base / name).resolve(strict=True)
    if path.parent != base.resolve() or digest(path) != descriptor["sha256"]:
        raise ValueError("Original path or hash differs")
    with np.load(path, allow_pickle=False) as arrays:
        return dict(arrays)


def verify_reference(path):
    source = json.loads(path.read_text())
    if (source["schemaVersion"] != 1 or source["protocolId"] != PROTOCOL or source["origin"] != "synthetic"
            or source["role"] != "development" or source["parameters"] != PARAMETERS
            or source["method"] != "source-elevation-offset-fixed-transmit-and-receive-at-nominal-depth"
            or source["fieldModel"] != {"dimensionality": 3, "elevationFocusing": True,
                                       "selection": "zero-reflectivity-offplane-sentinel"}
            or source["engine"] != {"name": "PyMUST", "version": "0.1.9", "sources": engine_sources()}):
        raise ValueError("Reference protocol, parameters or engine differs")
    raw_controls = {key: load_raw(path.parent, row["raw"]) for key, row in source["controls"].items()}
    if control_errors(raw_controls, source["controls"]) != source["controlErrors"]:
        raise ValueError("Control results differ from originals")
    if [c["id"] for c in source["cases"]] != list(CASES):
        raise ValueError("Reference case inventory differs")
    widths, verified = {}, []
    for case in source["cases"]:
        name = case["id"]
        depth, spacing, frequency = CASES[name]
        if (case["depthMm"], case["spacingMm"], case["frequencyStep"]) != CASES[name]:
            raise ValueError("Profile geometry differs")
        raw = load_raw(path.parent, case["raw"])
        expected_positions = np.linspace(-12, 12, round(24 / spacing) + 1)
        if not np.array_equal(raw["positionMm"], expected_positions) or not np.array_equal(raw["positionMm"], case["profile"]["positionMm"]):
            raise ValueError("Profile positions differ from originals")
        if len(case["trace"]) != len(expected_positions) or not all(t["elevationFocusing"] and t["isSIMUS"] for t in case["trace"]):
            raise ValueError("Missing 3-D branch witnesses")
        formed = []
        p, _, delays, z = setup(depth, frequency_step=frequency)
        if not np.array_equal(raw["delaysS"], delays):
            raise ValueError("Transmit delays differ")
        for index in range(len(expected_positions)):
            rf = raw[f"rf{index:03d}"]
            spectrum = raw[f"spectrum{index:03d}"]
            verify_spectrum(rf, spectrum)
            iq = pymust.rf2iq(rf, p.fs, p.fc)
            matrix = pymust.dasmtx(iq, np.array([0.]), np.array([z]), delays, p)
            formed.append((matrix @ iq.flatten(order="F"))[0])
        formed = np.asarray(formed)
        if not np.array_equal(raw["beamformed"], formed) or not np.array_equal(np.abs(formed), case["profile"]["envelope"]):
            raise ValueError("Profile differs from RF reconstruction")
        measured = measure(expected_positions, np.abs(formed))
        if measured != case["measurement"]:
            raise ValueError("Profile measurement differs")
        widths[name] = measured["widthMm"]
        verified.append({"id": name, "rawSha256": case["raw"]["sha256"]})
    convergence = {key: abs(widths["focal-" + key] - widths["focal"]) / widths["focal"] for key in ("spacing", "frequency")}
    if convergence != source["convergence"] or max(convergence.values()) > .01:
        raise ValueError("Reference convergence differs or fails")
    return {"protocolId": PROTOCOL + "-verification", "referenceSha256": digest(path),
            "verifiedCases": verified, "verifiedControls": len(CONTROLS), "convergence": convergence,
            "scope": "File consistency, branch controls and RF-to-profile reconstruction; not independent clinical validation"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    acquire_parser = commands.add_parser("acquire")
    acquire_parser.add_argument("--out", type=Path, required=True)
    acquire_parser.add_argument("--runtime-manifest", type=Path, required=True)
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("reference", type=Path)
    verify_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    checkout = Path(__file__).resolve().parents[2]
    if args.out.resolve().is_relative_to(checkout):
        parser.error("Acquisition evidence must be outside the checkout")
    if args.command == "acquire":
        acquire_reference(args.out.resolve(), args.runtime_manifest.resolve(strict=True))
    else:
        dump(args.out.resolve(), verify_reference(args.reference.resolve(strict=True)))


if __name__ == "__main__":
    main()
