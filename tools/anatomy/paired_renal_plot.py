"""Figura local de los mismos centros físicos; no mezcla intensidades de dos modalidades."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def plot(folder, output, low=-150, high=250):
    if output.exists(): raise ValueError("Conservar figura anterior; elegir otra salida")
    if not np.isfinite([low, high]).all() or low >= high: raise ValueError("Ventana TAC inválida")
    metadata = json.loads((folder/"plane.json").read_text())
    with np.load(folder/"plane.npz", allow_pickle=False) as arrays:
        us, ct, valid = arrays["ultrasound"], arrays["ct"], arrays["ct_valid"]
    if us.shape != ct.shape or ct.shape != valid.shape: raise ValueError("Rejillas distintas")
    spacing = metadata["pixelSpacingMm"]
    extent = [-spacing[0]/2, (us.shape[0]-.5)*spacing[0], -spacing[1]/2, (us.shape[1]-.5)*spacing[1]]
    fig, axes = plt.subplots(1, 2, figsize=(12, 6), layout="constrained")
    gray = plt.colormaps["gray"].copy(); gray.set_bad("#684a80")
    axes[0].imshow(us.T, cmap="gray", vmin=0, vmax=255, origin="lower", extent=extent)
    axes[1].imshow(np.where(valid, ct, np.nan).T, cmap=gray, vmin=low, vmax=high, origin="lower", extent=extent)
    axes[0].set_title("US original · eje/índice de adquisición")
    axes[1].set_title(f"TAC en plano US · ventana [{low:g}, {high:g}]\nVioleta: fuera del soporte TAC")
    for ax in axes:
        ax.set_xlabel(f"Eje US {metadata['inPlaneUsAxes'][0]} (mm)")
        ax.set_ylabel(f"Eje US {metadata['inPlaneUsAxes'][1]} (mm)")
    fig.suptitle(f"{metadata['patientId']}{metadata['side']} · eje {metadata['usAxis']}, índice {metadata['usIndex']}\n"
                 f"Inicialización rígida · TRE pelvis {metadata['pelvisTreMm']:.2f} mm · sin aceptación clínica")
    fig.savefig(output, dpi=160); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path); parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ct-low", type=float, default=-150); parser.add_argument("--ct-high", type=float, default=250)
    args = parser.parse_args(); plot(args.folder, args.output, args.ct_low, args.ct_high)


if __name__ == "__main__": main()
