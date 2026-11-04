#!/usr/bin/env python3
"""
RECOLECTOR DE AUTOMATIZACIONES PROGRAMADAS (Indicador de automatizaciones, 2026-11-04).

El indicador medía solo los casos de uso del chat. Este script inventaría, en SOLO
LECTURA, lo que cada agente corre solo en su equipo (launchd, cron y openclaw cron) y lo
publica en SynerLink (POST /api/chat/auditoria/automatizaciones/programadas) con la llave
del recolector del inventario, en los mismos destinos que el analizador:
~/.horus/agent-inventory/collector.env (PRUEBAS) y, si existe, collector-prod.env
(PRODUCCIÓN); o --conf (repetible) / AUTOMATION_CONF.

  python3 programadas.py            # recolecta y publica en todos los destinos
  python3 programadas.py --ensayo   # recolecta y muestra el JSON; no publica
  python3 programadas.py --tabla    # recolecta y muestra una tabla Markdown; no publica

Qué lee y cómo (todo por SSH con BatchMode, sin escribir nada en los equipos):
  - ~/Library/LaunchAgents/*.plist: solo las llaves Label, ProgramArguments, Program,
    StartCalendarInterval, StartInterval, Disabled y StandardOutPath, con `plutil -extract`
    (nunca EnvironmentVariables: ahí viven tokens).
  - `launchctl list` (cargada o no, último código de salida).
  - `crontab -l` (solo las líneas con ruta dentro de la carpeta de un agente).
  - openclaw: ~/.openclaw*/cron/jobs.json y ~/.openclaw*/cron/runs/*.jsonl.
  - Los logs de cada automatización (las últimas ~25 MB) y, para la producción, solo las
    fechas de los archivos que genera (stat), nunca su contenido.
NUNCA carga, descarga ni ejecuta nada de los agentes.

Qué es «de un agente» y qué es infraestructura: flota.json (carpeta y código de cada
agente) + EXCLUIR (patrones de infraestructura). El detalle de cada automatización
conocida (qué hace en lenguaje simple, cómo leer su log y su producción) está en
programadas-catalogo.json, junto a este script. Una automatización nueva que no esté en el
catálogo igual se publica, con lo que se pueda saber de launchd (estado y última salida).
"""
import datetime as dt, glob as globmod, json, os, pathlib, re, shlex, subprocess, sys, urllib.error, urllib.request

AQUI = pathlib.Path(__file__).resolve().parent
CATALOGO = AQUI / 'programadas-catalogo.json'
FLOTA = next((p for p in [pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/flota.json')),
                          AQUI.parent / 'agent-inventory' / 'flota.json'] if p.exists()), None)
CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))            # PRUEBAS
CONF_PROD = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector-prod.env'))  # PRODUCCIÓN (opcional)
COT = dt.timezone(dt.timedelta(hours=-5))  # hora de Colombia (los Mac de la flota están en COT)
MAX_LOG = 25 * 1024 * 1024
# Muestras propias para los logs SIN fecha (se cuentan las corridas nuevas entre pasadas).
ESTADO = pathlib.Path(os.path.expanduser('~/.horus/agent-automation/programadas-estado.json'))

# Infraestructura de la flota: no son automatizaciones de negocio.
EXCLUIR = [
    r'\.learn$', r'\.curador$', r'rotacion|rotate|session-rotat|semanal-sesion', r'bridge|puente|hilos',
    r'fleet-ping|internal-ping', r'agent-inventory|agent-automation|agent-errors|agent-cv|agent-memories',
    r'watchdog|monitor|usage|keepalive|healthcheck|vigilante', r'disable-autoupdater|autoupdate|update',
    r'cloudflared|tunnel|tunel', r'gateway', r'\.tui$', r'restart',
]


def log(m): print('%s %s' % (dt.datetime.now().isoformat(timespec='seconds'), m), file=sys.stderr, flush=True)


# ── Destinos (igual que analizador.py) ────────────────────────────────────────

def conf(ruta):
    c = {}
    for l in ruta.read_text().splitlines():
        if '=' in l and not l.lstrip().startswith('#'):
            k, v = l.split('=', 1); c[k.strip()] = v.strip().strip('"')
    url, key = c.get('SYNERLINK_INVENTORY_URL', '').rstrip('/'), c.get('SYNERLINK_INVENTORY_KEY', '')
    if not url or len(key) < 32: sys.exit('Falta configurar %s' % ruta)
    return url, key


def destinos(a):
    rutas = [a[i + 1] for i, x in enumerate(a) if x == '--conf' and i + 1 < len(a)]
    if not rutas and os.environ.get('AUTOMATION_CONF'):
        rutas = [r for r in os.environ['AUTOMATION_CONF'].split(':') if r]
    rutas = [pathlib.Path(os.path.expanduser(r)) for r in rutas] or [CONF] + ([CONF_PROD] if CONF_PROD.exists() else [])
    return [conf(r) for r in rutas]


