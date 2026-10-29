#!/usr/bin/env python3
"""
RECOLECTOR DE MEMORIAS DE LOS AGENTES (Auditoría de agentes → Memorias).

Lee en SOLO LECTURA la base de memoria de engram (~/.engram/engram.db) de cada
equipo de la flota —local o por SSH, igual que el recolector del inventario—,
reconoce de qué agente es cada memoria por la carpeta de su sesión, oculta los
secretos y publica por POST /api/chat/auditoria/memorias con la llave del
recolector del inventario (~/.horus/agent-inventory/collector.env).

  python3 recolector_memorias.py                  # todos los equipos
  python3 recolector_memorias.py --solo local,pedro
  python3 recolector_memorias.py --ensayo         # no publica: muestra cifras

Nunca escribe en los equipos: abre SQLite con mode=ro. El servidor vuelve a
pasar todo por su barrera de secretos (lib/agent-audit/memories.ts).
"""
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

VERSION = '1.0.0'
AQUI = pathlib.Path(__file__).resolve().parent
FLOTA = json.loads((AQUI.parent / 'agent-inventory' / 'flota.json').read_text(encoding='utf-8'))
CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))

# Nombre de la carpeta de sesión (vault del agente) → código del agente en SynerLink.
# Los vaults llevan el nombre de la persona a la que atiende el bot.
ALIAS = {
    'local': {'horus': 'horus', 'orus': 'horus', 'mecha': 'mechita', 'mechita': 'mechita',
              'sawblaze': 'sawblaze', 'zoe': 'zoe'},
    'pedro': {'silvia': 'play', 'play': 'play', 'pedro': 'pedro', 'troy': 'troy', 'ana': 'troy',
              'mark': 'mark', 'ricardo': 'mark', 'cali': 'cali', 'adriana': 'cali', 'plan': 'plan',
              'hiper': 'hiper', 'indi': 'indi'},
    'jorge': {'laura': 'laura', 'lexa': 'laura', 'andrea': 'rex', 'rex': 'rex', 'jose': 'jose',
              'vision': 'jose', 'lina': 'lina', 'tina': 'lina', 'jorge': 'jorge', 'nancy': 'jorge',
              'carter': 'carter', 'gilbert': 'gilbert', 'ofi': 'ofi'},
    'cosmo': {'andrea': 'cosmo', 'cosmo': 'cosmo'},
}

# Corre en el equipo (local o remoto). Solo lectura.
LECTOR = r'''
import json, os, sqlite3, sys
p = os.path.expanduser('~/.engram/engram.db')
if not os.path.exists(p):
    print(json.dumps({'sin_engram': True})); sys.exit(0)
c = sqlite3.connect('file:' + p + '?mode=ro', uri=True)
c.row_factory = sqlite3.Row
obs = [dict(r) for r in c.execute("""
  SELECT o.id, o.sync_id, o.type, o.title, o.content, o.topic_key, o.created_at, o.updated_at,
         s.directory
  FROM observations o JOIN sessions s ON s.id = o.session_id
  WHERE o.deleted_at IS NULL""")]
rel = []
try:
    rel = [dict(r) for r in c.execute("""
      SELECT source_id, target_id, relation FROM memory_relations
      WHERE judgment_status = 'judged' AND relation NOT IN ('not_conflict', 'pending')
        AND superseded_at IS NULL""")]
except Exception:
    pass
print(json.dumps({'obs': obs, 'rel': rel}))
'''

# Segunda barrera (la primera es el servidor): lo que parezca credencial → <oculto>.
SECRETOS = [
    re.compile(r'Bearer\s+\S+', re.I),
    re.compile(r'\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}'),
    re.compile(r'\bgh[pousr]_[A-Za-z0-9]{16,}'),
    re.compile(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}'),
    re.compile(r'\b\d{6,12}:AA[A-Za-z0-9_-]{20,}'),
    re.compile(r'\b[A-Fa-f0-9]{32,}\b'),
    re.compile(r'((?:password|passwd|pwd|contraseña|clave|secret|token|api[_-]?key)\s*[:=]\s*)\S+', re.I),
    re.compile(r'((?:Password|Pwd)=)[^;\s]+'),
]


def ocultar(s):
    if not s:
        return s
    s = re.sub(r'([a-z][a-z0-9+.-]*://)[^/@\s]+@', r'\1', s, flags=re.I)
    for rx in SECRETOS:
        s = rx.sub(lambda m: (m.group(1) if m.groups() else '') + '<oculto>', s)
    return s


