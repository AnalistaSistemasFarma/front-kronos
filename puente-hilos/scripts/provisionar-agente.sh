#!/bin/bash
# Provisiona una instancia del PUENTE DE HILOS para un agente de la flota, en el
# Mac donde corre ese agente. Solo PRUEBAS (F1).
#
# Uso:
#   puente-hilos/scripts/provisionar-agente.sh <agente> [opciones]
#
#   <agente>               code del agente en SynerLink (play, horus, gilbert…).
#   --env-bot RUTA         .env del bot vivo con CLAUDE_CODE_OAUTH_TOKEN
#                          (por defecto ~/.<agente>/.env). Solo se LEE esa
#                          variable, dentro del puente y sin imprimirla.
#   --llave-archivo RUTA   archivo con la llave NUEVA de scope "projects" (una
#                          línea). Se copia al .env del puente sin mostrarla y
#                          el archivo se borra. Sin esta opción, la variable
#                          queda vacía y el puente no arranca hasta llenarla.
#   --url URL              SynerLink de PRUEBAS (por defecto http://192.168.11.230:3030).
#   --aplicar              hace los cambios. Sin esta opción es un ENSAYO: solo
#                          dice lo que haría.
#   --cargar               además, registra el servicio launchd y lo prende.
#
# Qué deja (todo bajo ~/.puente-hilos, NUNCA dentro de ~/.<agente>):
#   ~/.puente-hilos/codigo-<commit>/puente-hilos   copia del código (+ enlace `codigo`)
#   ~/.puente-hilos/bin/claude-<versión>           ejecutable fijo de Claude Code
#   ~/.puente-hilos/<agente>-pruebas/.env          600, con HILOS_* (sin imprimir)
#   ~/.puente-hilos/<agente>-pruebas/perfiles.json
#   ~/Library/LaunchAgents/com.gss.puente-hilos.<agente>-pruebas.plist  (RunAtLoad/KeepAlive en false)
#
# Qué NO toca: el bot vivo (su launchd, su sesión, su config ni su .env).
# Lo que falta del lado de SynerLink (lo hace quien administra PRUEBAS):
#   - agregar el agente a CHAT_PROJECTS_AGENTS con sus perfiles;
#   - crear la llave {"agent":"<agente>","scope":"projects"} en CHAT_AGENT_API_KEYS;
#   - reiniciar la app de pruebas.
set -euo pipefail

AGENTE="${1:-}"
if [[ -z "$AGENTE" || "$AGENTE" == -* ]]; then
  sed -n '2,32p' "$0"
  exit 2
fi
shift
if [[ ! "$AGENTE" =~ ^[a-z0-9-]+$ ]]; then echo "Código de agente inválido: $AGENTE" >&2; exit 2; fi

ENV_BOT="$HOME/.$AGENTE/.env"
LLAVE_ARCHIVO=""
URL="http://192.168.11.230:3030"
APLICAR=0
CARGAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-bot) ENV_BOT="$2"; shift 2 ;;
    --llave-archivo) LLAVE_ARCHIVO="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --aplicar) APLICAR=1; shift ;;
    --cargar) CARGAR=1; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

REPO_PUENTE="$(cd "$(dirname "$0")/.." && pwd)"
RAIZ="$HOME/.puente-hilos"
DIR="$RAIZ/$AGENTE-pruebas"
LABEL="com.gss.puente-hilos.$AGENTE-pruebas"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
COMMIT="$(git -C "$REPO_PUENTE" rev-parse --short=8 HEAD 2>/dev/null || echo sin-git)"
CODIGO="$RAIZ/codigo-$COMMIT"

fallo() { echo "✖ $*" >&2; exit 1; }
paso() { if [[ $APLICAR -eq 1 ]]; then echo "→ $*"; else echo "[ensayo] $*"; fi; }

