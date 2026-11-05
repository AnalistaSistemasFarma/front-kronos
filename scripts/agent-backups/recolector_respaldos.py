#!/usr/bin/env python3
"""
RECOLECTOR DE COPIAS DE SEGURIDAD DE LOS AGENTES (Auditoría de agentes → Copias de seguridad).

Lee en SOLO LECTURA el rastro del sistema de respaldo de la flota (repo respaldo-agentes):
  - En cada Mac (local o por SSH): ~/.respaldo-agentes/logs/{completo,horario,subir-*}-AAAAMMDD.log
    (14 días), con una línea de inicio y otra de fin por copia y los AVISO de en medio.
  - En la Mac de horus: ~/.respaldo-agentes/validaciones/ (validación de los domingos:
    resultado-<fecha>.json, o la tabla del informe validacion-<fecha>.md si no hay JSON) e
    historial.json (agentes y archivos por máquina).
Publica por POST /api/chat/auditoria/respaldos con la llave del recolector del inventario
(~/.horus/agent-inventory/collector.env). El servidor no duplica: cada copia es (máquina, modo, inicio).

  python3 recolector_respaldos.py           # recolecta y publica
  python3 recolector_respaldos.py --ensayo  # muestra lo que publicaría
"""
import datetime as dt, glob, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request

CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))
BASE = pathlib.Path(os.path.expanduser('~/.respaldo-agentes'))
# máquina del respaldo → alias SSH (None = esta Mac) y etiqueta
MAQUINAS = [('horus', None, 'Mac de Horus'), ('pedro', 'pedro', 'Mac mini de Pedro'),
            ('jorge', 'jorge', 'Mac mini de Jorge'), ('cosmo', 'cosmo', 'Mac mini de Cosmo'),
            ('lisa', 'lisa', 'Mac mini de Lisa'), ('eva', 'eva', 'Mac de Eva'), ('hcb', 'hcb', 'Mac hcb')]
TZ = dt.timezone(dt.timedelta(hours=-5))  # las Macs están en hora de Colombia

LECTOR = r'''
import glob, json, os
B = os.path.expanduser('~/.respaldo-agentes')
out = {'logs': {}, 'estado': {}}
for p in sorted(glob.glob(os.path.join(B, 'logs', '*-2*.log'))):
    try:
        with open(p, errors='replace') as f:
            out['logs'][os.path.basename(p)] = [l.rstrip('\n') for l in f if l.startswith('=====') or l.startswith('AVISO') or l.startswith('Otra corrida')]
    except OSError:
        pass
for m in ('completo', 'horario'):
    try:
        out['estado'][m] = json.load(open(os.path.join(B, 'ultimo-%s.json' % m)))
    except Exception:
        pass
print(json.dumps(out))
'''

RX_INI = re.compile(r'^===== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) inicio (completo|horario)\b')
RX_FIN = re.compile(r'^===== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) fin (completo|horario): (\w+), avisos=(\d+), sqlite=(\d+), (\d+) s')
RX_SUB_INI = re.compile(r'^===== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) subir (\w+):')
RX_SUB_FIN = re.compile(r'^===== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) fin subir (\w+): rc=(\d+)')


def log(m): print('%s %s' % (dt.datetime.now().isoformat(timespec='seconds'), m), flush=True)


def utc(local):
    return dt.datetime.strptime(local, '%Y-%m-%d %H:%M:%S').replace(tzinfo=TZ).astimezone(dt.timezone.utc)


