#!/bin/bash
# Arranque del puente de hilos con su .env propio. Uso: run.sh <ruta al .env>
# El .env debe ser del dueño y con permisos 600; si no, no arranca.
set -euo pipefail
ENV_FILE="${1:?Falta la ruta al .env del puente}"
if [ ! -f "$ENV_FILE" ]; then echo "No existe $ENV_FILE" >&2; exit 1; fi
PERM=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
if [ "$PERM" != "600" ]; then echo "$ENV_FILE debe tener permisos 600 (tiene $PERM)" >&2; exit 1; fi
# Entorno LIMPIO: solo PATH/HOME y lo del .env del puente; nada del shell que lo lanzó.
exec /usr/bin/env -i PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" \
  /bin/bash -c 'set -a; source "$0"; set +a; exec node "$1"' "$ENV_FILE" "$(cd "$(dirname "$0")/.." && pwd)/src/puente.mjs"