# ── Verificaciones (fallan cerrado) ───────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || fallo "Este script es para los Mac de la flota."
command -v node >/dev/null || fallo "No hay node en el PATH."
NODE_MAYOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAYOR" -ge 20 ]] || fallo "El puente exige Node 20 o superior (hay $NODE_MAYOR)."
CLAUDE_REAL="$(command -v claude || true)"
[[ -n "$CLAUDE_REAL" ]] || fallo "No hay claude en el PATH."
while [[ -L "$CLAUDE_REAL" ]]; do
  destino="$(readlink "$CLAUDE_REAL")"
  [[ "$destino" == /* ]] || destino="$(dirname "$CLAUDE_REAL")/$destino"
  CLAUDE_REAL="$destino"
done
VERSION_CLAUDE="$("$CLAUDE_REAL" --version 2>/dev/null | awk '{print $1}')"
[[ -n "$VERSION_CLAUDE" ]] || fallo "No se pudo leer la versión de claude."
"$CLAUDE_REAL" --help 2>/dev/null | grep -q -- '--restricted' || fallo "claude $VERSION_CLAUDE no soporta --restricted."
CLAUDE_BIN="$RAIZ/bin/claude-$VERSION_CLAUDE"

[[ -f "$ENV_BOT" ]] || fallo "No existe $ENV_BOT (el .env del bot con su token)."
# Se cuenta la línea; el valor NUNCA se lee aquí ni se imprime.
[[ "$(grep -c '^CLAUDE_CODE_OAUTH_TOKEN=.' "$ENV_BOT" || true)" -ge 1 ]] \
  || fallo "$ENV_BOT no tiene CLAUDE_CODE_OAUTH_TOKEN (migrar el bot a token: skill cambiar-auth-token)."

for f in "$HOME/CLAUDE.md" "$HOME/CLAUDE.local.md" "/Users/CLAUDE.md" "/CLAUDE.md"; do
  if [[ -e "$f" ]]; then fallo "Hay un $f por encima de ~/.puente-hilos; Claude Code lo cargaría en cada hilo."; fi
done
if [[ -n "$LLAVE_ARCHIVO" ]]; then
  [[ -f "$LLAVE_ARCHIVO" ]] || fallo "No existe $LLAVE_ARCHIVO."
  [[ "$(wc -l < "$LLAVE_ARCHIVO" | tr -d ' ')" -le 1 ]] || fallo "$LLAVE_ARCHIVO debe tener una sola línea."
  [[ "$(tr -d '\r\n' < "$LLAVE_ARCHIVO" | wc -c | tr -d ' ')" -ge 32 ]] || fallo "La llave debe tener 32 caracteres o más."
fi
if [[ -f "$DIR/.env" ]]; then
  fallo "$DIR/.env ya existe: esta instancia ya está provisionada (no se sobrescribe)."
fi

echo "Agente: $AGENTE · código $COMMIT · claude $VERSION_CLAUDE · SynerLink $URL"
echo "Carpeta: $DIR · servicio: $LABEL"

# ── Código y ejecutable fijos ─────────────────────────────────────────────
paso "copiar el código del puente a $CODIGO/puente-hilos y apuntar $RAIZ/codigo"
paso "fijar claude en $CLAUDE_BIN"
paso "crear $DIR (700), perfiles.json y .env (600)"
paso "escribir $PLIST (RunAtLoad=false, KeepAlive=false)"
if [[ $CARGAR -eq 1 ]]; then paso "registrar y prender $LABEL"; fi
if [[ $APLICAR -eq 0 ]]; then
  echo "Ensayo terminado. Repita con --aplicar para hacer los cambios."
  exit 0
fi

umask 077
mkdir -p "$RAIZ/bin" "$DIR/logs"
chmod 700 "$RAIZ" "$DIR"
if [[ ! -d "$CODIGO/puente-hilos" ]]; then
  mkdir -p "$CODIGO"
  rsync -a --exclude node_modules --exclude test "$REPO_PUENTE/" "$CODIGO/puente-hilos/"
  echo "$COMMIT" > "$CODIGO/COMMIT"
  chmod -R go-w "$CODIGO"
fi
ln -sfn "$CODIGO" "$RAIZ/codigo"
[[ -x "$CLAUDE_BIN" ]] || { cp "$CLAUDE_REAL" "$CLAUDE_BIN"; chmod 700 "$CLAUDE_BIN"; }

cp "$REPO_PUENTE/config/perfiles.example.json" "$DIR/perfiles.json"
chmod 600 "$DIR/perfiles.json"

# El .env se arma con permisos 600 ANTES de escribir nada sensible.
: > "$DIR/.env"
chmod 600 "$DIR/.env"
{
  echo "HILOS_ENTORNO=pruebas"
  echo "HILOS_SYNERLINK_URL=$URL"
  printf 'HILOS_SYNERLINK_KEY='
  if [[ -n "$LLAVE_ARCHIVO" ]]; then tr -d '\r\n' < "$LLAVE_ARCHIVO"; fi
  echo
  echo "HILOS_AGENTE=$AGENTE"
  echo "HILOS_DIR=$DIR"
  echo "HILOS_PERFILES=$DIR/perfiles.json"
  echo "HILOS_TOKEN_ENV_AGENTE=$ENV_BOT"
  echo "HILOS_MAX_CONCURRENCIA=2"
  echo "HILOS_TIMEOUT_TURNO_MS=900000"
  echo "HILOS_CLAUDE_BIN=$CLAUDE_BIN"
  echo "HILOS_INSTRUCCIONES_EN=system-prompt"
} >> "$DIR/.env"
if [[ -n "$LLAVE_ARCHIVO" ]]; then rm -f "$LLAVE_ARCHIVO"; fi

sed -e "s#__REPO__/puente-hilos#$RAIZ/codigo/puente-hilos#g" \
    -e "s#__HOME__/.puente-hilos/play-pruebas#$DIR#g" \
    -e "s#com.gss.puente-hilos.play-pruebas#$LABEL#g" \
    -e "s#Puente de hilos de Play#Puente de hilos de $AGENTE#" \
    "$REPO_PUENTE/launchd/com.gss.puente-hilos.play-pruebas.plist.example" > "$PLIST"
plutil -lint "$PLIST" >/dev/null || fallo "El plist generado no es válido."

echo "✔ Provisionado. Llave de scope projects: $([[ -n "$LLAVE_ARCHIVO" ]] && echo cargada || echo 'FALTA (llene HILOS_SYNERLINK_KEY)')."
if [[ $CARGAR -eq 1 ]]; then
  [[ -n "$LLAVE_ARCHIVO" ]] || fallo "No se prende sin llave."
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart "gui/$(id -u)/$LABEL"
  sleep 5
  tail -3 "$DIR/logs/stdout.log" "$DIR/logs/stderr.log" 2>/dev/null || true
else
  echo "Para probar en primer plano: bash $RAIZ/codigo/puente-hilos/launchd/run.sh $DIR/.env"
  echo "Para el servicio: launchctl bootstrap gui/\$(id -u) $PLIST && launchctl kickstart gui/\$(id -u)/$LABEL"
fi
