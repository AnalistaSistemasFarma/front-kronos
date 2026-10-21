#!/usr/bin/env python3
"""
RECOLECTOR DEL INVENTARIO DE AGENTES — Auditoría de agentes → Inventario (F1).

Corre en la Mac de horus. Por SSH (llave de horus, BatchMode) lee en cada
equipo de la flota la configuración de los agentes REGISTRADOS en SynerLink
(scripts/agent-inventory/flota.json) y publica el resultado en
POST /api/chat/auditoria/inventario con la llave propia del recolector.

USO:
    recolector.py --nocturno        # escaneo completo (launchd, cada noche)
    recolector.py --ronda           # toma una solicitud "Re-escanear" pendiente, si hay
    recolector.py --ensayo          # escanea e imprime el JSON, SIN publicar
    recolector.py --ensayo --solo horus,cosmo

CONFIGURACIÓN (fuera del repo, chmod 600):
    ~/.horus/agent-inventory/collector.env
        SYNERLINK_INVENTORY_URL=http://192.168.11.230:3030     # PRUEBAS
        SYNERLINK_INVENTORY_KEY=<llave del recolector, ≥32 caracteres>

DATOS DE EJECUCIÓN (1.1.0, hoja de vida completa, 2026-10-20): por agente,
`runtime` con el modo de autenticación y la HUELLA de la credencial (12 hex
del sha256, calculada en el equipo; el valor nunca sale de ahí), la hora de
arranque del servicio, la última rotación semanal de sesión
(~/.fleet-rotacion/resultados), la huella de los archivos de personalidad
(CLAUDE.md / AGENTS.md, SOUL.md, IDENTITY.md), los bloques
<!-- GOBIERNO-IA-… --> con su texto (reglas, no conversaciones) y si tiene el
hook que reporta su consumo. Nunca se lee una conversación ni un transcript.

SOLO LECTURA Y SIN SECRETOS (decisión de Nicolás, 2026-10-02):
  - No escribe, no reinicia y no instala nada en los equipos.
  - Nunca lee ni envía valores de .env, tokens, contraseñas ni encabezados de
    autenticación: de un MCP solo salen su nombre, su destino (host:puerto/ruta,
    sin consulta) y si el servidor EXIGE credencial, que se averigua llamando
    `initialize` SIN credencial (lo mismo que hace recolectar-conectores.sh).
    Si responde 200, además se pide `tools/list` sin credencial para saber si
    tiene herramientas de escritura. Ninguna herramienta se invoca.
  - El endpoint vuelve a pasar todo por un filtro anti-credenciales
    (lib/agent-audit/inventory.ts).

Reúsa la lógica de los recolectores de solo lectura de
~/brain/auditoria-agentes-ia/references/scripts/ (recolectar-claude-code.sh,
recolectar-openclaw.sh, recolectar-conectores.sh) y el patrón SSH de
scripts/agent-skills-catalog.py.
"""
import datetime
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request

AQUI = pathlib.Path(__file__).resolve().parent
FLOTA = json.loads((AQUI / 'flota.json').read_text(encoding='utf-8'))
CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))
VERSION = '1.1.0'

