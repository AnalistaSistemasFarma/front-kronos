#!/usr/bin/env python3
"""
RECOLECTOR DE MEMORIAS DE LOS AGENTES (Auditoría de agentes → Memorias).

Lee en SOLO LECTURA la memoria PROPIA de cada agente —local o por SSH, igual que
el recolector del inventario—, oculta los secretos y publica por
POST /api/chat/auditoria/memorias con la llave del recolector del inventario
(~/.horus/agent-inventory/collector.env).

  - Claude Code: los .md de ~/.<bot>/claude-config/projects/*/memory/ (cada uno
    con su frontmatter); el índice MEMORY.md da el título de cada archivo y los
    [[wikilinks]] / enlaces .md entre archivos son los enlaces del mapa.
  - OpenClaw: el MEMORY.md (una memoria por sección «## ») y el diario
    memory/*.md del espacio de trabajo de cada agente (openclaw.json).

v2 (2026-10-29): ya NO se lee engram. engram guarda UNA base por equipo y mezcla
las memorias de todos los bots de esa máquina (Nicolás: «están mezcladas»).
Cada corrida publica engram vacío para retirar lo que quedó de la v1.

  python3 recolector_memorias.py                  # todos los equipos
  python3 recolector_memorias.py --solo local,pedro
  python3 recolector_memorias.py --ensayo         # no publica: muestra cifras
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

VERSION = '2.0.0'
AQUI = pathlib.Path(__file__).resolve().parent
FLOTA = json.loads((AQUI.parent / 'agent-inventory' / 'flota.json').read_text(encoding='utf-8'))
CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))

# Corre en el equipo (local o remoto). Solo lectura. Recibe los agentes del equipo.
LECTOR = r'''
import glob, json, os, re, sys
H = os.path.expanduser('~')
agentes = json.loads(sys.argv[1])
MAX = 400000
def leer(p):
    try:
        with open(p, encoding='utf-8', errors='replace') as f:
            return f.read(MAX)
    except Exception:
        return None
def mtime(p):
    try:
        return os.path.getmtime(p)
    except Exception:
        return None
salida = []
# OpenClaw: agente -> espacio de trabajo, de todos los openclaw*.json del equipo.
ws = {}
for cfg in glob.glob(os.path.join(H, '.openclaw*', 'openclaw.json')):
    if 'retirado' in cfg:
        continue
    try:
        c = json.load(open(cfg))
    except Exception:
        continue
    ag = c.get('agents', {})
    defecto = (ag.get('defaults') or {}).get('workspace') or os.path.join(os.path.dirname(cfg), 'workspace')
    e = ag.get('entries') or ag.get('list') or {}
    items = e.items() if isinstance(e, dict) else [(x.get('id'), x) for x in e]
    for k, v in items:
        if not k:
            continue
        w = (v or {}).get('workspace') or defecto
        for nombre in {str(k).lower(), str(((v or {}).get('identity') or {}).get('name') or k).lower()}:
            ws.setdefault(nombre, w)
for a in agentes:
    archivos = []
    if a['kind'] == 'claude-code' and a.get('dir'):
        for d in glob.glob(os.path.join(H, a['dir'], 'claude-config', 'projects', '*', 'memory')):
            proy = os.path.basename(os.path.dirname(d))
            for p in sorted(glob.glob(os.path.join(d, '*.md'))):
                archivos.append({'k': proy + '/' + os.path.basename(p), 'f': os.path.basename(p),
                                 't': leer(p), 'm': mtime(p)})
        salida.append({'code': a['code'], 'source': 'markdown', 'files': archivos})
    elif a['kind'] == 'openclaw':
        w = ws.get(a['code'])
        if w and os.path.isdir(w):
            for p in [os.path.join(w, 'MEMORY.md')] + sorted(glob.glob(os.path.join(w, 'memory', '*.md'))):
                if os.path.exists(p):
                    archivos.append({'k': os.path.relpath(p, w), 'f': os.path.basename(p), 't': leer(p), 'm': mtime(p)})
        salida.append({'code': a['code'], 'source': 'openclaw', 'files': archivos, 'sin_espacio': not (w and os.path.isdir(w))})
print(json.dumps(salida))
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


def frontmatter(texto):
    """(campos, cuerpo). Lector mínimo de YAML: claves simples y metadata.type."""
    if not texto.startswith('---'):
        return {}, texto
    fin = texto.find('\n---', 3)
    if fin < 0:
        return {}, texto
    campos = {}
    for linea in texto[3:fin].splitlines():
        m = re.match(r'^\s*([A-Za-z_]+):\s*(.*)$', linea)
        if m:
            v = m.group(2).strip().strip('"').strip("'")
            if v:
                campos.setdefault(m.group(1), v)
    return campos, texto[fin + 4:].lstrip('\n')


RX_INDICE = re.compile(r'^\s*-\s*(?:\S+\s+)?\[([^\]]+)\]\(([^)]+\.md)\)\s*(?:[—–-]\s*(.*))?$')
RX_WIKI = re.compile(r'\[\[([^\]|#]+)')
RX_MDLINK = re.compile(r'\]\(([^)\s]+\.md)\)')


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if ts else None


def tema_de_archivo(nombre):
    base = nombre[:-3] if nombre.endswith('.md') else nombre
    return base.split('-')[0].lower() if '-' in base else base.lower()


def armar_markdown(code, files):
    """Claude Code: un archivo = una memoria; MEMORY.md solo aporta títulos."""
    titulos = {}
    for f in files:
        if f['f'] == 'MEMORY.md' and f['t']:
            for linea in f['t'].splitlines():
                m = RX_INDICE.match(linea)
                if m:
                    titulos[os.path.basename(m.group(2))] = m.group(1).strip()
    memorias, por_nombre = [], {}
    for f in files:
        if f['f'] == 'MEMORY.md' or not f['t']:
            continue
        campos, cuerpo = frontmatter(f['t'])
        titulo = titulos.get(f['f']) or campos.get('name') or ''
        if not titulo:
            h = re.search(r'^#+\s+(.+)$', cuerpo, re.M)
            titulo = h.group(1).strip() if h else f['f'][:-3].replace('-', ' ')
        desc = campos.get('description')
        contenido = (desc + '\n\n' if desc else '') + cuerpo
        m = {
            'sourceKey': f['k'],
            'title': ocultar(titulo)[:400],
            'content': ocultar(contenido)[:20000],
            'type': campos.get('type') or 'otro',
            'topic': tema_de_archivo(f['f']),
            'createdAt': None,
            'updatedAt': iso(f['m']),
        }
        memorias.append(m)
        por_nombre[f['f'][:-3].lower()] = f['k']
    enlaces, vistos = [], set()
    for f, m in zip([x for x in files if x['f'] != 'MEMORY.md' and x['t']], memorias):
        refs = RX_WIKI.findall(f['t']) + [os.path.basename(x)[:-3] for x in RX_MDLINK.findall(f['t'])]
        for ref in refs:
            destino = por_nombre.get(ref.strip().lower())
            if destino and destino != m['sourceKey'] and (m['sourceKey'], destino) not in vistos:
                vistos.add((m['sourceKey'], destino))
                enlaces.append({'from': m['sourceKey'], 'to': destino, 'relation': 'wikilink'})
    return {'code': code, 'source': 'markdown', 'memories': memorias, 'links': enlaces}


def armar_openclaw(code, files):
    """OpenClaw: MEMORY.md partido por «## »; cada día del diario, una memoria."""
    memorias = []
    for f in files:
        if not f['t']:
            continue
        if f['f'] == 'MEMORY.md':
            partes = re.split(r'^##\s+', f['t'], flags=re.M)
            for i, p in enumerate(partes):
                p = p.strip()
                if not p:
                    continue
                titulo = p.splitlines()[0].strip('# ').strip() if i else 'Memoria principal'
                memorias.append({'sourceKey': '%s#%d' % (f['k'], i), 'title': ocultar(titulo)[:400],
                                 'content': ocultar(p)[:20000], 'type': 'otro', 'topic': 'memoria',
                                 'createdAt': None, 'updatedAt': iso(f['m'])})
        else:
            memorias.append({'sourceKey': f['k'], 'title': 'Diario ' + f['f'][:-3], 'content': ocultar(f['t'])[:20000],
                             'type': 'resumen', 'topic': 'diario', 'createdAt': None, 'updatedAt': iso(f['m'])})
    claves = [m['sourceKey'] for m in memorias]
    enlaces = [{'from': a, 'to': b, 'relation': 'mismo_archivo'} for a, b in zip(claves, claves[1:])
               if a.split('#')[0] == b.split('#')[0]]
    return {'code': code, 'source': 'openclaw', 'memories': memorias, 'links': enlaces}