def llamar(url, key, ruta, cuerpo):
    req = urllib.request.Request(url + ruta, data=json.dumps(cuerpo).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 'sin conexión', {'error': str(getattr(e, 'reason', e))[:200]}


# ── Acceso de solo lectura a cada equipo ─────────────────────────────────────

def sh(host, cmd, timeout=120, binario=False):
    """Corre un comando de LECTURA en el equipo (local o por SSH). Devuelve stdout (o '' si falla)."""
    # Siempre bash (el shell de login de los Mac es zsh, que aborta con un glob sin coincidencias).
    args = ['/bin/bash', '-c', cmd] if host == 'local' else \
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, '/bin/bash -c ' + shlex.quote(cmd)]
    try:
        r = subprocess.run(args, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return b'' if binario else ''
    return r.stdout if binario else r.stdout.decode('utf-8', 'replace')


def q(s):
    """Ruta para el shell remoto: ~ se expande en el equipo, lo demás va citado."""
    if s.startswith('~/'): return '"$HOME"/' + shlex.quote(s[2:])
    return shlex.quote(s)


LISTAR = r'''
for f in "$HOME"/Library/LaunchAgents/*.plist "$HOME"/Library/LaunchAgents/*.plist.disabled* "$HOME"/Library/LaunchAgents/disabled*/*.plist; do
  [ -f "$f" ] || continue
  echo "@@PLIST $f"
  for k in Label Program StartInterval Disabled StandardOutPath StandardErrorPath; do
    v=$(plutil -extract "$k" raw -o - "$f" 2>/dev/null) && echo "@@K $k $v"
  done
  for k in ProgramArguments StartCalendarInterval; do
    v=$(plutil -extract "$k" json -o - "$f" 2>/dev/null) && echo "@@J $k $v"
  done
done
echo "@@LAUNCHCTL"; launchctl list 2>/dev/null
echo "@@CRON"; crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*='
for d in "$HOME"/.openclaw*; do
  db="$d/state/openclaw.sqlite"
  [ -f "$db" ] || continue
  echo "@@OPENCLAW $d"
  sqlite3 -readonly -json "$db" "SELECT job_id AS id, name, description, enabled, agent_id AS agentId, declaration_key AS declarationKey, json_extract(job_json, '$.schedule') AS schedule FROM cron_jobs" 2>/dev/null
  echo
done
echo "@@FIN"
'''


def listar(host):
    out = sh(host, LISTAR, timeout=90)
    if '@@FIN' not in out: return None
    plists, cargados, cron, openclaw = [], {}, [], []
    sec, cur, buf = None, None, []
    for linea in out.splitlines():
        if linea.startswith('@@PLIST '):
            cur = {'archivo': linea[8:]}; plists.append(cur); sec = 'plist'; continue
        if linea.startswith('@@K ') and cur is not None:
            _, k, *v = linea.split(' ', 2); cur[k] = v[0] if v else ''; continue
        if linea.startswith('@@J ') and cur is not None:
            _, k, v = linea.split(' ', 2)
            try: cur[k] = json.loads(v)
            except ValueError: pass
            continue
        if linea == '@@LAUNCHCTL': sec = 'launchctl'; continue
        if linea == '@@CRON': sec = 'cron'; continue
        if linea.startswith('@@OPENCLAW ') or linea == '@@FIN':
            if sec == 'openclaw' and buf: openclaw.append((oc_dir, '\n'.join(buf)))
            buf = []
            if linea == '@@FIN': break
            sec, oc_dir = 'openclaw', linea[11:]; continue
        if sec == 'launchctl':
            p = linea.split('\t')
            if len(p) == 3 and p[2] != 'Label': cargados[p[2]] = {'pid': p[0], 'status': p[1]}
        elif sec == 'cron' and linea.strip():
            cron.append(linea.strip())
        elif sec == 'openclaw':
            buf.append(linea)
    jobs = []
    for d, txt in openclaw:
        try: data = json.loads(txt) if txt.strip() else []
        except ValueError: continue
        for j in data if isinstance(data, list) else []:
            if not isinstance(j, dict): continue
            try: j['schedule'] = json.loads(j['schedule']) if isinstance(j.get('schedule'), str) else j.get('schedule') or {}
            except ValueError: j['schedule'] = {}
            jobs.append(dict(j, _dir=d))
    return {'plists': plists, 'cargados': cargados, 'cron': cron, 'openclaw': jobs}


# ── Programación en palabras ──────────────────────────────────────────────────

DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']


def _dias(ws):
    ws = sorted(set(int(w) % 7 for w in ws))
    if ws == [1, 2, 3, 4, 5]: return 'De lunes a viernes'
    if ws == [1, 2, 3, 4, 5, 6]: return 'De lunes a sábado'
    if len(ws) == 7: return 'Todos los días'
    return ', '.join(DIAS[w] for w in ws).capitalize()


def programacion_launchd(p):
    if 'StartInterval' in p:
        try:
            s = int(p['StartInterval'])
            return 'Cada %d min' % (s // 60) if s < 3600 else 'Cada %g h' % (s / 3600)
        except ValueError: return None
    sci = p.get('StartCalendarInterval')
    if not sci: return None
    items = sci if isinstance(sci, list) else [sci]
    por_dias = {}
    for it in items:
        if not isinstance(it, dict): continue
        dias = 'Día %s de cada mes' % it['Day'] if 'Day' in it else \
            _dias([it['Weekday']]) if 'Weekday' in it else 'Todos los días'
        hora = '%02d:%02d' % (it.get('Hour', 0), it.get('Minute', 0)) if 'Hour' in it else \
            'cada hora (min %02d)' % it.get('Minute', 0)
        por_dias.setdefault(hora, []).append(it.get('Weekday', -1) if 'Day' not in it else -2)
    textos = []
    for hora, ws in por_dias.items():
        if -2 in ws: textos.append('Mensual %s' % hora)
        elif -1 in ws: textos.append('Todos los días %s' % hora)
        else: textos.append('%s %s' % (_dias(ws), hora))
    # Agrupar horas con los mismos días: «De lunes a viernes 13:00 y 16:00».
    grupos = {}
    for t in textos:
        d, _, h = t.rpartition(' ')
        grupos.setdefault(d, []).append(h)
    return ' · '.join('%s %s' % (d, ' y '.join(sorted(hs))) for d, hs in grupos.items())


def programacion_cron(expr):
    p = expr.split()
    if len(p) < 5: return expr
    m, h, dom, mon, dow = p[:5]
    if m.startswith('*/'): return 'Cada %s min' % m[2:]
    if h == '*': return 'Cada hora (min %s)' % m
    horas = ' y '.join('%02d:%02d' % (int(x), int(m)) for x in h.split(',') if x.isdigit()) or '%s:%s' % (h, m)
    if dom != '*': return 'Día %s de cada mes %s' % (dom, horas)
    if dow in ('*', '0-6', '0-7'): return 'Todos los días %s' % horas
    ws = []
    for parte in dow.split(','):
        if '-' in parte:
            a, b = parte.split('-'); ws += list(range(int(a), int(b) + 1))
        elif parte.isdigit(): ws.append(int(parte))
    return '%s %s' % (_dias(ws), horas) if ws else '%s (%s)' % (horas, dow)


def intervalo_esperado_h(p_launchd=None, cron=None):
    """Cada cuántas horas debería correr (para saber si dejó de correr)."""
    if p_launchd:
        if 'StartInterval' in p_launchd:
            try: return int(p_launchd['StartInterval']) / 3600
            except ValueError: return None
        sci = p_launchd.get('StartCalendarInterval')
        items = sci if isinstance(sci, list) else [sci] if sci else []
        if any(isinstance(i, dict) and 'Day' in i for i in items): return 24 * 31
        if any(isinstance(i, dict) and 'Weekday' in i for i in items):
            ws = {int(i['Weekday']) % 7 for i in items if isinstance(i, dict) and 'Weekday' in i}
            return 24 * 7 / max(1, len(ws)) if len(ws) < 5 else 24 * 3  # fines de semana sin correr
        return 24 if items else None
    if cron:
        m, h, dom, _, dow = cron.split()[:5]
        if m.startswith('*/'): return int(m[2:]) / 60
        if h == '*': return 1
        if dom != '*': return 24 * 31
        return 24 * 3 if dow not in ('*', '0-6', '0-7') else 24
    return None


# ── Corridas a partir de los logs ─────────────────────────────────────────────

def _fecha(s, fmt):
    s = s.strip()
    try:
        if fmt == 'iso':
            d = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        elif fmt == 'epoch':
            d = dt.datetime.fromtimestamp(float(s) / (1000 if float(s) > 1e11 else 1), dt.timezone.utc)
        else:
            d = dt.datetime.strptime(s, fmt)
    except (ValueError, OverflowError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=COT)


def leer_texto(host, ruta):
    return sh(host, 'tail -c %d %s 2>/dev/null' % (MAX_LOG, q(ruta)), timeout=180, binario=True).decode('utf-8', 'replace')


def corridas_bloques(texto, spec):
    """Bloques delimitados por un marcador de inicio y otro de fin (p. ej. «inicio cron» / «fin cron»)."""
    ini = re.compile(spec['inicio'])
    fin = re.compile(spec['fin']) if spec.get('fin') else None
    err = re.compile(spec['error']) if spec.get('error') else None
    okr = re.compile(spec['ok']) if spec.get('ok') else None
    rc_rx = re.compile(spec['rc']) if spec.get('rc') else None  # línea con el código de salida
    prod = re.compile(spec['produccion']) if spec.get('produccion') else None
    tras = re.compile(spec['produccion_tras']) if spec.get('produccion_tras') else None
    fmt = spec.get('formato', '%Y-%m-%d %H:%M:%S')
    runs, cur, previa, ultimas = [], None, '', []
    for linea in texto.splitlines():
        if spec.get('sin_duplicados'):  # tee -a + redirección del cron: cada línea sale dos veces seguidas
            if linea in ultimas: continue
            ultimas = [linea]
        m = ini.search(linea)
        if m:
            if cur: runs.append(cur)  # quedó sin fin
            cur = {'ts': _fecha(m.group('ts'), fmt), 'fin': False, 'err': False, 'okm': False, 'prod': 0, 'u': set()}
            previa = linea; continue
        if not cur:
            previa = linea; continue
        if err and err.search(linea): cur['err'] = True
        if okr and okr.search(linea): cur['okm'] = True
        if rc_rx:
            r = rc_rx.search(linea)
            if r and r.group('rc') != '0': cur['err'] = True
        if prod and (not tras or tras.search(previa)):
            pm = prod.search(linea)
            if pm and 'u' in pm.groupdict():  # contar valores distintos (p. ej. una certificación por solicitud)
                if pm.group('u') not in cur['u']: cur['u'].add(pm.group('u')); cur['prod'] += 1
            elif pm: cur['prod'] += int(pm.group('n')) if 'n' in pm.groupdict() and pm.group('n') else 1
        if linea.strip(): previa = linea
        m = fin.search(linea) if fin else None
        if m:
            cur['fin'] = True
            if 'rc' in m.groupdict() and m.group('rc') not in (None, '0'): cur['err'] = True
            runs.append(cur); cur = None
    if cur: runs.append(dict(cur, abierta=True))
    out, ahora = [], dt.datetime.now(dt.timezone.utc)
    for i, r in enumerate(runs):
        if not r['ts']: continue
        # Sin línea de fin (o sin fin definido): manda la marca de éxito.
        terminada = r['fin'] or (not fin and r['okm'])
        ok = terminada and not r['err'] and (r['okm'] if okr else True)
        # La última, si empezó hace menos de 3 h, puede seguir corriendo: no se juzga.
        abierta = i == len(runs) - 1 and not r['fin'] and not r['err'] and not r['okm'] \
            and (ahora - r['ts']).total_seconds() < 3 * 3600
        out.append({'ts': r['ts'], 'ok': ok, 'prod': r['prod'] if prod else None, 'abierta': abierta})
    return out


def corridas_lineas(texto, spec):
    """Una línea por corrida (p. ej. «2026-11-03 06:00:02 enviado por synerlink» / «… FALLÓ»)."""
    rx = re.compile(spec['linea'])
    okr = re.compile(spec['ok']) if spec.get('ok') else None
    prod = re.compile(spec['produccion']) if spec.get('produccion') else None
    fmt = spec.get('formato', '%Y-%m-%d %H:%M:%S')
    out = []
    for linea in texto.splitlines():
        m = rx.search(linea)
        if not m: continue
        ts = _fecha(m.group('ts'), fmt)
        if not ts: continue
        gd = m.groupdict()
        ok = (gd.get('rc') in (None, '0')) and (bool(okr.search(linea)) if okr else True)
        p = None
        if prod:
            pm = prod.search(linea)
            p = int(pm.group('n')) if pm and 'n' in pm.groupdict() and pm.group('n') else (1 if pm else 0)
        out.append({'ts': ts, 'ok': ok, 'prod': p})
    if spec.get('una_por_dia'):  # varias líneas el mismo día = una corrida (la última manda)
        dia = {}
        for r in out: dia[r['ts'].astimezone(COT).date()] = r
        out = list(dia.values())
    return out


def corridas_openclaw(host, d, job):
    """openclaw cron: historial en state/openclaw.sqlite (cron_run_receipts), abierto en solo lectura."""
    jid = str(job.get('id') or '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', jid) or not d.startswith('/'): return []
    desde = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=182)).timestamp() * 1000)
    # Según la versión de openclaw el historial está en cron_run_receipts o en cron_run_logs.
    db = shlex.quote(d + '/state/openclaw.sqlite')
    out_txt = sh(host, ('sqlite3 -readonly -json %s "SELECT status, started_at_ms FROM cron_run_receipts WHERE job_id = \'%s\' AND started_at_ms >= %d" 2>/dev/null'
                        ' || sqlite3 -readonly -json %s "SELECT status, COALESCE(run_at_ms, ts) AS started_at_ms FROM cron_run_logs WHERE job_id = \'%s\' AND COALESCE(run_at_ms, ts) >= %d" 2>/dev/null')
                 % (db, jid, desde, db, jid, desde), timeout=60)
    try: filas = json.loads(out_txt) if out_txt.strip() else []
    except ValueError: filas = []
    out = []
    for r in filas:
        if r.get('status') in ('running', 'superseded', 'skipped'): continue
        ts = _fecha(str(r.get('started_at_ms') or ''), 'epoch')
        if ts: out.append({'ts': ts, 'ok': r.get('status') == 'ok', 'prod': 1 if r.get('status') == 'ok' else 0})
    return out