# ── Escáner remoto ──────────────────────────────────────────────────────────
# Se ejecuta en cada equipo con `python3 -` (stdlib, sin instalar nada).
# Recibe por argv el JSON con los agentes de ese equipo y el catálogo.
SCAN = r'''
import json, os, glob, re, sys, subprocess, urllib.request, urllib.error, hashlib, datetime, sqlite3
H = os.path.expanduser('~')
cfg = json.loads(sys.argv[1])
CAT = cfg['conectores']
ESCRITURA = re.compile(r'(create|update|delete|patch|insert|write|send|upload|batch|action|resolve|categoriz|_set_|^set_|add_|remove|cancel|close|move|mark|reply|subir|borrar|crear|actualizar|eliminar|aprobar|post_)', re.I)

def leer_json(p):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return None

def leer(p):
    try:
        with open(p, encoding='utf-8', errors='ignore') as f: return f.read()
    except Exception: return ''

try:
    LAUNCHD = subprocess.run(['launchctl', 'list'], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL).stdout.splitlines()
except Exception:
    LAUNCHD = []

def servicio(patron):
    rx = re.compile(patron)
    for l in LAUNCHD:
        p = l.split('\t')
        if len(p) == 3 and rx.search(p[2]):
            return 'activo' if p[0].strip().isdigit() else 'detenido'
    return 'sin-servicio'

def pid_de(patron):
    rx = re.compile(patron)
    for l in LAUNCHD:
        p = l.split('\t')
        if len(p) == 3 and rx.search(p[2]) and p[0].strip().isdigit():
            return p[0].strip()
    return None

def arranque(pid):
    """Hora UTC (ISO) en que arrancó el proceso, a partir de su tiempo transcurrido."""
    if not pid: return None
    try:
        et = subprocess.run(['ps', '-o', 'etime=', '-p', pid], capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL).stdout.strip()
    except Exception:
        return None
    m = re.match(r'^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$', et)
    if not m: return None
    d, h, mi, se = (int(x) if x else 0 for x in m.groups())
    seg = ((d * 24 + h) * 60 + mi) * 60 + se
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=seg)
    return t.replace(microsecond=0).isoformat()

def huella(valor):
    """12 hex del sha256. Es lo ÚNICO que sale de una credencial."""
    return hashlib.sha256(valor.encode('utf-8')).hexdigest()[:12] if valor else None

def env_valor(path, nombre):
    """Valor de UNA variable de un .env, solo para calcular su huella aquí mismo."""
    try:
        with open(path, encoding='utf-8-sig', errors='ignore') as f:
            for linea in f:
                linea = linea.strip()
                if linea.startswith('export '): linea = linea[7:].strip()
                if linea.startswith(nombre + '='):
                    v = linea.split('=', 1)[1].strip()
                    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'': v = v[1:-1]
                    return v or None
    except Exception:
        pass
    return None

def ultima_rotacion(nombres):
    """Último resultado de la rotación semanal de sesión (~/.fleet-rotacion/resultados/<fecha>/<bot>.json)."""
    base = os.path.join(H, '.fleet-rotacion', 'resultados')
    for fecha in sorted(glob.glob(os.path.join(base, '*')), reverse=True)[:20]:
        for n in nombres:
            d = leer_json(os.path.join(fecha, n + '.json'))
            if not isinstance(d, dict): continue
            cuando = None
            try:
                cuando = datetime.datetime.strptime(str(d.get('fecha', ''))[:25], '%Y-%m-%d %H:%M:%S %z').astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                cuando = os.path.basename(fecha) + 'T12:00:00+00:00' if re.match(r'^\d{4}-\d{2}-\d{2}$', os.path.basename(fecha)) else None
            det = [x for x in (('sesión ' + str(d.get('antes')) + ' → ' + str(d.get('desp'))) if d.get('antes') else None,
                               ('traspaso: ' + str(d.get('traspaso'))) if d.get('traspaso') else None) if x]
            return {'at': cuando, 'status': str(d.get('estado') or 'sin estado')[:30], 'detail': '; '.join(det)[:300] or None}
    return None

RX_GOB = re.compile(r'<!--\s*(GOBIERNO-IA[A-Z0-9-]*)\s*:?([^>]*?)-->(.*?)<!--\s*/\s*\1\s*-->', re.S)

def bloques_gobierno(textos):
    out = []
    for nombre, t in textos:
        for m in RX_GOB.finditer(t or ''):
            meta = m.group(2) or ''
            f = re.search(r'(\d{4}-\d{2}-\d{2})', meta)
            c = re.search(r'#\s*(\d{3,8})', meta)
            a = re.search(r'\(\s*([A-Za-z0-9_.-]+)\s*[,)]', meta)
            out.append({'marker': m.group(1), 'addedOn': f.group(1) if f else None, 'author': a.group(1) if a else None,
                        'caseRef': int(c.group(1)) if c else None, 'text': m.group(3).strip()[:2000], 'file': nombre})
    return out[:8]

def persona(archivos):
    """Huella conjunta de los archivos de personalidad que existan (y sus textos para buscar bloques)."""
    h = hashlib.sha256(); vistos = []; textos = []
    for ruta in archivos:
        if ruta and os.path.isfile(ruta):
            t = leer(ruta)
            h.update(os.path.basename(ruta).encode() + b'\0' + t.encode('utf-8', 'ignore') + b'\0')
            vistos.append(os.path.basename(ruta)); textos.append((os.path.basename(ruta), t))
    return (h.hexdigest()[:12] if vistos else None), vistos, textos

def destino(url):
    return re.split(r'[?#]', url or '')[0] or None

def hostport(url):
    m = re.match(r'^[a-z]+://(?:[^@/]+@)?([^/:]+)(?::(\d+))?', url or '', re.I)
    if not m: return None
    return '%s:%s' % (m.group(1), m.group(2) or ('443' if url.lower().startswith('https') else '80'))

SONDEO = {}
def rpc(url, metodo, rid, sesion=None):
    body = json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': metodo,
        'params': ({'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'inventario-solo-lectura', 'version': '1'}} if metodo == 'initialize' else {})}).encode()
    h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
    if sesion: h['Mcp-Session-Id'] = sesion
    req = urllib.request.Request(url, data=body, headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return r.status, r.headers.get('Mcp-Session-Id'), r.read(400000).decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, None, ''
    except Exception:
        return None, None, ''

def sondear(url):
    """initialize SIN credencial; si es 200, tools/list SIN credencial. Nunca se invoca una herramienta."""
    url = destino(url)
    if url in SONDEO: return SONDEO[url]
    res = {'auth': 'desconocida', 'tools': None}
    code, sesion, _ = rpc(url, 'initialize', 1)
    if code in (401, 403): res['auth'] = 'requerida'
    elif code == 200:
        res['auth'] = 'ninguna'
        c2, _, txt = rpc(url, 'tools/list', 2, sesion)
        if c2 == 200:
            nombres = []
            for linea in txt.splitlines() or [txt]:
                linea = linea[5:].strip() if linea.startswith('data:') else linea.strip()
                if not linea.startswith('{'): continue
                try: d = json.loads(linea)
                except Exception: continue
                for t in ((d.get('result') or {}).get('tools') or []):
                    if isinstance(t, dict) and t.get('name'): nombres.append(t['name'])
            if not nombres and txt.strip().startswith('{'):
                try:
                    for t in (json.loads(txt).get('result') or {}).get('tools') or []: nombres.append(t.get('name'))
                except Exception: pass
            res['tools'] = [n for n in nombres if n]
    SONDEO[url] = res
    return res

EMPRESAS = [('onelatampharma', 'OneLATAM Pharma'), ('olp', 'OneLATAM Pharma'), ('farmalogica', 'Farmalogica'),
            ('ryan', 'Laboratorios Ryan'), ('abamia', 'Abamia'), ('kelab', 'Kelab'), ('meditrack', 'Meditrack'),
            ('unidossis', 'UNIDOSSIS'), ('gss', 'GSS')]
def empresa_por_nombre(n):
    n = (n or '').lower()
    for k, v in EMPRESAS:
        if re.search(r'(^|[-_])' + k + r'($|[-_])', n): return v
    return None

def mcp(nombre, v):
    v = v if isinstance(v, dict) else {}
    url = v.get('url')
    tipo = (v.get('type') or v.get('transport') or ('http' if url else ('stdio' if v.get('command') else ''))).lower()
    transport = 'http' if ('http' in tipo) else ('sse' if tipo == 'sse' else ('stdio' if tipo == 'stdio' else 'desconocido'))
    out = {'name': nombre, 'transport': transport, 'target': None, 'company': empresa_por_nombre(nombre),
           'access': 'desconocido', 'auth': 'desconocida', 'writeTools': []}
    if url:
        out['target'] = destino(url)
        hp = hostport(url)
        cat = CAT.get(hp) if hp else None
        if cat:
            out['company'] = cat.get('empresa') or out['company']
            out['access'] = cat.get('acceso') or out['access']
        s = sondear(url)
        out['auth'] = s['auth']
        if s['tools'] is not None:
            esc = [t for t in s['tools'] if ESCRITURA.search(t)]
            out['writeTools'] = esc[:60]
            out['access'] = 'escritura' if esc else 'lectura'
    else:
        # stdio: proceso local del agente, no expuesto en la red. Solo el
        # ejecutable y el paquete (sin argumentos que puedan traer llaves).
        cmd = os.path.basename(str(v.get('command') or ''))
        SUB = ('run', 'exec', 'x', 'dlx', 'node', 'python', 'python3', 'uvx', 'npx')
        pkg = next((os.path.basename(str(a)) for a in (v.get('args') or [])
                    if isinstance(a, str) and not a.startswith('-') and '=' not in a and a not in SUB), '')
        out['target'] = (cmd + (' ' + pkg if pkg else '')).strip() or None
        out['auth'] = 'local'
    return out

def skills_de(dirs):
    s = set()
    for d in dirs:
        for p in glob.glob(d):
            if os.path.isfile(os.path.join(p, 'SKILL.md')): s.add(os.path.basename(p.rstrip('/')))
    return sorted(s, key=str.lower)

POLITICA = {'allowlist': 'lista-blanca', 'pairing': 'emparejamiento', 'open': 'abierta', 'disabled': 'lista-blanca'}

def claude_code(a):
    base = os.path.join(H, a['dir']); C = os.path.join(base, 'claude-config')
    r = {'code': a['code'], 'kind': 'claude-code', 'location': '~/' + a['dir']}
    if not os.path.isdir(C):
        r['error'] = 'No se encontró la configuración del agente en este equipo.'; return r
    nombre = a['dir'].lstrip('.')
    r['serviceStatus'] = servicio(r'\.' + re.escape(nombre) + r'$')
    run = leer(os.path.join(base, 'run.sh'))
    ag = leer_json(os.path.join(base, 'agent.json')) or {}
    st = leer_json(os.path.join(C, 'settings.json')) or {}
    perm = st.get('permissions') or {}
    flags = json.dumps(ag.get('flags') or '')
    sin = ('dangerously-skip-permissions' in run or 'bypassPermissions' in run or 'dangerously-skip-permissions' in flags
           or 'bypassPermissions' in flags or perm.get('defaultMode') == 'bypassPermissions')
    r['execMode'] = 'sin-aprobacion' if sin else 'con-aprobacion'
    r['execRequiresApproval'] = not sin
    m = re.search(r'--model[ =]+["\']?([\w.\-\[\]]+)', run)
    r['model'] = (m.group(1) if m else None) or st.get('model') or ag.get('model')
    r['tools'] = {'allow': [str(x) for x in (perm.get('allow') or [])][:300], 'deny': [str(x) for x in (perm.get('deny') or [])][:300]}
    cj = leer_json(os.path.join(C, '.claude.json')) or {}
    servers = dict(cj.get('mcpServers') or {})
    mm = re.search(r'--mcp-config[ =]+["\']?([^\s"\']+)', run)
    if mm:
        extra = leer_json(os.path.expanduser(mm.group(1).replace('$HOME', H))) or {}
        for k, v in (extra.get('mcpServers') or {}).items(): servers.setdefault(k, v)
    r['mcps'] = [mcp(k, v) for k, v in sorted(servers.items())]
    r['skills'] = skills_de([os.path.join(C, 'skills', '*'), os.path.join(C, 'plugins', 'cache', '**', 'skills', '*')])
    canales = []
    for acc in sorted(glob.glob(os.path.join(C, 'channels', '*', 'access.json'))):
        tipo = acc.split('/')[-2]; x = leer_json(acc) or {}
        allowed = len(x.get('allowFrom') or []) + len(x.get('groups') or {})
        canales.append({'type': tipo, 'policy': POLITICA.get(str(x.get('dmPolicy')), 'desconocida'), 'allowed': allowed,
                        'detail': 'mensajes directos: %s; grupos: %d' % (x.get('dmPolicy') or 'sin definir', len(x.get('groups') or {}))})
    vistos = {c['type'] for c in canales}
    if 'synerlink' not in vistos and (os.path.isdir(os.path.join(C, 'channels', 'synerlink')) or any('synerlink' in k for k in servers)):
        canales.append({'type': 'synerlink', 'policy': 'lista-blanca', 'allowed': None, 'detail': 'Acceso por el permiso del agente en SynerLink'})
    r['channels'] = canales
    # ── Datos de ejecución (hoja de vida completa) ──
    envp = os.path.join(base, '.env')
    tok = env_valor(envp, 'CLAUDE_CODE_OAUTH_TOKEN'); api = None if tok else env_valor(envp, 'ANTHROPIC_API_KEY')
    # Carpeta de trabajo (vault) del bot: agent.json → vault_path, o VAULT_PATH= de run.sh.
    m_v = re.search(r'^\s*VAULT_PATH=["\']?([^"\'\n]+)', run, re.M)
    vault = ag.get('vault_path') or (m_v.group(1).strip() if m_v else None)
    vault = os.path.expanduser(str(vault).replace('${HOME}', H).replace('$HOME', H)) if vault else None
    fp, archivos, textos = persona([os.path.join(vault, 'CLAUDE.md') if vault else None, os.path.join(vault, 'GOBIERNO.md') if vault else None,
                                    os.path.join(C, 'CLAUDE.md')])
    rot = ultima_rotacion([nombre, a['code']])
    r['runtime'] = {
        'authMode': 'token' if tok else ('api-key' if api else 'oauth-llavero'),
        'authDetail': 'CLAUDE_CODE_OAUTH_TOKEN en .env' if tok else ('ANTHROPIC_API_KEY en .env' if api else 'sin token en .env: usa la sesión del llavero'),
        'tokenFingerprint': huella(tok or api),
        'processStartedAt': arranque(pid_de(r'\.' + re.escape(nombre) + r'$')),
        'lastRotationAt': rot['at'] if rot else None,
        'lastRotationStatus': rot['status'] if rot else None,
        'lastRotationDetail': rot['detail'] if rot else None,
        'personaFingerprint': fp, 'personaFiles': archivos,
        'governance': bloques_gobierno(textos),
        'usageHook': 'synerlink_audit_usage' in json.dumps(st.get('hooks') or {}),
    }
    return r

def openclaw(a):
    perfil = a.get('profile')
    OC = os.path.join(H, '.openclaw' + ('-' + perfil if perfil else ''))
    r = {'code': a['code'], 'kind': 'openclaw', 'location': '~/' + os.path.basename(OC) + ' · agente ' + a['agent']}
    d = leer_json(os.path.join(OC, 'openclaw.json'))
    if d is None:
        r['error'] = 'No se encontró la configuración de openclaw en este equipo.'; return r
    ags = d.get('agents') or {}
    lista = ags.get('list') if isinstance(ags.get('list'), list) else []
    ent = next((x for x in lista if isinstance(x, dict) and x.get('id') == a['agent']), None)
    if ent is None and isinstance(ags.get('entries'), dict): ent = ags['entries'].get(a['agent'])
    ent = ent or {}
    dfl = ags.get('defaults') or {}
    mod = ent.get('model') or dfl.get('model')
    r['model'] = mod.get('primary') if isinstance(mod, dict) else mod
    gw = servicio(r'^ai\.openclaw\.gateway$')
    br = a.get('bridge')
    if br:
        bs = servicio(r'synerlink-bridge-?' + re.escape(br.replace('synerlink-bridge', '').lstrip('-')) + r'(-prod|-production)?$') if br != 'synerlink-bridge' else servicio(r'\.synerlink-bridge(-prod)?$')
        r['serviceStatus'] = 'activo' if 'activo' in (gw, bs) else (bs if bs != 'sin-servicio' else gw)
    else:
        r['serviceStatus'] = gw
    t = dict(d.get('tools') or {}); t.update(ent.get('tools') or {})
    ex = t.get('exec') or {}
    modo = ex.get('mode'); seg = ex.get('security', 'full'); ask = ex.get('ask', 'off')
    if modo == 'full' or (not modo and seg == 'full' and ask != 'always'):
        r['execMode'] = 'sin-aprobacion'; r['execRequiresApproval'] = False
    elif ask == 'always':
        r['execMode'] = 'con-aprobacion'; r['execRequiresApproval'] = True
    else:
        r['execMode'] = 'restringido'; r['execRequiresApproval'] = True
    r['tools'] = {'allow': [str(x) for x in (t.get('allow') or [])][:300], 'deny': [str(x) for x in (t.get('deny') or [])][:300]}
    servers = ((d.get('mcp') or {}).get('servers') or {})
    r['mcps'] = [mcp(k, v) for k, v in sorted(servers.items())]
    ws = ent.get('workspace') or dfl.get('workspace') or os.path.join(OC, 'workspace')
    r['skills'] = skills_de([os.path.join(ws, 'skills', '*'), os.path.join(OC, 'plugin-skills', '*'),
                             os.path.join(OC, 'agents', a['agent'], 'skills', '*')])
    canales = []
    tg = ((d.get('channels') or {}).get('telegram') or {})
    cuentas = tg.get('accounts') or {}
    for b in d.get('bindings') or []:
        if not isinstance(b, dict) or b.get('agentId') != a['agent']: continue
        mt = b.get('match') or {}
        ch = mt.get('channel') or 'desconocido'
        acc = (((d.get('channels') or {}).get(ch) or {}).get('accounts') or {}).get(mt.get('accountId')) or {}
        canales.append({'type': ch, 'policy': POLITICA.get(str(acc.get('dmPolicy')), 'desconocida'),
                        'allowed': len(acc.get('allowFrom') or []) or None,
                        'detail': 'cuenta %s · mensajes directos: %s%s' % (mt.get('accountId'), acc.get('dmPolicy') or 'sin definir', '' if acc.get('enabled', True) else ' (apagada)')})
    if br and (glob.glob(os.path.join(H, br, '*', '.env')) + glob.glob(os.path.join(H, br, '.env')) + glob.glob(os.path.join(H, 'synerlink-bridge', br, '.env')) + glob.glob(os.path.join(H, 'synerlink-bridge', br, '*', '.env'))):
        canales.append({'type': 'synerlink', 'policy': 'lista-blanca', 'allowed': None, 'detail': 'Puente SynerLink ⇄ openclaw; acceso por el permiso del agente'})
    r['channels'] = canales
    # ── Datos de ejecución (hoja de vida completa) ──
    agdir = os.path.join(OC, 'agents', a['agent'], 'agent')
    perfiles = {}
    try:
        db = os.path.join(agdir, 'openclaw-agent.sqlite')
        if os.path.isfile(db):
            cx = sqlite3.connect('file:%s?mode=ro' % db, uri=True, timeout=3)
            for (j,) in cx.execute("select store_json from auth_profile_store where store_key='primary'"):
                perfiles = (json.loads(j) or {}).get('profiles') or {}
            cx.close()
    except Exception:
        perfiles = {}
    if not perfiles:
        perfiles = (leer_json(os.path.join(agdir, 'auth-profiles.json')) or {}).get('profiles') or {}
    nombre_p, valor = None, None
    for k, v in perfiles.items() if isinstance(perfiles, dict) else []:
        if isinstance(v, dict):
            cand = v.get('token') or v.get('key') or v.get('apiKey') or v.get('access')
            if isinstance(cand, str) and cand:
                nombre_p, valor = k, cand; break
    pid = None
    if br:
        pid = pid_de(r'synerlink-bridge-?' + re.escape(br.replace('synerlink-bridge', '').lstrip('-')) + r'(-prod|-production)?$') if br != 'synerlink-bridge' else pid_de(r'\.synerlink-bridge(-prod)?$')
    fp, archivos, textos = persona([os.path.join(ws, n) for n in ('AGENTS.md', 'SOUL.md', 'IDENTITY.md')])
    rot = ultima_rotacion([a['code'], a['agent']])
    r['runtime'] = {
        'authMode': 'perfil-openclaw' if valor else 'desconocido',
        'authDetail': ('perfil ' + nombre_p) if nombre_p else None,
        'tokenFingerprint': huella(valor),
        'processStartedAt': arranque(pid or pid_de(r'^ai\.openclaw\.gateway$')),
        'lastRotationAt': rot['at'] if rot else None,
        'lastRotationStatus': rot['status'] if rot else None,
        'lastRotationDetail': rot['detail'] if rot else None,
        'personaFingerprint': fp, 'personaFiles': archivos,
        'governance': bloques_gobierno(textos),
        'usageHook': None,
    }
    valor = None
    return r

out = []
for a in cfg['agentes']:
    try:
        out.append(claude_code(a) if a['kind'] == 'claude-code' else openclaw(a))
    except Exception as e:
        out.append({'code': a['code'], 'kind': a['kind'], 'error': 'Error leyendo la configuración: %s' % type(e).__name__})
print(json.dumps(out, ensure_ascii=False))
'''


