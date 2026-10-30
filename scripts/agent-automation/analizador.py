#!/usr/bin/env python3
"""
ANALIZADOR DEL INDICADOR DE AUTOMATIZACIONES (Auditoría de agentes).

Recalcula, en SOLO LECTURA, cuántas veces se pidió cada caso de uso a cada agente
y cuánto tardó el agente, y publica el corte en SynerLink
(POST /api/chat/auditoria/automatizaciones) con la llave del recolector del
inventario (~/.horus/agent-inventory/collector.env).

  python3 analizador.py --ronda      # cada 5 min: solo trabaja si alguien pulsó «Analizar ahora»
  python3 analizador.py --programado # semanal
  python3 analizador.py --ensayo     # calcula y muestra; no publica

Fuentes:
  - Conversaciones del chat: base de producción (KRONOSDB) por SSH a serfarma05,
    con un script que solo permite SELECT (leer-solo-select.js), que se borra al terminar.
  - Catálogo de casos de uso con su tiempo humano realista (antes/después, pasos,
    supuestos, términos para reconocerlos): ~/.horus/agent-automation/catalogo.json.
    Lo arma el análisis de justificación de la IA y se revisa con los dueños de proceso.
El tiempo humano NO lo recalcula este script: solo las ocurrencias, la recurrencia y
el tiempo medido del agente.
"""
import datetime as dt, json, os, pathlib, re, statistics as st, subprocess, sys, tempfile, unicodedata, urllib.error, urllib.request

AQUI = pathlib.Path(__file__).resolve().parent
CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))
CATALOGO = pathlib.Path(os.path.expanduser('~/.horus/agent-automation/catalogo.json'))
DESDE = '2026-09-07'          # primer día con conversaciones en SynerLink
SSH = 'serfarma05'
RUTA = r'C:\Users\administrador.DFARUNIADM\projects\front-kronos'
CONSULTA = """
SELECT m.id_conversation conv, a.code agente, m.role, m.created_at,
       CONVERT(varchar(64), HASHBYTES('SHA2_256', ISNULL(m.id_user_author,'')), 2) persona,
       LEFT(m.body, 1200) texto
FROM chat_message m
JOIN chat_conversation c ON c.id = m.id_conversation
LEFT JOIN agent a ON a.id_agent = c.id_agent
WHERE c.kind IN ('direct','project','group') AND m.role IN ('user','agent') AND m.created_at >= '%s'
ORDER BY m.id_conversation, m.id;
""" % DESDE

def log(m): print('%s %s' % (dt.datetime.now().isoformat(timespec='seconds'), m), flush=True)

def conf():
    c = {}
    for l in CONF.read_text().splitlines():
        if '=' in l and not l.lstrip().startswith('#'):
            k, v = l.split('=', 1); c[k.strip()] = v.strip().strip('"')
    url, key = c.get('SYNERLINK_INVENTORY_URL', '').rstrip('/'), c.get('SYNERLINK_INVENTORY_KEY', '')
    if not url or len(key) < 32: sys.exit('Falta configurar %s' % CONF)
    return url, key