def corridas_contador(host, clave, spec, estado_prev, estado_nuevo):
    """
    Logs SIN fecha (p. ej. los de hiper en /tmp): se cuentan las líneas de éxito, fallo y
    producción y se comparan con la pasada anterior (guardada en ESTADO). Lo nuevo se fecha
    con el mtime del log. La primera pasada solo fija la base. Si el log se reinició (el
    conteo bajó), todo lo que trae se toma como nuevo.
    """
    ruta = spec['ruta']
    texto = leer_texto(host, ruta)
    t = mtime(host, ruta)
    okr, err = re.compile(spec['ok']), re.compile(spec['error']) if spec.get('error') else None
    prod = re.compile(spec['produccion']) if spec.get('produccion') else None
    n_ok = n_err = n_prod = 0
    for linea in texto.splitlines():
        if okr.search(linea): n_ok += 1
        elif err and err.search(linea): n_err += 1
        if prod:
            pm = prod.search(linea)
            if pm: n_prod += int(pm.group('n')) if 'n' in pm.groupdict() and pm.group('n') else 1
    prev = estado_prev.get(clave) or {}
    obs = list(prev.get('obs') or [])
    if prev and t:
        reinicio = n_ok < prev.get('ok', 0) or n_err < prev.get('err', 0)
        d_ok = n_ok if reinicio else n_ok - prev.get('ok', 0)
        d_err = n_err if reinicio else n_err - prev.get('err', 0)
        d_prod = n_prod if reinicio else max(0, n_prod - prev.get('prod', 0))
        if d_ok or d_err:
            obs.append({'ts': t.isoformat(), 'ok': d_ok, 'err': d_err, 'prod': d_prod})
    limite = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=182)
    obs = [o for o in obs if dt.datetime.fromisoformat(o['ts']) >= limite]
    estado_nuevo[clave] = {'ok': n_ok, 'err': n_err, 'prod': n_prod, 'obs': obs,
                           'desde': prev.get('desde') or dt.date.today().isoformat()}
    runs = []
    for o in obs:
        ts = dt.datetime.fromisoformat(o['ts'])
        runs += [{'ts': ts, 'ok': True, 'prod': 0} for _ in range(o['ok'])]
        runs += [{'ts': ts, 'ok': False, 'prod': 0} for _ in range(o['err'])]
        if runs and prod: runs[-1]['prod'] = o.get('prod', 0)
    return runs, estado_nuevo[clave]['desde'], bool(texto)


