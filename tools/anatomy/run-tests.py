"""Ejecuta contratos unittest aislados; no deja el archivo en argv de unittest.

Uso: python -I tools/anatomy/run-tests.py [archivo_test.py ...]
Sin argumentos descubre todos los *_test.py del directorio. No omite suites.
"""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
files = [Path(a).resolve() for a in sys.argv[1:]] if len(sys.argv) > 1 else sorted(root.glob('*_test.py'))
bootstrap = ('import runpy,sys;from pathlib import Path;'
             'p=Path(sys.argv[1]).resolve();sys.path.insert(0,str(p.parent));'
             'sys.argv=[str(p)];runpy.run_path(str(p),run_name="__main__")')
failed = []
for file in files:
    if file.parent != root or not file.name.endswith('_test.py'):
        raise ValueError('Sólo contratos de tools/anatomy')
    print('PYTHON TEST '+file.name, flush=True)
    result = subprocess.run([sys.executable, '-I', '-c', bootstrap, str(file)], check=False)
    if result.returncode:
        failed.append({'file': file.name, 'exitCode': result.returncode})
print('FAILED: '+repr(failed), flush=True)
sys.exit(bool(failed))