def leer_equipo(alias):
    if alias == 'local':
        cmd = ['python3', '-']
    else:
        cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 -']
    try:
        r = subprocess.run(cmd, input=LECTOR, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return None, 'tiempo agotado'
    if r.returncode != 0:
        return None, (r.stderr.strip().splitlines() or ['sin conexión'])[-1][:200]
    try:
        return json.loads(r.stdout), None
    except Exception:
        return None, 'respuesta ilegible'


def agente_de(directorio, alias):
    """Código del agente según la carpeta de la sesión, o None si no se reconoce."""
    partes = [p.lower() for p in re.split(r'[\\/]+', directorio or '') if p]
    mapa = ALIAS.get(alias, {})
    codigos = {a['code'] for a in FLOTA['agentes'] if a['host'] == alias}
    for p in reversed(partes):
        p2 = p.replace('fleet-probe-', '')
        if p2 in mapa:
            return mapa[p2]
        if p2 in codigos:
            return p2
    return None


RX_WIKI = re.compile(r'\[\[([^\]|#]+)')


def armar(alias, datos):
    """Agrupa por agente y arma memorias + enlaces para el POST."""
    por_agente, sin_dueno = {}, 0
    por_sync = {}
    for o in datos.get('obs', []):
        code = agente_de(o.get('directory'), alias)
        if not code:
            sin_dueno += 1
            continue
        clave = 'obs:%s' % o['id']
        m = {
            'sourceKey': clave,
            'title': ocultar((o.get('title') or '').strip())[:400],
            'content': ocultar(o.get('content') or '')[:20000],
            'type': o.get('type') or 'otro',
            'topic': ocultar(o.get('topic_key') or '') or None,
            'createdAt': o.get('created_at'),
            'updatedAt': o.get('updated_at') or o.get('created_at'),
        }
        if not m['title']:
            continue
        ag = por_agente.setdefault(code, {'code': code, 'source': 'engram', 'memories': [], 'links': []})
        ag['memories'].append(m)
        if o.get('sync_id'):
            por_sync[o['sync_id']] = (code, clave)

    # Enlaces: relaciones juzgadas de engram + [[wikilinks]] al tema o título de otra memoria.
    for r in datos.get('rel', []):
        a = por_sync.get(r.get('source_id'))
        b = por_sync.get(r.get('target_id'))
        if a and b and a[0] == b[0]:
            por_agente[a[0]]['links'].append({'from': a[1], 'to': b[1], 'relation': (r.get('relation') or 'related')[:40]})
    for ag in por_agente.values():
        indice = {}
        for m in ag['memories']:
            for k in filter(None, [m['topic'], m['title']]):
                k = k.lower().strip()
                indice.setdefault(k, m['sourceKey'])
                indice.setdefault(k.split('/')[-1], m['sourceKey'])
        vistos = set()
        for m in ag['memories']:
            for ref in RX_WIKI.findall(m['content'] or ''):
                destino = indice.get(ref.lower().strip())
                if destino and destino != m['sourceKey'] and (m['sourceKey'], destino) not in vistos:
                    vistos.add((m['sourceKey'], destino))
                    ag['links'].append({'from': m['sourceKey'], 'to': destino, 'relation': 'wikilink'})
            # Mismo tema = enlace (como las notas de una misma carpeta en Obsidian).
        por_tema = {}
        for m in ag['memories']:
            if m['topic']:
                por_tema.setdefault(m['topic'].split('/')[0].lower(), []).append(m['sourceKey'])
        for claves in por_tema.values():
            for x, y in zip(claves, claves[1:]):
                ag['links'].append({'from': x, 'to': y, 'relation': 'mismo_tema'})
    return list(por_agente.values()), sin_dueno


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


def publicar(url, key, cuerpo):
    req = urllib.request.Request(url + '/api/chat/auditoria/memorias', data=json.dumps(cuerpo).encode('utf-8'),
                                 method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
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
    solo = set(args[args.index('--solo') + 1].split(',')) if '--solo' in args else None
    ensayo = '--ensayo' in args
    url = key = None
    if not ensayo:
        url, key = leer_conf()
    equipos = [e for e in FLOTA['equipos'] if not solo or e in solo]
    for alias in equipos:
        etiqueta = FLOTA['equipos'][alias]
        datos, err = leer_equipo(alias)
        if datos is None:
            log('%s: no se pudo leer (%s)' % (etiqueta, err))
            continue
        if datos.get('sin_engram'):
            log('%s: sin base de engram' % etiqueta)
            continue
        agentes, sin_dueno = armar(alias, datos)
        resumen = ', '.join('%s=%d/%d' % (a['code'], len(a['memories']), len(a['links'])) for a in agentes)
        log('%s: %s (sin agente reconocido: %d)' % (etiqueta, resumen or 'nada', sin_dueno))
        if ensayo or not agentes:
            continue
        cuerpo = {'host': etiqueta, 'collectorVersion': VERSION, 'agents': agentes,
                  'errors': ['%d memorias sin agente reconocido' % sin_dueno] if sin_dueno else []}
        code, body = publicar(url, key, cuerpo)
        log('%s: publicado HTTP %s %s' % (etiqueta, code, json.dumps(body, ensure_ascii=False)[:300]))


if __name__ == '__main__':
    main()