def leer(alias):
    cmd = ['python3', '-'] if alias is None else ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 -']
    try:
        r = subprocess.run(cmd, input=LECTOR, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None, 'tiempo agotado'
    if r.returncode != 0:
        return None, ((r.stderr.strip().splitlines() or ['sin conexión'])[-1])[:200]
    try:
        return json.loads(r.stdout), None
    except Exception:
        return None, 'respuesta ilegible'


def copias_de(maquina, datos):
    """Una copia por par inicio→fin; un inicio sin fin = sin terminar (o en curso)."""
    out = []
    for nombre, lineas in sorted(datos.get('logs', {}).items()):
        abierta, avisos = None, []
        for l in lineas:
            m = RX_INI.match(l)
            if m:
                if abierta:
                    out.append(dict(abierta, resultado='sin_terminar', detalle='; '.join(avisos)[:1000] or None))
                abierta, avisos = {'maquina': maquina, 'modo': m.group(2), 'inicio': utc(m.group(1)).isoformat(), 'fin': None,
                                   'segundos': None, 'avisos': 0, 'sqlite': None}, []
                continue
            m = RX_SUB_INI.match(l)
            if m:
                if abierta:
                    out.append(dict(abierta, resultado='sin_terminar', detalle='; '.join(avisos)[:1000] or None))
                # La subida del espejo de otra Mac (p. ej. Jorge desde horus) cuenta para esa Mac.
                abierta, avisos = {'maquina': m.group(2), 'modo': 'subida', 'inicio': utc(m.group(1)).isoformat(), 'fin': None,
                                   'segundos': None, 'avisos': 0, 'sqlite': None}, []
                continue
            if l.startswith('Otra corrida') and abierta:
                # el script se salió porque había otra copia en curso: no es falla, es una copia omitida
                out.append(dict(abierta, fin=abierta['inicio'], segundos=0, resultado='omitida', detalle=l[:200]))
                abierta, avisos = None, []
                continue
            if l.startswith('AVISO'):
                avisos.append(l[:200]); continue
            m = RX_FIN.match(l)
            if m and abierta and abierta['modo'] == m.group(2):
                fin = utc(m.group(1))
                res = m.group(3) if m.group(3) in ('ok', 'con_avisos') else 'fallo'
                out.append(dict(abierta, fin=fin.isoformat(), segundos=int(m.group(6)), resultado=res,
                                avisos=int(m.group(4)), sqlite=int(m.group(5)), detalle='; '.join(avisos)[:1000] or None))
                abierta, avisos = None, []
                continue
            m = RX_SUB_FIN.match(l)
            if m and abierta and abierta['modo'] == 'subida':
                fin = utc(m.group(1)); ini = dt.datetime.fromisoformat(abierta['inicio'])
                out.append(dict(abierta, fin=fin.isoformat(), segundos=int((fin - ini).total_seconds()),
                                resultado='ok' if m.group(3) == '0' else 'fallo', avisos=0 if m.group(3) == '0' else 1,
                                detalle=None if m.group(3) == '0' else 'rc=%s' % m.group(3)))
                abierta, avisos = None, []
        if abierta:
            ini = dt.datetime.fromisoformat(abierta['inicio'])
            # una copia que empezó hace menos de 3 h todavía puede estar corriendo: no se reporta aún
            if (dt.datetime.now(dt.timezone.utc) - ini).total_seconds() > 3 * 3600:
                out.append(dict(abierta, resultado='sin_terminar', detalle='; '.join(avisos)[:1000] or None))
    return out


def validaciones():
    out = []
    d = BASE / 'validaciones'
    for p in sorted(d.glob('resultado-*.json')):
        try:
            v = json.load(open(p))
            for m in v.get('maquinas', []):
                out.append({'fecha': v['fecha'], 'maquina': m['maquina'], 'estado': m['estado'],
                            'problemas': '; '.join(m.get('problemas') or []) or None,
                            'avisos': '; '.join(m.get('avisos') or []) or None, 'datos': m.get('datos')})
        except Exception:
            pass
    con_json = {o['fecha'] for o in out}
    for p in sorted(d.glob('validacion-*.md')):
        fecha = p.stem.replace('validacion-', '')
        if fecha in con_json:
            continue
        texto = p.read_text(errors='replace')
        det = {}
        for l in texto.splitlines():
            m = re.match(r'^- (❌|⚠️) (\S+): (.*)$', l)
            if m:
                det.setdefault(m.group(2), {'p': [], 'a': []})['p' if m.group(1) == '❌' else 'a'].append(m.group(3))
        for l in texto.splitlines():
            c = [x.strip() for x in l.strip().strip('|').split('|')]
            if len(c) == 7 and c[0] not in ('Máquina', '---') and not c[0].startswith('-'):
                est = {'✅': 'ok', '⚠️': 'avisos', '❌': 'problemas'}.get(c[6], 'problemas')
                dd = det.get(c[0], {'p': [], 'a': []})
                out.append({'fecha': fecha, 'maquina': c[0], 'estado': est, 'problemas': '; '.join(dd['p']) or None,
                            'avisos': '; '.join(dd['a']) or None,
                            'datos': {'agentes': c[1], 'completo': c[2], 'horario': c[3], 'huellas': c[4], 'sqlite': c[5]}})
    return out


def main():
    ensayo = '--ensayo' in sys.argv
    try:
        hist = json.load(open(BASE / 'validaciones' / 'historial.json'))
    except Exception:
        hist = {}
    maquinas, copias = [], []
    for nombre, alias, etiqueta in MAQUINAS:
        datos, err = leer(alias)
        h = hist.get(nombre, {})
        maquinas.append({'maquina': nombre, 'etiqueta': etiqueta, 'alcanzable': datos is not None, 'error': err,
                         'agentes': h.get('agentes') or None, 'archivos': h.get('archivos') or None})
        if datos:
            copias += copias_de(nombre, datos)
    vals = validaciones()
    log('máquinas %d (%d sin respuesta) · copias %d · validaciones %d' % (
        len(maquinas), sum(1 for m in maquinas if not m['alcanzable']), len(copias), len(vals)))
    cuerpo = {'maquinas': maquinas, 'copias': copias, 'validaciones': vals}
    if ensayo:
        print(json.dumps({'maquinas': maquinas, 'copias_por_maquina': {m: sum(1 for c in copias if c['maquina'] == m) for m in {c['maquina'] for c in copias}},
                          'ultima': copias[-1] if copias else None, 'validaciones': vals[:3]}, ensure_ascii=False, indent=1)[:3000])
        return
    c = {}
    for l in CONF.read_text().splitlines():
        if '=' in l and not l.lstrip().startswith('#'):
            k, v = l.split('=', 1); c[k.strip()] = v.strip().strip('"')
    url, key = c.get('SYNERLINK_INVENTORY_URL', '').rstrip('/'), c.get('SYNERLINK_INVENTORY_KEY', '')
    req = urllib.request.Request(url + '/api/chat/auditoria/respaldos', data=json.dumps(cuerpo).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            log('publicado HTTP %s %s' % (r.status, r.read()[:200].decode(errors='replace')))
    except urllib.error.HTTPError as e:
        log('publicación falló HTTP %s %s' % (e.code, e.read()[:200].decode(errors='replace')))


if __name__ == '__main__':
    main()
