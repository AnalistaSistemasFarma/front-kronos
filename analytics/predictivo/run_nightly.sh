#!/bin/bash
# Corrida nocturna del motor predictivo (piloto Farmalógica).
#   1) refresca las cachés SQLite de SharePoint (incrementales),
#   2) genera el JSON (ventas desde SAP en solo lectura; respaldo SharePoint),
#   3) publica el snapshot en la base de PRUEBAS (KRONOSDB_PRUEBAS) vía pce0023.
# NO está programado: el plist de ejemplo (com.gss.predictivo.nightly.plist)
# queda sin instalar hasta que Nicolás lo apruebe.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="${FAR_CACHE_DIR:-/Users/horus/.horus/cache}"
SSH_HOST="${PREDICTIVO_SSH_HOST:-pce0023}"
REMOTE_DIR='C:\Users\nicolas.rivera\projects\front-kronos-test'
COMPANY_ID=1
OUT="$(mktemp -t predictivo).json"
PY="$DIR/.venv/bin/python3"; [ -x "$PY" ] || PY=python3

echo "[$(date '+%F %T')] 1/3 cachés SharePoint"
for c in far_ventas far_inventario far_lotes far_registro_sanitario; do
  s="$CACHE/$c/${c}_export.py"
  if [ -f "$s" ]; then (cd "$CACHE/$c" && python3 "$s" >/dev/null) || echo "  aviso: falló la caché $c (se sigue con la anterior)"; fi
done

echo "[$(date '+%F %T')] 2/3 generando"
"$PY" "$DIR/generar_farmalogica.py" --out "$OUT"

echo "[$(date '+%F %T')] 3/3 publicando snapshot en KRONOSDB_PRUEBAS ($SSH_HOST)"
# el script va DENTRO de la carpeta del proyecto para que Node resuelva `mssql`
REMOTE_REL="projects/front-kronos-test"
# el SSH de pce0023 a veces corta la conexión al negociar: reintentar
reintentar() { local i; for i in 1 2 3 4 5; do "$@" && return 0; sleep $((i * 3)); done; return 1; }
limpiar() {
  ssh "$SSH_HOST" "del \"$REMOTE_DIR\\predictivo_publicar.js\" \"$REMOTE_DIR\\predictivo_snapshot.json\"" >/dev/null 2>&1 || true
  rm -f "$OUT"
}
trap limpiar EXIT
reintentar scp -q "$OUT" "$SSH_HOST:$REMOTE_REL/predictivo_snapshot.json"
reintentar scp -q "$DIR/publicar_snapshot.js" "$SSH_HOST:$REMOTE_REL/predictivo_publicar.js"
reintentar ssh "$SSH_HOST" "cd /d \"$REMOTE_DIR\" && node predictivo_publicar.js predictivo_snapshot.json $COMPANY_ID"
echo "[$(date '+%F %T')] listo"
