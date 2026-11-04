#!/usr/bin/env python3
"""
RECOLECTOR DE ERRORES DE IA (Auditoría de agentes → Errores de IA).
Pedido de Nicolás (2026-11-03): «como un Sentry pero con los agentes».

Lee en SOLO LECTURA, local o por SSH (los 5 equipos de flota.json: Mac de horus,
jorge, pedro, lisa y cosmo), y publica cada ocurrencia por
POST /api/chat/auditoria/errores con la llave del recolector del inventario.
El servidor agrupa por huella (agente + tipo + ambiente + primera línea
normalizada), cuenta ocurrencias y descarta las repetidas por su clave: se puede
releer el mismo log en cada ronda sin contar dos veces.

QUÉ DETECTA
  En cada equipo (LECTOR, sin tocar procesos ni archivos):
    - puentes openclaw (~/synerlink-bridge*/logs/*.err.log): «falló el turno del
      mensaje N» (incluye «el turno excedió Ns» y cli_overall_timeout), 401 de la
      llave del puente, 500 sostenidos de la bandeja y errores del seguimiento.
    - puente de hilos (~/.puente-hilos/<agente>-<prod|pruebas>/logs): errores
      atendiendo un turno, tope de gasto, 401 y límites.
    - bots de Claude Code (~/.<bot>/logs/stdout.log, la pantalla actual de la
      TUI): congelado en una confirmación («Do you want to proceed?», «❯ 1. Yes»),
      «Please run /login» / 401 y «hit your limit».
    - conectores MCP de cada bot (logs de la sesión actual en
      ~/Library/Caches/claude-cli-nodejs/<cwd>/mcp-logs-*): «giving up»,
      EHOSTDOWN, «failed to connect» sin reconexión posterior, y herramientas
      que fallaron dentro de un turno (severidad baja).
  En la Mac de horus, REUTILIZA lo que ya calcula ~/.horus/fleet-ping (no lo
  vuelve a correr): conversaciones sin contestar (synerlink-pendientes.js),
  recibe-pero-no-envía, límite de uso con la cola congelada y kronos «giving up»
  (check-limite-givingup.sh), conectores caídos (check-conectores.sh /
  check-puentes.sh) y el sondeo diario (probe-bots.sh: LOGIN, FROZEN, ERROR).

AVISOS
  Si el servidor tiene AGENT_ERRORS_NOTIFY=1, responde `notificar` con los
  errores nuevos o de severidad alta que toca avisar (máximo uno por error cada
  AGENT_ERRORS_NOTIFY_HOURS). El recolector los agrupa en UN mensaje a la
  conversación 1 de SynerLink PRODUCCIÓN por HTTP (patrón de
  automatizaciones-reportan-en-synerlink, llave del canal synerlink-prod de
  horus) y luego confirma el envío (acuse) para que no se repita. En pruebas el
  servidor no tiene la bandera: no sale ningún aviso.

USO
  python3 recolector_errores.py                      # todos los equipos → collector.env
  python3 recolector_errores.py --solo local,cosmo
  python3 recolector_errores.py --ensayo             # no publica: muestra lo que encontró
  python3 recolector_errores.py --conf ~/.horus/agent-inventory/collector-prod.env
  python3 recolector_errores.py --horas 24           # ventana de lectura (por defecto 72 h)
  python3 recolector_errores.py --sin-avisos         # publica pero no envía avisos
Destinos: --conf (repetible) > ERRORS_CONF (separado por «:») > collector.env (PRUEBAS).
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = '1.0.0'
AQUI = pathlib.Path(__file__).resolve().parent
HOME = pathlib.Path(os.path.expanduser('~'))
_flota = AQUI.parent / 'agent-inventory' / 'flota.json'
if not _flota.exists():
    _flota = HOME / '.horus' / 'agent-inventory' / 'flota.json'
FLOTA = json.loads(_flota.read_text(encoding='utf-8'))
CONF = HOME / '.horus' / 'agent-inventory' / 'collector.env'
FLEET_LOGS = HOME / '.horus' / 'fleet-ping' / 'logs'
CANAL_PROD = HOME / '.horus' / 'claude-config' / 'channels' / 'synerlink-prod' / '.env'
CONVERSACION_AVISOS = 1
LOTE = 1500

# ── LECTOR: corre en cada equipo con «python3 -» (solo lectura, Python 3.8+) ──
LECTOR = r'''
import glob, json, os, re, sys, time, hashlib, calendar
arg = json.loads(sys.argv[1])
desde = arg["desde"]; host = arg["host"]
HOME = os.path.expanduser("~")
out = []
def ev(agente, tipo, sev, amb, titulo, clave, ts, conv=None, msg=None, detalle=None):
    out.append({"agente": agente, "tipo": tipo, "severidad": sev, "ambiente": amb,
                "titulo": titulo[:300], "clave": clave[:300], "ocurrioEn": ts,
                "idConversacion": conv, "idMensaje": msg, "detalle": (detalle or titulo)[:1000]})
def iso(e):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(e))
def ep(s):
    try: return calendar.timegm(time.strptime((s or "")[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception: return 0
def hora(e):
    return time.strftime("%Y-%m-%dT%H", time.gmtime(e))
def cola(path, n):
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - n)); raw = fh.read()
        txt = raw.decode("utf-8", "replace")
        return txt.split("\n")[1:] if size > n else txt.split("\n")
    except Exception:
        return []
def h8(s):
    return hashlib.sha1(s.encode("utf-8", "replace")).hexdigest()[:12]
LIM = re.compile(r"hit your (\w+ )?limit|rate[_ ]limit|\b429\b|usage_limit", re.I)
LOGIN = re.compile(r"Please run /login|\b401\b|authentication_error|Invalid authentication|OAuth token has expired", re.I)

# 1) puentes openclaw
puentes = {a.get("bridge"): a["code"] for a in arg["agentes"] if a.get("kind") == "openclaw" and a.get("bridge")}
codigos = set(a["code"] for a in arg["agentes"])
vistos = set()
for f in glob.glob(HOME + "/synerlink-bridge/logs/*.err.log") + glob.glob(HOME + "/synerlink-bridge*/logs/*.err.log"):
    f = os.path.realpath(f)
    if f in vistos: continue
    vistos.add(f)
    try:
        if os.path.getmtime(f) < desde: continue
    except Exception: continue
    stem = os.path.basename(f)[:-len(".err.log")]
    if "talk" in stem: continue
    carpeta = os.path.basename(os.path.dirname(os.path.dirname(f)))
    amb = "pruebas" if re.search(r"(^|-)(test|testing|prueba|pruebas)$", stem) else "prod"
    base = re.sub(r"-?(prod|test|testing|prueba|pruebas)$", "", stem)
    if not base: base = carpeta
    agente = puentes.get(base) or (base if base in codigos else None) or puentes.get(carpeta)
    if not agente: continue
    conv_de = {}
    poll = {}
    for ln in cola(f, 4000000):
        m = re.match(r"^\[puente-synerlink\] (\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$", ln)
        if not m: continue
        ts, txt = ep(m.group(1)), m.group(2)
        if txt.startswith("estado c"): continue
        a = re.match(r"atendiendo mensaje (\d+) de la conversación (\d+)", txt)
        if a:
            conv_de[int(a.group(1))] = int(a.group(2)); continue
        if ts < desde: continue
        t = re.match(r"falló el turno del mensaje (\d+): (.*)", txt)
        if t:
            msg = int(t.group(1)); motivo = t.group(2).strip() or "sin detalle"
            tipo = "limite_uso" if LIM.search(motivo) else "sesion_vencida" if LOGIN.search(motivo) else "turno_fallido"
            ev(agente, tipo, "alta", amb, "Falló el turno: " + motivo[:200], "%s|%s|%d" % (stem, m.group(1), msg),
               iso(ts), conv_de.get(msg), msg, txt)
            continue
        if "cli_overall_timeout" in txt or "excedió" in txt:
            ev(agente, "turno_fallido", "alta", amb, txt[:200], "%s|%s|%s" % (stem, m.group(1), h8(txt)), iso(ts), detalle=txt)
            continue
        p = re.match(r"error en el poll: (.*)", txt)
        if p:
            d = p.group(1)
            if "Unauthorized" in d or "→ 401" in d:
                k = ("401", "La llave del puente fue rechazada (401 Unauthorized): no recibe mensajes", "alta")
            elif re.search(r"→ 5\d\d", d):
                k = ("5xx", "SynerLink respondió error 500 a la bandeja del puente", "media")
            else:
                continue  # cortes de red sueltos (fetch failed, ETIMEDOUT): no son un error del agente
            g = poll.setdefault((k, hora(ts)), [0, ts, txt]); g[0] += 1; g[1] = max(g[1], ts); g[2] = txt
            continue
        s = re.match(r"(?:seguimiento c\d+|actividad): (?!registrado)(.*)", txt)
        if s and "modo local" not in s.group(1) and re.search(r"cannot|no disponible|no se pudieron|error|failed", s.group(1), re.I):
            ev(agente, "otro", "media", amb, "Seguimiento de sub-agentes: " + s.group(1)[:180],
               "%s|seg|%s|%s" % (stem, hora(ts), h8(s.group(1))), iso(ts), detalle=txt)
    for ((k, titulo, sev), hr), (n, ts, txt) in poll.items():
        ev(agente, "puente_caido", sev, amb, titulo, "%s|poll|%s|%s" % (stem, k, hr), iso(ts),
           detalle="%d veces en la hora %s UTC. Última: %s" % (n, hr[11:], txt[:300]))

# 2) puente de hilos
for f in glob.glob(HOME + "/.puente-hilos/*/logs/std*.log"):
    nombre = os.path.basename(os.path.dirname(os.path.dirname(f)))
    m = re.match(r"^(.+)-(prod|pruebas)$", nombre)
    if not m: continue
    agente, amb = m.group(1), m.group(2)
    try:
        if os.path.getmtime(f) < desde: continue
    except Exception: continue
    horas = {}
    for ln in cola(f, 3000000):
        m = re.match(r"^(\d{4}-\d\d-\d\dT[\d:.]+Z) \[puente-hilos\] (?:\[\w+\] )?(.*)$", ln)
        if not m: continue
        ts, txt = ep(m.group(1)), m.group(2)
        if ts < desde: continue
        c = re.match(r"conversación (\d+): (.*)", txt)
        conv = int(c.group(1)) if c else None
        cuerpo = c.group(2) if c else txt
        if c and cuerpo.startswith("error atendiendo el turno"):
            tipo = "limite_uso" if LIM.search(cuerpo) else "sesion_vencida" if LOGIN.search(cuerpo) else "puente_hilos"
            ev(agente, tipo, "alta", amb, cuerpo[:200], "%s|%s|%s" % (nombre, m.group(1), conv), iso(ts), conv, detalle=txt)
        elif "tope de gasto" in cuerpo:
            ev(agente, "limite_uso", "media", amb, cuerpo[:200], "%s|%s|%s" % (nombre, m.group(1), conv), iso(ts), conv, detalle=txt)
        elif LOGIN.search(cuerpo) and "listo:" not in cuerpo:
            ev(agente, "sesion_vencida", "alta", amb, cuerpo[:200], "%s|%s|%s" % (nombre, m.group(1), h8(cuerpo)), iso(ts), conv, detalle=txt)
        elif LIM.search(cuerpo) and "listo:" not in cuerpo:
            ev(agente, "limite_uso", "alta", amb, cuerpo[:200], "%s|%s|%s" % (nombre, m.group(1), h8(cuerpo)), iso(ts), conv, detalle=txt)
        elif re.search(r"HTTP 5\d\d|error:", cuerpo) and "fetch failed" not in cuerpo:
            titulo = re.sub(r"\s*\(.*$", "", cuerpo)[:200]
            g = horas.setdefault((titulo, hora(ts)), [0, ts, txt]); g[0] += 1; g[1] = max(g[1], ts); g[2] = txt
    for (titulo, hr), (n, ts, txt) in horas.items():
        ev(agente, "puente_hilos", "baja", amb, titulo, "%s|h|%s|%s" % (nombre, hr, h8(titulo)), iso(ts),
           detalle="%d veces en la hora %s UTC. Última: %s" % (n, hr[11:], txt[:300]))

# 3) bots de Claude Code: pantalla actual de la TUI y conectores MCP
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r")
ahora = time.time()
for a in arg["agentes"]:
    if a.get("kind") != "claude-code" or not a.get("dir"): continue
    d = os.path.join(HOME, a["dir"]); code = a["code"]
    f = os.path.join(d, "logs", "stdout.log")
    if os.path.exists(f):
        mt = os.path.getmtime(f)
        pantalla = ANSI.sub("", "\n".join(cola(f, 60000)))[-6000:]
        quieto = ahora - mt > 180
        if quieto and ("Do you want to proceed?" in pantalla or "❯ 1. Yes" in pantalla or "Do you want to make this edit" in pantalla):
            ev(code, "congelado_confirmacion", "alta", "prod",
               "Detenido esperando una confirmación en la terminal («Do you want to proceed?»)",
               "%s|confirmacion|%d" % (code, int(mt)), iso(mt),
               detalle="La pantalla del bot no cambia desde %s y muestra un diálogo de confirmación." % iso(mt))
        if "Please run /login" in pantalla or re.search(r"API Error: 401|authentication_error", pantalla):
            ev(code, "sesion_vencida", "alta", "prod", "Sesión vencida: «Please run /login» (401)",
               "%s|login|%d" % (code, int(mt)), iso(mt))
        if quieto and re.search(r"hit your (\w+ )?limit|What do you want to do\?", pantalla):
            r = re.search(r"[^\n]*hit your[^\n]*", pantalla)
            ev(code, "limite_uso", "alta", "prod", "Límite de uso: " + (r.group(0).strip()[:180] if r else "diálogo «What do you want to do?»"),
               "%s|limite|%d" % (code, int(mt)), iso(mt))
    # conectores MCP de la sesión actual (cwd = VAULT_PATH del run.sh)
    try:
        vault = re.search(r'^VAULT_PATH="?([^"\n]+)"?', open(os.path.join(d, "run.sh")).read(), re.M).group(1)
    except Exception:
        continue
    enc = re.sub(r"[^A-Za-z0-9]", "-", vault.replace("$HOME", HOME).replace("${HOME}", HOME))
    for sd in glob.glob(os.path.join(HOME, "Library/Caches/claude-cli-nodejs", enc, "mcp-logs-*")):
        server = os.path.basename(sd)[len("mcp-logs-"):]
        if server.startswith("claude-ai-"): continue
        fs = sorted(glob.glob(sd + "/*.jsonl"), key=os.path.getmtime)
        if not fs or os.path.getmtime(fs[-1]) < desde: continue
        caida = None; herr = 0
        for ln in cola(fs[-1], 1500000):
            if not ln.strip(): continue
            try: o = json.loads(ln)
            except Exception: continue
            txt = str(o.get("debug") or o.get("error") or "")
            if txt.startswith("Server stderr"): continue
            ts = ep(o.get("timestamp"))
            if "Successfully connected" in txt or "reconnection successful" in txt:
                caida = None; continue
            if re.search(r"giving up|Max reconnection attempts|[Ff]ailed to connect|Connection failed|EHOSTDOWN|ECONNREFUSED", txt):
                caida = (ts, txt); continue
            t = re.match(r"Tool '([^']+)' failed after [\d.]+m?s: (.*)", txt, re.S)
            if t and ts >= desde and herr < 30:
                herr += 1
                ev(code, "herramienta", "baja", "prod", "%s/%s: %s" % (server, t.group(1), t.group(2).split("\n")[0][:150]),
                   "%s|tool|%s|%s|%s" % (code, server, o.get("timestamp"), h8(txt)), iso(ts), detalle=txt[:600])
        if caida and caida[0] >= desde:
            sev = "alta" if "synerlink" in server or "kronos" in server else "media"
            ev(code, "conector_caido", sev, "prod", "Conector %s caído: %s" % (server, caida[1].split("\n")[0][:160]),
               "%s|mcp|%s|%d" % (code, server, caida[0]), iso(caida[0]), detalle=caida[1][:600])
print(json.dumps(out))
'''


def sh_quote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def leer_equipo(alias, agentes, desde):
    arg = json.dumps({'host': alias, 'desde': int(desde),
                      'agentes': [{k: a.get(k) for k in ('code', 'kind', 'dir', 'bridge')} for a in agentes]})
    cmd = ['python3', '-', arg] if alias == 'local' else \
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 - ' + sh_quote(arg)]
    try:
        r = subprocess.run(cmd, input=LECTOR, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        return None, 'tiempo agotado'
    if r.returncode != 0:
        return None, (r.stderr.strip().splitlines() or ['sin conexión'])[-1][:200]
    try:
        return json.loads(r.stdout), None
    except Exception:
        return None, 'respuesta ilegible'


# ── Lo que ya calcula ~/.horus/fleet-ping (solo lectura de sus salidas) ──────
def codigo_de(maq_bot):
    """«jorge:andreabot» → «rex» (por equipo y carpeta de flota.json)."""
    if ':' not in maq_bot:
        return None
    maq, bot = maq_bot.split(':', 1)
    host = 'local' if maq == 'horus' else maq
    for a in FLOTA['agentes']:
        if a['host'] == host and (a.get('dir') == '.' + bot or (a.get('kind') == 'openclaw' and a['code'] == bot)):
            return a['code']
    return None


def fresco(p, horas=2):
    try:
        return time.time() - p.stat().st_mtime <= horas * 3600
    except OSError:
        return False


def iso(e):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(e))


def eventos_fleet_ping():
    out = []
    agentes = {a['code'] for a in FLOTA['agentes']}

    def ev(agente, tipo, sev, titulo, clave, ts, conv=None, msg=None, detalle=None, host=None):
        out.append({'agente': agente, 'tipo': tipo, 'severidad': sev, 'ambiente': 'prod', 'titulo': titulo[:300],
                    'clave': clave, 'ocurrioEn': iso(ts), 'idConversacion': conv, 'idMensaje': msg,
                    'detalle': (detalle or titulo)[:1000], 'host': host})

    pend = FLEET_LOGS / 'hourly-pendientes.txt'
    if fresco(pend):
        for ln in pend.read_text(errors='replace').splitlines():
            p = ln.split('|')
            if len(p) < 6 or p[0] not in agentes:
                continue
            convs = [int(x) for x in re.findall(r'\(conv (\d+)\)', p[5])]
            ev(p[0], 'sin_entregar', 'alta', 'Mensajes de personas sin contestar por más de 30 minutos',
               'pend|%s|%s' % (p[0], p[4]), int(p[4] or 0) or time.time(), convs[0] if convs else None,
               detalle='%s conversación(es) sin contestar; la más vieja lleva %s min. %s' % (p[2], p[3], p[5]))
    rne = FLEET_LOGS / 'hourly-rne.txt'
    if fresco(rne):
        for ln in rne.read_text(errors='replace').splitlines():
            p = ln.split('|')
            code = codigo_de(p[0]) if len(p) >= 6 else None
            if not code:
                continue
            ev(code, 'recibe_no_envia', 'alta', 'Recibe los mensajes pero contesta en su consola sin usar reply',
               'rne|%s|%s' % (code, p[5]), int(p[5] or 0) or time.time(),
               detalle='%s mensaje(s) sin enviar; contexto ~%s tokens. Requiere sesión nueva.' % (p[3], p[4]))
    lgu = FLEET_LOGS / 'hourly-lgu.txt'
    if fresco(lgu):
        for ln in lgu.read_text(errors='replace').splitlines():
            p = ln.split('|')
            code = codigo_de(p[0]) if len(p) >= 3 else None
            if not code:
                continue
            if p[1] in ('LIMITE', 'LIMITE_PREVIO') and len(p) >= 8:
                ids = re.findall(r'[\w-]+:(\d+):(\d+)', p[5])
                conv, msg = (int(ids[0][0]), int(ids[0][1])) if ids else (None, None)
                reset = int(p[3] or 0)
                ev(code, 'limite_uso', 'alta', 'Límite de uso (%s) con la cola de mensajes congelada' % p[7],
                   'lgu|%s|%s' % (code, p[2]), int(p[2]), conv, msg,
                   detalle='%s mensaje(s) en cola.%s' % (p[4], (' Se restablece %s.' % iso(reset)) if reset else ''))
            elif p[1] == 'GIVINGUP':
                ev(code, 'conector_caido', 'alta', 'El conector kronos-synerlink se rindió («giving up») en la sesión actual',
                   'lgu|givingup|%s|%s' % (code, p[2]), int(p[2]))
    conn = FLEET_LOGS / 'hourly-conectores.txt'
    if fresco(conn):
        for ln in conn.read_text(errors='replace').splitlines():
            if '|' not in ln:
                continue
            k, desc = ln.split('|', 1)
            code = codigo_de(k)
            hora = time.strftime('%Y-%m-%dT%H', time.gmtime(conn.stat().st_mtime))
            if code:
                ev(code, 'conector_caido', 'alta', desc[:200], 'conn|%s|%s|%s' % (code, hora, desc[:60]), conn.stat().st_mtime)
            elif k.endswith(':*'):
                ev('flota', 'otro', 'media', 'Equipo %s: %s' % (k[:-2], desc[:150]), 'conn|%s|%s' % (k, hora),
                   conn.stat().st_mtime, host=k[:-2])
    hoy = FLEET_LOGS / ('results-%s.txt' % time.strftime('%Y%m%d'))
    if fresco(hoy, 14):
        for ln in hoy.read_text(errors='replace').splitlines():
            p = ln.split('|')
            if len(p) < 4 or p[1] == 'OK':
                continue
            code = codigo_de(p[0])
            dia = time.strftime('%Y-%m-%d')
            ts = hoy.stat().st_mtime
            if p[1] == 'LOGIN' and code:
                ev(code, 'sesion_vencida', 'alta', 'Sesión vencida en el sondeo diario (401 / «Please run /login»)',
                   'probe|%s|%s|login' % (code, dia), ts, detalle=p[3])
            elif p[1] == 'FROZEN' and code:
                ev(code, 'otro', 'alta', 'No respondió al sondeo diario en 120 s', 'probe|%s|%s|frozen' % (code, dia), ts, detalle=p[3])
            elif p[1] == 'ERROR' and code:
                tipo = 'limite_uso' if re.search(r'hit your|limit', p[3], re.I) else 'otro'
                ev(code, tipo, 'media', 'Sondeo diario con error: %s' % re.sub(r'resets .*', '', p[3])[:160],
                   'probe|%s|%s|error' % (code, dia), ts, detalle=p[3])
            elif p[1] == 'UNREACH':
                maq = p[0].split(':')[0]
                ev('flota', 'otro', 'media', 'Equipo %s inalcanzable por SSH en el sondeo diario' % maq,
                   'probe|%s|%s|unreach' % (maq, dia), ts, host=maq)
    return out


# ── Publicación y avisos ─────────────────────────────────────────────────────
def leer_env(ruta):
    conf = {}
    if ruta.exists():
        for linea in ruta.read_text().splitlines():
            if '=' in linea and not linea.lstrip().startswith('#'):
                k, v = linea.split('=', 1)
                conf[k.strip()] = v.strip().strip('"').strip("'")
    return conf


def leer_conf(ruta):
    conf = leer_env(ruta)
    url = conf.get('SYNERLINK_INVENTORY_URL', '').rstrip('/')
    key = conf.get('SYNERLINK_INVENTORY_KEY', '')
    if not url or len(key) < 32:
        sys.exit('Falta configurar %s (URL y llave de al menos 32 caracteres).' % ruta)
    return url, key


def rutas_conf(args):
    rutas = [args[i + 1] for i, a in enumerate(args) if a == '--conf' and i + 1 < len(args)]
    if not rutas and os.environ.get('ERRORS_CONF'):
        rutas = [r for r in os.environ['ERRORS_CONF'].split(':') if r]
    return [pathlib.Path(os.path.expanduser(r)) for r in rutas] if rutas else [CONF]


def http_json(url, key, cuerpo, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(cuerpo, ensure_ascii=False).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 'sin conexión', {'error': str(getattr(e, 'reason', e))[:200]}


NOMBRE_TIPO = {
    'turno_fallido': 'Turno fallido', 'puente_hilos': 'Puente de hilos', 'sesion_vencida': 'Sesión vencida',
    'limite_uso': 'Límite de uso', 'conector_caido': 'Conector caído',
    'congelado_confirmacion': 'Congelado en una confirmación', 'sin_entregar': 'Mensajes sin contestar',
    'recibe_no_envia': 'Recibe pero no envía', 'puente_caido': 'Puente sin conexión',
    'herramienta': 'Herramienta fallida', 'automatizacion': 'Automatización programada', 'otro': 'Otro',
}


def mensaje_aviso(items, url_panel):
    """Markdown estándar (en SynerLink los saltos sencillos se pegan: viñetas con «- »)."""
    nuevos = [i for i in items if i.get('nuevo')]
    lineas = ['🚨 **Errores de IA en la flota** — %s' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), '']
    if nuevos:
        lineas.append('**%d error(es) nuevo(s)** y %d que se repite(n):' % (len(nuevos), len(items) - len(nuevos)))
    else:
        lineas.append('**%d error(es) de severidad alta que siguen pasando:**' % len(items))
    lineas.append('')
    for i in items[:15]:
        amb = '' if i.get('ambiente') == 'prod' else ' (pruebas)'
        conv = ' · conversación %s' % i['idConversacion'] if i.get('idConversacion') else ''
        lineas.append('- %s **%s**%s — %s: %s (×%s)%s' % (
            '🔴' if i.get('severidad') == 'alta' else '🟠', i.get('agente'), amb,
            NOMBRE_TIPO.get(i.get('tipo'), i.get('tipo')), i.get('titulo', '')[:160], i.get('ocurrencias', 1), conv))
    if len(items) > 15:
        lineas.append('- … y %d más.' % (len(items) - 15))
    lineas += ['', 'Detalle, resolver o silenciar: %s' % url_panel]
    return '\n'.join(lineas)


def avisar(items, url_panel):
    """POST directo a SynerLink PRODUCCIÓN, conversación 1, con la llave del canal synerlink-prod de horus."""
    canal = leer_env(CANAL_PROD)
    base, key = canal.get('SYNERLINK_BASE_URL', '').rstrip('/'), canal.get('SYNERLINK_AGENT_KEY', '')
    if not base or not key:
        return False, 'sin la configuración del canal synerlink-prod'
    code, body = http_json(base + '/api/chat/agent/messages', key,
                           {'idConversation': CONVERSACION_AVISOS, 'body': mensaje_aviso(items, url_panel)}, timeout=60)
    return code in (200, 201), 'HTTP %s %s' % (code, json.dumps(body, ensure_ascii=False)[:200])


def log(msg):
    print('%s %s' % (datetime.datetime.now().isoformat(timespec='seconds'), msg), flush=True)


def main():
    args = sys.argv[1:]
    solo = set(args[args.index('--solo') + 1].split(',')) if '--solo' in args else None
    ensayo = '--ensayo' in args
    sin_avisos = '--sin-avisos' in args
    horas = float(args[args.index('--horas') + 1]) if '--horas' in args else 72.0
    desde = time.time() - horas * 3600
    destinos = [] if ensayo else [leer_conf(r) for r in rutas_conf(args)]

    eventos = []
    por_equipo = {}
    for a in FLOTA['agentes']:
        por_equipo.setdefault(a['host'], []).append(a)
    for alias, lista in por_equipo.items():
        if solo and alias not in solo:
            continue
        etiqueta = FLOTA['equipos'].get(alias, alias)
        datos, err = leer_equipo(alias, lista, desde)
        if datos is None:
            log('%s: no se pudo leer (%s)' % (etiqueta, err))
            eventos.append({'agente': 'flota', 'tipo': 'otro', 'severidad': 'media', 'ambiente': 'prod',
                            'titulo': 'No se pudo leer el equipo %s: %s' % (etiqueta, err), 'host': etiqueta,
                            'clave': 'equipo|%s|%s' % (alias, time.strftime('%Y-%m-%dT%H', time.gmtime())),
                            'ocurrioEn': iso(time.time())})
            continue
        for e in datos:
            e['host'] = etiqueta
        log('%s: %d ocurrencia(s)' % (etiqueta, len(datos)))
        eventos += datos
    if not solo or 'local' in solo:
        fp = eventos_fleet_ping()
        for e in fp:
            e['host'] = e.get('host') or 'fleet-ping'
        log('fleet-ping: %d ocurrencia(s)' % len(fp))
        eventos += fp

    if ensayo:
        grupos = {}
        for e in eventos:
            k = (e['agente'], e['tipo'], e['ambiente'], re.sub(r'\d+', 'N', e['titulo'].lower())[:120])
            g = grupos.setdefault(k, [0, e])
            g[0] += 1
        for (ag, tipo, amb, _), (n, e) in sorted(grupos.items(), key=lambda x: -x[1][0]):
            print('%-11s %-22s %-7s %-5s ×%-4d %s' % (ag, tipo, amb, e['severidad'], n, e['titulo'][:110]))
        log('ensayo: %d ocurrencias en %d errores agrupados (no se publicó nada)' % (len(eventos), len(grupos)))
        return

    for url, key in destinos:
        notificar = []
        for i in range(0, max(len(eventos), 1), LOTE):
            lote = eventos[i:i + LOTE]
            code, body = http_json(url + '/api/chat/auditoria/errores', key,
                                   {'host': 'Mac de Horus', 'version': VERSION, 'eventos': lote}, timeout=240)
            log('→ %s: lote %d (%d) HTTP %s nuevos=%s errores_nuevos=%s' % (
                url, i // LOTE + 1, len(lote), code, body.get('eventosNuevos'), body.get('erroresNuevos')))
            if code != 200:
                log('   %s' % json.dumps(body, ensure_ascii=False)[:300])
                break
            notificar += body.get('notificar') or []
        if notificar and not sin_avisos:
            ok, det = avisar(notificar, url + '/process/chat/auditoria/errores')
            log('aviso de %d error(es) a SynerLink prod (conv %d): %s %s' % (
                len(notificar), CONVERSACION_AVISOS, 'enviado' if ok else 'NO enviado', det))
            if ok:
                code, body = http_json(url + '/api/chat/auditoria/errores', key,
                                       {'accion': 'acuse', 'huellas': [n['huella'] for n in notificar]})
                log('acuse → %s: HTTP %s %s' % (url, code, body.get('acusados')))


if __name__ == '__main__':
    main()