def produccion_archivos(host, spec):
    """Fechas (mtime) de los archivos que genera la automatización; nunca su contenido."""
    d, patron = spec['dir'], spec.get('patron', '*')
    out = sh(host, 'find %s -type f -name %s -mtime -95 -exec stat -f %%m {} + 2>/dev/null' % (q(d), shlex.quote(patron)), timeout=120)
    return [dt.datetime.fromtimestamp(int(x), dt.timezone.utc) for x in out.split() if x.isdigit()]


def produccion_json_fechas(host, spec):
    """
    Fechas de los registros de un JSON del agente (p. ej. candidatos LAFT procesados). En el
    equipo solo se imprimen las fechas: el JSON puede traer nombres y documentos de personas.
    """
    py = ('import json,os,sys\n'
          'd=json.load(open(os.path.expanduser(sys.argv[1])))\n'
          'v=d.get(sys.argv[2],{}) if isinstance(d,dict) else d\n'
          'v=v.values() if isinstance(v,dict) else v\n'
          'print("\\n".join(str(x.get(sys.argv[3],""))[:10] for x in v if isinstance(x,dict)))')
    out = sh(host, 'python3 -c %s %s %s %s 2>/dev/null' % (shlex.quote(py), shlex.quote(spec['ruta']),
                                                          shlex.quote(spec.get('clave', '')), shlex.quote(spec['campo'])), timeout=60)
    fechas = []
    for x in out.split():
        try: fechas.append(dt.datetime.fromisoformat(x).replace(hour=12, tzinfo=COT))
        except ValueError: pass
    return fechas