def leer_equipo(alias, agentes):
    arg = json.dumps([{'code': a['code'], 'kind': a['kind'], 'dir': a.get('dir')} for a in agentes])
    if alias == 'local':
        cmd = ['python3', '-', arg]
    else:
        cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'python3 - ' + sh_quote(arg)]
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


def sh_quote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


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
    por_equipo = {}
    for a in FLOTA['agentes']:
        por_equipo.setdefault(a['host'], []).append(a)
    for alias, lista in por_equipo.items():
        if solo and alias not in solo:
            continue
        etiqueta = FLOTA['equipos'].get(alias, alias)
        datos, err = leer_equipo(alias, lista)
        if datos is None:
            log('%s: no se pudo leer (%s)' % (etiqueta, err))
            continue
        agentes, avisos = [], []
        for d in datos:
            if d.get('sin_espacio'):
                avisos.append('%s: sin espacio de trabajo de OpenClaw' % d['code'])
            armado = armar_markdown(d['code'], d['files']) if d['source'] == 'markdown' else armar_openclaw(d['code'], d['files'])
            agentes.append(armado)
            # Retira lo que la v1 publicó desde engram (mezclado entre bots).
            agentes.append({'code': d['code'], 'source': 'engram', 'memories': [], 'links': []})
        resumen = ', '.join('%s=%d/%d' % (a['code'], len(a['memories']), len(a['links']))
                            for a in agentes if a['source'] != 'engram' and a['memories'])
        log('%s: %s%s' % (etiqueta, resumen or 'sin memorias', (' · ' + '; '.join(avisos)) if avisos else ''))
        if ensayo:
            continue
        cuerpo = {'host': etiqueta, 'collectorVersion': VERSION, 'agents': agentes, 'errors': avisos}
        code, body = publicar(url, key, cuerpo)
        log('%s: publicado HTTP %s %s' % (etiqueta, code, json.dumps(body, ensure_ascii=False)[:300]))


if __name__ == '__main__':
    main()