def escanear_equipo(alias, agentes):
    arg = json.dumps({'agentes': agentes, 'conectores': {k: v for k, v in FLOTA['conectores'].items() if not k.startswith('_')}})
    if alias == 'local':
        cmd = ['python3', '-', arg]
    else:
        # El JSON va como un solo argumento, citado para el shell remoto.
        cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 - ' + sh_quote(arg)]
    try:
        r = subprocess.run(cmd, input=SCAN, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        return None, 'tiempo agotado'
    if r.returncode != 0:
        return None, (r.stderr.strip().splitlines() or ['sin conexión'])[-1][:200]
    try:
        return json.loads(r.stdout), None
    except Exception:
        return None, 'respuesta ilegible del escáner'


def sh_quote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def escanear(solo=None):
    por_equipo = {}
    for a in FLOTA['agentes']:
        if solo and a['code'] not in solo:
            continue
        por_equipo.setdefault(a['host'], []).append(a)
    agentes, errores = [], []
    for alias, lista in por_equipo.items():
        etiqueta = FLOTA['equipos'].get(alias, alias)
        filas, err = escanear_equipo(alias, lista)
        if filas is None:
            errores.append('%s: %s' % (etiqueta, err))
            for a in lista:
                agentes.append({'code': a['code'], 'kind': a['kind'], 'host': etiqueta,
                                'error': 'No se pudo conectar con %s (%s).' % (etiqueta, err)})
            continue
        for f in filas:
            f['host'] = etiqueta
            agentes.append(f)
    return agentes, errores


def leer_conf():
    conf = {}
    if CONF.exists():
        for linea in CONF.read_text().splitlines():
            if '=' in linea and not linea.lstrip().startswith('#'):
                k, v = linea.split('=', 1)
                conf[k.strip()] = v.strip().strip('"')
    url = conf.get('SYNERLINK_INVENTORY_URL', '').rstrip('/')
    key = conf.get('SYNERLINK_INVENTORY_KEY', '')
    if not url or len(key) < 32:
        sys.exit('Falta configurar %s (URL y llave de al menos 32 caracteres).' % CONF)
    return url, key


def llamar(url, key, ruta, cuerpo):
    req = urllib.request.Request(url + ruta, data=json.dumps(cuerpo).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            return e.code, {}


def log(msg):
    print('%s %s' % (datetime.datetime.now().isoformat(timespec='seconds'), msg), flush=True)


def main():
    args = sys.argv[1:]
    solo = None
    if '--solo' in args:
        solo = set(args[args.index('--solo') + 1].split(','))

    if '--ensayo' in args:
        agentes, errores = escanear(solo)
        print(json.dumps({'agents': agentes, 'errors': errores}, ensure_ascii=False, indent=1))
        return

    url, key = leer_conf()
    scan_id = None
    if '--ronda' in args:
        code, body = llamar(url, key, '/api/chat/auditoria/inventario/solicitudes', {})
        if code != 200:
            log('no se pudo consultar solicitudes: HTTP %s' % code)
            sys.exit(1)
        sol = body.get('solicitud')
        if not sol:
            return  # nada pendiente: silencio, corre cada pocos minutos
        scan_id = sol['id']
        log('tomada la solicitud #%s' % scan_id)
    elif '--nocturno' not in args:
        sys.exit(__doc__)

    inicio = datetime.datetime.now(datetime.timezone.utc).isoformat()
    agentes, errores = escanear(solo)
    cuerpo = {'collector': {'host': socket.gethostname(), 'version': VERSION}, 'startedAt': inicio,
              'agents': agentes, 'errors': errores}
    if scan_id:
        cuerpo['scanRequestId'] = scan_id
    code, body = llamar(url, key, '/api/chat/auditoria/inventario', cuerpo)
    if code != 200:
        log('publicación rechazada: HTTP %s %s' % (code, body.get('error', '')))
        sys.exit(1)
    log('publicado: solicitud #%s, %d agentes guardados, ignorados: %s, novedades: %s' % (
        body.get('scanRequestId'), len(body.get('guardados') or []), body.get('ignorados') or 'ninguno', errores or 'ninguna'))


if __name__ == '__main__':
    main()