def mtime(host, ruta):
    out = sh(host, 'stat -f %%m %s 2>/dev/null' % q(ruta), timeout=30).strip()
    return dt.datetime.fromtimestamp(int(out), dt.timezone.utc) if out.isdigit() else None


# ── Armar cada automatización ─────────────────────────────────────────────────

def lunes(d): return (d.astimezone(COT) - dt.timedelta(days=d.astimezone(COT).weekday())).date()


def metricas(runs, prod_fechas, hoy):
    ahora = dt.datetime.now(dt.timezone.utc)
    hace = lambda dias: ahora - dt.timedelta(days=dias)
    r30 = [r for r in runs if r['ts'] >= hace(30)]
    r90 = [r for r in runs if r['ts'] >= hace(90)]
    m = {'corridas30': len(r30), 'ok30': sum(r['ok'] for r in r30),
         'corridas90': len(r90), 'ok90': sum(r['ok'] for r in r90)}
    if runs:
        ult = max(runs, key=lambda r: r['ts'])
        m['ultimaCorrida'] = ult['ts'].astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
        m['ultimaOk'] = bool(ult['ok']) if not ult.get('abierta') else None
        m['primeraCorrida'] = min(r['ts'] for r in runs).astimezone(COT).date().isoformat()
    sem = {}
    for r in r90 + [r for r in runs if hace(182) <= r['ts'] < hace(90)]:
        w = sem.setdefault(lunes(r['ts']).isoformat(), {'corridas': 0, 'ok': 0, 'produccion': None})
        w['corridas'] += 1; w['ok'] += int(bool(r['ok']))
    if prod_fechas is not None:
        m['produccion30'] = sum(1 for f in prod_fechas if f >= hace(30))
        m['produccion90'] = sum(1 for f in prod_fechas if f >= hace(90))
        for f in prod_fechas:
            if f >= hace(182):
                w = sem.setdefault(lunes(f).isoformat(), {'corridas': 0, 'ok': 0, 'produccion': None})
                w['produccion'] = (w['produccion'] or 0) + 1
    elif any(r.get('prod') is not None for r in runs):
        m['produccion30'] = sum(r['prod'] or 0 for r in r30)
        m['produccion90'] = sum(r['prod'] or 0 for r in r90)
        for r in r90:
            w = sem[lunes(r['ts']).isoformat()]
            w['produccion'] = (w['produccion'] or 0) + (r['prod'] or 0)
    m['semanas'] = [dict(v, inicio=k) for k, v in sorted(sem.items())][-26:]
    return m


