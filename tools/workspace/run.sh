#!/usr/bin/env bash
# Entra en este checkout y usa su Node validado. No instala ni cambia el perfil global.
set -e
workspace_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd -- "$workspace_root"
workspace_node="$(cat .nvmrc)"
workspace_current="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [ "$workspace_current" != "$workspace_node" ]; then
  workspace_nvm="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ ! -f "$workspace_nvm" ]; then
    echo "Se requiere Node $workspace_node. Actívalo antes de repetir el comando." >&2
    exit 1
  fi
  # nvm se carga solo en este proceso; ninguna instalación automática.
  source "$workspace_nvm"
  nvm use --silent "$workspace_node"
fi
if [ "$#" -eq 0 ]; then
  echo 'Uso: tools/workspace/run.sh <comando> [argumentos…]' >&2
  exit 2
fi
exec "$@"
