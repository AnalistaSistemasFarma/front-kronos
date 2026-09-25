#!/bin/bash
# Corrida nocturna del motor predictivo (Farmalógica + resto de empresas).
#   1) refresca las cachés SQLite de SharePoint (incrementales, solo Farmalógica),
#   2) genera el JSON de cada empresa (ventas desde SAP en solo lectura; Farmalógica
#      incluye además `cartera`: cartera y flujo de caja, ver cartera_farmalogica.py, y
#      `lotes_registros`: lotes con vencimiento real y registros sanitarios por renovar,
#      ver lotes_registros_farmalogica.py),
#   3) publica un snapshot por empresa en la base de PRUEBAS (KRONOSDB_PRUEBAS) vía pce0023.
# NO está programado: el plist de ejemplo (com.gss.predictivo.nightly.plist)
# queda sin instalar hasta que Nicolás lo apruebe.
# Uso: run_nightly.sh [empresa ...]   (por defecto todas; claves: farmalogica ryan olp abamia meditrack kelab)
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="${FAR_CACHE_DIR:-/Users/horus/.horus/cache}"
SSH_HOST="${PREDICTIVO_SSH_HOST:-pce0023}"
REMOTE_DIR='C:\Users\nicolas.rivera\projects\front-kronos-test'
PY="$DIR/.venv/bin/python3"; [ -x "$PY" ] || PY=python3
# Python para las cachés de SharePoint: necesita `requests`. El python3 de Homebrew
# (primero en el PATH) no lo trae; el del sistema sí (paquetes de usuario).
SP_PY="${SP_PY:-}"
if [ -z "$SP_PY" ]; then
  for c in "$DIR/.venv/bin/python3" /usr/bin/python3 python3; do
    if "$c" -c 'import requests' >/dev/null 2>&1; then SP_PY="$c"; break; fi
  done
fi
EMPRESAS=("$@"); [ ${#EMPRESAS[@]} -gt 0 ] || EMPRESAS=(farmalogica ryan olp abamia meditrack kelab)
# company_id de la tabla `company` de KRONOSDB_PRUEBAS
company_id() {
  case "$1" in
    farmalogica) echo 1 ;; ryan) echo 2 ;; olp) echo 3 ;; meditrack) echo 6 ;; abamia) echo 7 ;; kelab) echo 9 ;;
    *) echo "empresa desconocida: $1" >&2; return 1 ;;
  esac
}

# el script va DENTRO de la carpeta del proyecto para que Node resuelva `mssql`
REMOTE_REL="projects/front-kronos-test"
# el SSH de pce0023 a veces corta la conexión al negociar: reintentar
reintentar() { local i; for i in 1 2 3 4 5; do "$@" && return 0; sleep $((i * 3)); done; return 1; }
TMPD="$(mktemp -d -t predictivo)"
limpiar() {
  ssh "$SSH_HOST" "del \"$REMOTE_DIR\\predictivo_publicar.js\" \"$REMOTE_DIR\\predictivo_snapshot.json\"" >/dev/null 2>&1 || true
  rm -rf "$TMPD"
}
trap limpiar EXIT

publicar() { # $1 = json, $2 = company_id
  reintentar scp -q "$1" "$SSH_HOST:$REMOTE_REL/predictivo_snapshot.json"
  reintentar scp -q "$DIR/publicar_snapshot.js" "$SSH_HOST:$REMOTE_REL/predictivo_publicar.js"
  reintentar ssh "$SSH_HOST" "cd /d \"$REMOTE_DIR\" && node predictivo_publicar.js predictivo_snapshot.json $2"
}

FALLAS=0
for e in "${EMPRESAS[@]}"; do
  cid="$(company_id "$e")"
  out="$TMPD/$e.json"
  echo "[$(date '+%F %T')] == $e (company $cid)"
  if [ "$e" = farmalogica ]; then
    echo "  1/3 cachés SharePoint"
    for c in far_ventas far_inventario far_lotes far_registro_sanitario far_bancos_movimientos; do
      s="$CACHE/$c/${c}_export.py"
      if [ -z "$SP_PY" ]; then echo "  aviso: no hay un Python con 'requests'; se usan las cachés anteriores"; break; fi
      if [ -f "$s" ]; then (cd "$CACHE/$c" && "$SP_PY" "$s" >/dev/null) || echo "  aviso: falló la caché $c (se sigue con la anterior)"; fi
    done
    echo "  2/3 generando"
    gen=("$PY" "$DIR/generar_farmalogica.py" --out "$out")
  else
    echo "  2/3 generando (SAP solo lectura)"
    gen=("$PY" "$DIR/generar_empresa.py" --empresa "$e" --out "$out")
  fi
  # una empresa que falle no detiene a las demás
  if "${gen[@]}"; then
    echo "  3/3 publicando snapshot en KRONOSDB_PRUEBAS ($SSH_HOST)"
    publicar "$out" "$cid" || { echo "  ERROR publicando $e"; FALLAS=$((FALLAS + 1)); }
  else
    echo "  ERROR generando $e"; FALLAS=$((FALLAS + 1))
  fi
done
echo "[$(date '+%F %T')] listo (fallas: $FALLAS)"
[ "$FALLAS" -eq 0 ]