def estado(a, runs, esperado_h):
    if a.get('cargada') is False or a.get('habilitada') is False:
        return 'pausada', 'Descargada o deshabilitada en el equipo: no corre.'
    if not runs:
        return ('sin_datos', 'Sin corridas registradas en sus logs.') if a.get('_conLog') else \
            ('activa' if a.get('_ultimaSalida') in (None, '0') else 'fallando',
             'Sin log de corridas: estado según la última salida de launchd (%s).' % a.get('_ultimaSalida', '—'))
    ahora = dt.datetime.now(dt.timezone.utc)
    ult = max(runs, key=lambda r: r['ts'])
    recientes = sorted(runs, key=lambda r: r['ts'])[-3:]
    if esperado_h and (ahora - ult['ts']).total_seconds() / 3600 > max(esperado_h * 2.5, 30):
        return 'fallando', 'Debía correr cada ~%g h y la última corrida fue el %s.' % (
            round(esperado_h, 1), ult['ts'].astimezone(COT).strftime('%Y-%m-%d %H:%M'))
    if not ult['ok'] and not ult.get('abierta'):
        malas = sum(1 for r in recientes if not r['ok'])
        return 'fallando', 'La última corrida falló (%d de las últimas %d).' % (malas, len(recientes))
    return 'activa', None


ESTADO_PREV, ESTADO_NUEVO = {}, {}