def llamar(url, key, ruta, cuerpo):
    req = urllib.request.Request(url + ruta, data=json.dumps(cuerpo).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

def leer_produccion():
    """Corre la consulta SOLO SELECT en serfarma05 y borra los archivos al terminar."""
    with tempfile.TemporaryDirectory() as d:
        q = pathlib.Path(d) / 'aa-consulta.sql'; q.write_text(CONSULTA)
        subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', str(AQUI / 'leer-solo-select.js'), str(q), '%s:%s\\' % (SSH, RUTA)], check=True, timeout=60)
        try:
            r = subprocess.run(['ssh', '-o', 'BatchMode=yes', SSH, 'cd /d %s && node leer-solo-select.js aa-consulta.sql' % RUTA],
                               capture_output=True, text=True, timeout=600)
        finally:
            subprocess.run(['ssh', '-o', 'BatchMode=yes', SSH, 'cd /d %s && del leer-solo-select.js aa-consulta.sql' % RUTA], timeout=60)
        if r.returncode != 0: raise RuntimeError('lectura de producción: ' + (r.stderr.strip()[-200:] or 'sin detalle'))
        return json.loads(r.stdout)[0]

def tareas(msgs):
    """Pedido de una persona + respuestas del agente hasta el siguiente pedido."""
    P = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    out, cur, conv = [], None, None
    for m in msgs:
        t = P(m['created_at'])
        if m['conv'] != conv:
            if cur: out.append(cur)
            cur, conv = None, m['conv']
        if m['role'] == 'user':
            if cur is None or (cur['resp'] > 0 and (t - cur['fin']).total_seconds() > 180) or (t - cur['fin']).total_seconds() > 1800:
                if cur: out.append(cur)
                cur = {'agente': m['agente'], 'persona': m['persona'], 'inicio': t, 'fin': t, 'pedido': m['texto'] or '', 'resp': 0}
            else:
                cur['fin'] = max(cur['fin'], t)
                if len(cur['pedido']) < 1500: cur['pedido'] += '\n' + (m['texto'] or '')[:400]
        elif cur:
            cur['resp'] += 1; cur['fin'] = t
    if cur: out.append(cur)
    return [x for x in out if x['resp'] > 0 and x['agente'] and len(x['pedido'].strip()) >= 15]

def norm(s): return unicodedata.normalize('NFKD', s.lower()).encode('ascii', 'ignore').decode()

def calcular(catalogo, ts, corte):
    por = {}
    for x in ts: por.setdefault(x['agente'], []).append((set(re.findall(r'[a-z0-9]{4,}', norm(x['pedido']))), x))
    usadas, casos = set(), []
    for c in catalogo:
        kws = set(w for w in (c.get('terminos') or '').split(', ') if w)
        hits = [x for s, x in por.get(c['code'], []) if kws and (len(s & kws) >= 2 or (len(kws) <= 2 and len(s & kws) == 1))]
        for x in hits: usadas.add(id(x))
        fechas = sorted({x['inicio'].date() for x in hits})
        semanas = len({f.isocalendar()[:2] for f in fechas})
        clase = 'Recurrente' if len(fechas) >= 3 and semanas >= 3 else 'Ocasional' if len(fechas) >= 2 else 'Puntual' if fechas else 'Sin evidencia en el chat'
        dur = [(x['fin'] - x['inicio']).total_seconds() / 60 for x in hits]
        dur = [d for d in dur if d < 240]
        casos.append(dict(c, clase=clase, ocurrencias=len(hits), minAgente=round(st.median(dur), 1) if dur else None))
    sin = sum(1 for x in ts if id(x) not in usadas)
    return casos, sin

def main():
    a = sys.argv[1:]
    ensayo, ronda = '--ensayo' in a, '--ronda' in a
    url = key = None
    id_run = None
    if not ensayo:
        url, key = conf()
        if ronda:
            code, body = llamar(url, key, '/api/chat/auditoria/automatizaciones/solicitudes', {})
            if code != 200: log('no se pudo consultar solicitudes: HTTP %s' % code); return
            if not body.get('corrida'): return  # nada pendiente
            id_run = body['corrida']['id']; log('tomé la corrida #%s' % id_run)
    try:
        catalogo = json.loads(CATALOGO.read_text())
        ts = tareas(leer_produccion())
        corte = dt.date.today().isoformat()
        casos, sin = calcular(catalogo, ts, corte)
        log('tareas %d · casos %d · sin caso conocido %d' % (len(ts), len(casos), sin))
        if ensayo:
            print(json.dumps(sorted(((c['code'], c['caso'][:50], c['ocurrencias'], c['clase']) for c in casos), key=lambda x: -x[2])[:20], ensure_ascii=False, indent=0)); return
        cuerpo = {'idRun': id_run, 'origen': 'manual' if ronda else 'programado', 'corte': corte, 'periodoDesde': DESDE,
                  'tareas': len(ts), 'tareasSinClasificar': sin, 'casos': casos}
        code, body = llamar(url, key, '/api/chat/auditoria/automatizaciones', cuerpo)
        log('publicado HTTP %s %s' % (code, json.dumps(body, ensure_ascii=False)[:200]))
    except Exception as e:
        log('falló: %s' % str(e)[:300])
        if id_run and url:
            llamar(url, key, '/api/chat/auditoria/automatizaciones/solicitudes', {'fallo': id_run, 'error': str(e)[:300]})

if __name__ == '__main__':
    main()
