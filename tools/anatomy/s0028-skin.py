"""Comparador cutáneo P0e y huellas P0 congeladas, sin datos en CI."""
import importlib.util
from pathlib import Path
import numpy as np

SPEC = importlib.util.spec_from_file_location('direct', Path(__file__).with_name('s0028-direct.py'))
lib = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lib)


def stats(a):
    if not len(a):
        raise ValueError('Huella vacía')
    p95, maximum = float(np.quantile(a, .95)), float(np.max(a))
    return {'samples': len(a), 'p95Mm': p95, 'maxMm': maximum,
            'pass': p95 <= 1.5 and maximum <= 3}


def window_mask(p, old_profile, plane):
    # Congelar EXACTAMENTE la huella P0: no recenterarla al perfil candidato.
    cy = np.interp(p[:, 2], np.arange(-400, 121, 40), old_profile[:, 0])
    phi = np.arctan2(p[:, 1]-cy, p[:, 0])
    radius = np.hypot(p[:, 0], p[:, 1]-cy)
    delta = np.arctan2(np.sin(phi-plane['phi']), np.cos(phi-plane['phi']))
    return (np.abs(delta)*radius <= 30) & (np.abs(p[:, 2]-plane['z']) <= 15)