def construir(host, code, tipo, nombre, cat, extra, hoy):
    """cat = entrada del catálogo (o {}); extra = lo leído de launchd/cron/openclaw."""
    a = {'clave': '%s:%s:%s' % (host, tipo, nombre), 'code': code, 'host': host, 'tipo': tipo, 'nombre': cat.get('nombre') or nombre,
         'descripcion': cat.get('descripcion'), 'programacion': cat.get('programacion') or extra.get('programacion'),
         'cargada': extra.get('cargada'), 'habilitada': extra.get('habilitada'),
         'produccionEtiqueta': (cat.get('produccion') or {}).get('etiqueta')}
    runs = extra.get('runs')
    if runs is None:
        runs = []
        logspec = cat.get('log')
        rutas = (logspec or {}).get('rutas') or ([logspec['ruta']] if logspec and logspec.get('ruta') else [])
        if logspec and logspec.get('tipo') == 'contador':
            runs, desde, hay = corridas_contador(host, a['clave'], logspec, ESTADO_PREV, ESTADO_NUEVO)
            a['_conLog'] = bool(runs)
            a['_medidoDesde'] = desde
            rutas = []
        for ruta in rutas:
            texto = leer_texto(host, ruta)
            if texto: a['_conLog'] = True
            runs += corridas_bloques(texto, logspec) if logspec.get('tipo') == 'bloques' else corridas_lineas(texto, logspec)
    prod_fechas = None
    p = cat.get('produccion') or {}
    if p.get('tipo') == 'archivos':
        prod_fechas = produccion_archivos(host, p)
    elif p.get('tipo') == 'json_fechas':
        prod_fechas = produccion_json_fechas(host, p)
    a['_ultimaSalida'] = extra.get('ultimaSalida')
    if not runs and extra.get('ultimaSalida') is not None and extra.get('salida'):
        # Sin log propio: al menos la última corrida (mtime del stdout + último código de launchd).
        t = mtime(host, extra['salida'])
        if t: runs = [{'ts': t, 'ok': extra['ultimaSalida'] == '0', 'prod': None}]
        a['_soloUltima'] = True
    a.update(metricas(runs, prod_fechas, hoy))
    if a.pop('_soloUltima', False):
        for k in ('corridas30', 'ok30', 'corridas90', 'ok90'): a[k] = 0
        a['semanas'] = []
    a['estado'], a['estadoDetalle'] = estado(a, runs, extra.get('esperado_h'))
    if a.get('_medidoDesde'):
        a['estadoDetalle'] = ((a['estadoDetalle'] or '') + ' Su log no trae fechas: se mide desde el %s.' % a['_medidoDesde']).strip()
    if cat.get('nota'): a['estadoDetalle'] = ((a['estadoDetalle'] or '') + ' ' + cat['nota']).strip()
    for k in list(a):
        if k.startswith('_'): a.pop(k)
    return a


def recolectar(hosts=None):
    flota = json.loads(FLOTA.read_text()) if FLOTA else {'agentes': []}
    catalogo = json.loads(CATALOGO.read_text()) if CATALOGO.exists() else {}
    cat = {k: v for k, v in catalogo.items() if not k.startswith('_')}
    excluir = [re.compile(x, re.I) for x in EXCLUIR + catalogo.get('_excluir', [])]
    incluir = set(catalogo.get('_incluir', []))  # labels que parecen infraestructura pero son de negocio
    por_host = {}
    for ag in flota.get('agentes', []):
        por_host.setdefault(ag['host'], []).append(ag)
    hoy = dt.date.today()
    todas, leidos = [], []
    for host in hosts or list(por_host):
        datos = listar(host)
        if datos is None:
            log('%s: sin respuesta; sus automatizaciones se conservan como estaban' % host); continue
        leidos.append(host)
        agentes = por_host.get(host, [])
        dirs = {ag['dir'].lstrip('.'): ag['code'] for ag in agentes if ag.get('dir')}
        codes = {ag['code'] for ag in agentes}
        principales = {'com.%s.%s' % (host if host != 'local' else 'horus', d) for d in dirs} | \
                      {'com.%s.%s' % (host if host != 'local' else 'horus', c) for c in codes}

        def dueno(label, rutas):
            for r in rutas:
                m = re.search(r'/\.([A-Za-z0-9_-]+)/', r or '')
                if m and m.group(1) in dirs: return dirs[m.group(1)]
            partes = label.split('.')
            for p in partes[2:3] + partes[1:2]:  # com.<equipo>.<bot>.<tarea> o com.<bot>.<tarea>
                if p in dirs: return dirs[p]
                if p in codes: return p
            return None

        for p in datos['plists']:
            label = p.get('Label') or pathlib.Path(p['archivo']).stem
            if label.startswith('com.apple.') or label in principales: continue
            prog = p.get('ProgramArguments') or ([p['Program']] if p.get('Program') else [])
            rutas = [x for x in prog if isinstance(x, str)] + [p.get('StandardOutPath') or '']
            entrada = cat.get(label) or cat.get('%s:%s' % (host, label)) or {}
            code = entrada.get('code') or dueno(label, rutas)
            if not code: continue
            if label not in incluir and not entrada and any(x.search(label) for x in excluir): continue
            if entrada.get('excluir'): continue
            if not p.get('StartCalendarInterval') and not p.get('StartInterval'): continue  # demonio, no programada
            car = datos['cargados'].get(label)
            extra = {'programacion': programacion_launchd(p), 'cargada': car is not None,
                     'habilitada': None if p.get('Disabled') in (None, '') else p.get('Disabled') != 'true',
                     'ultimaSalida': car['status'] if car else None, 'salida': p.get('StandardOutPath'),
                     'esperado_h': intervalo_esperado_h(p_launchd=p)}
            todas.append(construir(host, code, 'launchd', label, entrada, extra, hoy))

        for linea in datos['cron']:
            partes = linea.split(None, 5)
            if len(partes) < 6: continue
            expr, cmd = ' '.join(partes[:5]), partes[5]
            code = dueno('', [cmd])
            if not code: continue
            nombre = re.sub(r'\s+', ' ', cmd)[:120]
            entrada = next((v for k, v in cat.items() if k.startswith('cron:') and k[5:] in cmd), {})
            if entrada.get('excluir') or (not entrada and any(x.search(cmd) for x in excluir)): continue
            extra = {'programacion': programacion_cron(expr), 'cargada': True, 'habilitada': True,
                     'esperado_h': intervalo_esperado_h(cron=expr)}
            todas.append(construir(host, code, 'cron', re.sub(r'\s*>>.*', '', nombre), entrada, extra, hoy))

        for job in datos['openclaw']:
            if job.get('declarationKey'): continue  # heartbeat, revisión de skills, memoria: infraestructura
            agente = job.get('agentId') or 'main'
            perfil = re.sub(r'^\.openclaw-?', '', pathlib.Path(job['_dir']).name)
            entrada = cat.get('openclaw:%s:%s' % (host, job.get('id'))) or {}
            if entrada.get('excluir'): continue
            code = entrada.get('code') or next((ag['code'] for ag in agentes if ag.get('kind') == 'openclaw'
                                                and ag.get('agent') == agente and (ag.get('profile') or '') == perfil), None)
            if not code: continue
            nombre = job.get('name') or job.get('id')
            s = job.get('schedule') or {}
            prog = programacion_cron(s['expr']) if s.get('kind') == 'cron' and s.get('expr') else \
                'Cada %g min' % (s['everyMs'] / 60000) if s.get('everyMs') else \
                'Una vez' if s.get('kind') == 'at' else None
            extra = {'programacion': prog, 'cargada': True, 'habilitada': job.get('enabled') not in (False, 0),
                     'runs': corridas_openclaw(host, job['_dir'], job),
                     'esperado_h': intervalo_esperado_h(cron=s['expr']) if s.get('expr') else None}
            if not entrada.get('descripcion') and job.get('description'):
                entrada = dict(entrada, descripcion=str(job['description'])[:300])
            todas.append(construir(host, code, 'openclaw', nombre, entrada, extra, hoy))
    return {'corte': hoy.isoformat(), 'hostsLeidos': leidos, 'automatizaciones': todas}


def tabla(pub):
    pct = lambda o, c: '%d %%' % round(o * 100 / c) if c else '—'
    filas = ['| Agente | Automatización | Qué hace | Cuándo corre | Corridas 30 d | % bien | Última corrida | Producción 30 d | Estado |',
             '|---|---|---|---|---|---|---|---|---|']
    for a in sorted(pub['automatizaciones'], key=lambda x: (x['code'], x['nombre'])):
        ult = a.get('ultimaCorrida')
        ult = dt.datetime.fromisoformat(ult.replace('Z', '+00:00')).astimezone(COT).strftime('%Y-%m-%d %H:%M') if ult else '—'
        prod = '%s %s' % (a.get('produccion30'), a.get('produccionEtiqueta')) if a.get('produccionEtiqueta') else '—'
        filas.append('| %s | %s | %s | %s | %d | %s | %s | %s | %s |' % (
            a['code'], a['nombre'], (a.get('descripcion') or '—').replace('|', '/'), a.get('programacion') or '—',
            a['corridas30'], pct(a['ok30'], a['corridas30']), ult, prod, a['estado']))
    return '\n'.join(filas)


def main():
    a = sys.argv[1:]
    hosts = [a[i + 1] for i, x in enumerate(a) if x == '--host' and i + 1 < len(a)] or None
    try: ESTADO_PREV.update(json.loads(ESTADO.read_text()))
    except (OSError, ValueError): pass
    pub = recolectar(hosts)
    log('equipos leídos %s · automatizaciones %d' % (','.join(pub['hostsLeidos']), len(pub['automatizaciones'])))
    if '--tabla' in a: print(tabla(pub)); return
    if '--ensayo' in a: print(json.dumps(pub, ensure_ascii=False, indent=1)); return
    for url, key in destinos(a):
        code, body = llamar(url, key, '/api/chat/auditoria/automatizaciones/programadas', pub)
        log('%s: publicado HTTP %s %s' % (url, code, json.dumps(body, ensure_ascii=False)[:200]))
    # Las muestras de los logs sin fecha se guardan solo en una pasada real (no en ensayo).
    ESTADO_PREV.update(ESTADO_NUEVO)
    ESTADO.write_text(json.dumps(ESTADO_PREV, ensure_ascii=False))


if __name__ == '__main__':
    main()
