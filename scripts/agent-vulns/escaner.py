#!/usr/bin/env python3
"""
ESCÁNER DE VULNERABILIDADES (OSV) — Auditoría de agentes → Vulnerabilidades.

Pedido de Nicolás Rivera (2026-11-19): «consumiendo la API de OSV queremos averiguar las
vulnerabilidades recientes todo el tiempo para poder protegernos rápidamente».

Qué hace:
  1. Lee de GitHub (gh, solo lectura) los archivos de dependencias de cada repositorio y rama:
     package-lock.json (npm), go.mod (Go) y requirements*.txt (PyPI).
  2. Consulta en OSV (https://api.osv.dev) cada paquete + versión, en lotes (querybatch). A OSV solo
     viajan nombres de paquetes públicos y sus versiones: nada del código ni de la empresa.
  3. Trae el detalle de cada vulnerabilidad (severidad, versión que la corrige, CVE, enlace) y publica
     los hallazgos en SynerLink (POST /api/chat/auditoria/vulnerabilidades) con la llave del recolector.

  python3 escaner.py --ronda        # cada 5 min: solo trabaja si alguien pulsó «Escanear ahora»
  python3 escaner.py --programado   # cada 6 h: escaneo completo programado
  python3 escaner.py --ensayo       # escanea y muestra el resumen; no publica
  Destinos: --conf <archivo> (repetible) o AGENT_VULNS_CONF; por omisión ~/.horus/agent-inventory/collector.env (PRUEBAS).
  Repositorios: lista por omisión abajo; se puede reemplazar con ~/.horus/agent-vulns/repos.json [{"repo": "org/nombre", "ramas": ["main"]}].
"""
import concurrent.futures as cf, datetime as dt, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request

CONF = pathlib.Path(os.path.expanduser('~/.horus/agent-inventory/collector.env'))
REPOS_JSON = pathlib.Path(os.path.expanduser('~/.horus/agent-vulns/repos.json'))
OSV = 'https://api.osv.dev/v1'
REPOS = [
    {'repo': 'AnalistaSistemasFarma/front-kronos', 'ramas': ['main', 'testing']},
    {'repo': 'gsslatam/sapsend', 'ramas': ['production', 'testing']},
    {'repo': 'AnalistaSistemasFarma/front-orion', 'ramas': ['testing', 'main']},
    {'repo': 'AnalistaSistemasFarma/gss-landingpage', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/gss-tech-dashboard', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/terceros-app', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/api-sap', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/conector-directorio-th', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/farmadosis-front', 'ramas': [None]},
    {'repo': 'AnalistaSistemasFarma/respaldo-agentes', 'ramas': [None]},
    {'repo': 'NicolasRivera03/mcp-sapbo', 'ramas': [None]},
    {'repo': 'NicolasRivera03/sapsendmailer', 'ramas': [None]},
    {'repo': 'NicolasRivera03/farmasendmailer', 'ramas': [None]},
]
ARCHIVOS = re.compile(r'(^|/)(package-lock\.json|go\.mod|requirements[^/]*\.txt)$')


def log(m):
    print('%s %s' % (dt.datetime.now().isoformat(timespec='seconds'), m), flush=True)


# ── SynerLink ────────────────────────────────────────────────────────────────
def conf(ruta):
    c = {}
    for l in pathlib.Path(ruta).read_text().splitlines():
        if '=' in l and not l.lstrip().startswith('#'):
            k, v = l.split('=', 1); c[k.strip()] = v.strip().strip('"')
    url, key = c.get('SYNERLINK_INVENTORY_URL', '').rstrip('/'), c.get('SYNERLINK_INVENTORY_KEY', '')
    if not url or len(key) < 32: sys.exit('Falta configurar %s' % ruta)
    return {'url': url, 'key': key}


def destinos(a):
    rutas = [a[i + 1] for i, x in enumerate(a) if x == '--conf' and i + 1 < len(a)]
    if not rutas and os.environ.get('AGENT_VULNS_CONF'):
        rutas = [r for r in os.environ['AGENT_VULNS_CONF'].split(':') if r]
    return [conf(os.path.expanduser(r)) for r in (rutas or [str(CONF)])]


def http(url, cuerpo=None, key=None, timeout=120, metodo=None):
    h = {'Content-Type': 'application/json', 'User-Agent': 'gss-vuln-scanner'}
    if key: h['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode() if cuerpo is not None else None, method=metodo or ('POST' if cuerpo is not None else 'GET'), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 'sin conexión', {'error': str(getattr(e, 'reason', e))[:200]}


def syner(d, ruta, cuerpo, timeout=300):
    return http(d['url'] + ruta, cuerpo, d['key'], timeout)


def progreso(d, id_run, texto):
    if id_run: syner(d, '/api/chat/auditoria/vulnerabilidades/solicitudes', {'progreso': id_run, 'texto': texto}, 30)


# ── GitHub (solo lectura) ────────────────────────────────────────────────────
def gh(ruta, raw=False):
    cmd = ['gh', 'api', ruta] + (['-H', 'Accept: application/vnd.github.raw'] if raw else [])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0: raise RuntimeError('gh %s: %s' % (ruta, (r.stderr or '').strip()[:160]))
    return r.stdout if raw else json.loads(r.stdout)


def archivos_de(repo, rama):
    if not rama: rama = gh('repos/%s' % repo)['default_branch']
    arbol = gh('repos/%s/git/trees/%s?recursive=1' % (repo, rama))
    rutas = [t['path'] for t in arbol.get('tree', []) if t.get('type') == 'blob' and ARCHIVOS.search(t['path']) and 'node_modules/' not in t['path']]
    return rama, rutas


# ── Lectura de dependencias ──────────────────────────────────────────────────
def npm(texto):
    d = json.loads(texto)
    raiz = d.get('packages', {}).get('', {})
    directas = set(raiz.get('dependencies', {})) | set(raiz.get('devDependencies', {})) | set(raiz.get('optionalDependencies', {}))
    out = []
    if 'packages' in d:
        for k, v in d['packages'].items():
            if not k or 'node_modules/' not in k or not v.get('version') or v.get('link'): continue
            nombre = k.rsplit('node_modules/', 1)[1]
            out.append((nombre, v['version'], k == 'node_modules/' + nombre and nombre in directas))
    else:  # lockfile v1
        def rec(deps, nivel):
            for n, v in (deps or {}).items():
                if v.get('version'): out.append((n, v['version'], nivel == 0))
                rec(v.get('dependencies'), nivel + 1)
        rec(d.get('dependencies'), 0)
    return [('npm', n, v, dirc) for n, v, dirc in out if re.match(r'^\d', v)]


def gomod(texto):
    out, bloque = [], False
    for l in texto.splitlines():
        l = l.split('//')[0].strip()
        if l.startswith('require ('): bloque = True; continue
        if bloque and l == ')': bloque = False; continue
        m = re.match(r'^(?:require\s+)?([\w./~-]+\.[\w./~-]+)\s+(v[\w.+-]+)$', l) if (bloque or l.startswith('require ')) else None
        if m: out.append(('Go', m.group(1), m.group(2), True))
    return out


def requirements(texto):
    out = []
    for l in texto.splitlines():
        m = re.match(r'^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([A-Za-z0-9_.+-]+)', l)
        if m: out.append(('PyPI', m.group(1), m.group(2), True))
    return out


def dependencias(repo, rama, ruta):
    t = gh('repos/%s/contents/%s?ref=%s' % (repo, ruta, rama), raw=True)
    if ruta.endswith('package-lock.json'): return npm(t)
    if ruta.endswith('go.mod'): return gomod(t)
    return requirements(t)


# ── OSV ──────────────────────────────────────────────────────────────────────
def osv_lote(paquetes):
    """paquetes: [(eco, nombre, version)] → {(eco, nombre, version): [ids]}"""
    res = {}
    for i in range(0, len(paquetes), 900):
        trozo = paquetes[i:i + 900]
        q = [{'package': {'ecosystem': e, 'name': n}, 'version': v} for e, n, v in trozo]
        c, r = http(OSV + '/querybatch', {'queries': q}, timeout=180)
        if c != 200: raise RuntimeError('OSV querybatch HTTP %s' % c)
        for p, item in zip(trozo, r.get('results', [])):
            ids = [x['id'] for x in item.get('vulns', []) or []]
            if ids: res[p] = ids
    return res


def osv_detalle(vid):
    c, r = http(OSV + '/vulns/' + vid, timeout=60)
    return r if c == 200 else {'id': vid}


SEV = {'CRITICAL': 'critica', 'HIGH': 'alta', 'MODERATE': 'media', 'MEDIUM': 'media', 'LOW': 'baja'}


def severidad(v):
    s = (v.get('database_specific') or {}).get('severity')
    if not s:
        for a in v.get('affected', []):
            s = (a.get('ecosystem_specific') or {}).get('severity') or (a.get('database_specific') or {}).get('severity')
            if s: break
    return SEV.get(str(s or '').upper(), 'desconocida')


def corregida(v, eco, nombre):
    fijas = []
    for a in v.get('affected', []):
        p = a.get('package', {})
        if p.get('name', '').lower() != nombre.lower() or p.get('ecosystem') != eco: continue
        for rg in a.get('ranges', []):
            fijas += [e['fixed'] for e in rg.get('events', []) if 'fixed' in e]
    return ', '.join(dict.fromkeys(fijas))[:200] or None


def referencia(v):
    refs = v.get('references', [])
    for tipo in ('ADVISORY', 'WEB', 'REPORT', 'FIX'):
        for r in refs:
            if r.get('type') == tipo and str(r.get('url', '')).startswith('https://'): return r['url'][:500]
    return 'https://osv.dev/vulnerability/' + v.get('id', '')


# ── Escaneo ──────────────────────────────────────────────────────────────────
def repos_config():
    try:
        return json.loads(REPOS_JSON.read_text()) if REPOS_JSON.exists() else REPOS
    except Exception:
        return REPOS


def escanear(aviso=lambda t: None):
    usos, errores = [], []   # usos: (repo, rama, archivo, eco, nombre, version, directa)
    lista = repos_config()
    for i, r in enumerate(lista, 1):
        for rama in r.get('ramas') or [None]:
            try:
                rama_real, rutas = archivos_de(r['repo'], rama)
                for ruta in rutas:
                    for eco, n, v, dirc in dependencias(r['repo'], rama_real, ruta):
                        usos.append((r['repo'], rama_real, ruta, eco, n, v, dirc))
            except Exception as e:
                errores.append('%s@%s: %s' % (r['repo'], rama or 'defecto', str(e)[:120]))
        aviso('Leyendo dependencias: repositorio %d de %d…' % (i, len(lista)))
    unicos = sorted({(u[3], u[4], u[5]) for u in usos})
    log('repos %d · usos %d · paquetes únicos %d · errores %d' % (len(lista), len(usos), len(unicos), len(errores)))
    aviso('Consultando %d paquetes en OSV…' % len(unicos))
    afectados = osv_lote(unicos)
    ids = sorted({x for v in afectados.values() for x in v})
    aviso('Trayendo el detalle de %d vulnerabilidades…' % len(ids))
    with cf.ThreadPoolExecutor(8) as ex:
        det = dict(zip(ids, ex.map(osv_detalle, ids)))
    hallazgos, vistos = [], set()
    for repo, rama, ruta, eco, n, v, dirc in usos:
        for vid in afectados.get((eco, n, v), []):
            clave = (repo, rama, ruta, n, v, vid)
            if clave in vistos: continue
            vistos.add(clave)
            d = det.get(vid, {})
            alias = ', '.join(a for a in d.get('aliases', []) if a.startswith(('CVE-', 'GHSA-')))[:400] or None
            hallazgos.append({'repo': repo, 'rama': rama, 'archivo': ruta, 'ecosistema': eco, 'paquete': n, 'version': v, 'directa': bool(dirc),
                              'vulnId': vid, 'alias': alias, 'resumen': (d.get('summary') or (d.get('details') or '')[:300] or None),
                              'severidad': severidad(d), 'publicada': d.get('published'), 'modificada': d.get('modified'),
                              'versionCorregida': corregida(d, eco, n), 'referencia': referencia(d)})
    return hallazgos, {'repos': len(lista), 'paquetes': len(unicos), 'errores': errores}


def resumen(h, s):
    from collections import Counter
    c = Counter(x['severidad'] for x in h)
    vul = len({x['vulnId'] for x in h})
    txt = '%d hallazgos (%d vulnerabilidades distintas) en %d paquetes revisados: %d críticos, %d altos, %d medios, %d bajos.' % (
        len(h), vul, s['paquetes'], c['critica'], c['alta'], c['media'], c['baja'])
    if s['errores']: txt += ' No se pudieron leer: ' + '; '.join(s['errores'])[:600]
    return txt


def main():
    a = sys.argv[1:]
    if '--ensayo' in a:
        h, s = escanear(log)
        print(resumen(h, s))
        from collections import Counter
        print(Counter((x['repo'].split('/')[1], x['rama'], x['severidad']) for x in h if x['severidad'] in ('critica', 'alta')).most_common(20))
        return
    programado = '--programado' in a
    for d in destinos(a):
        c, b = syner(d, '/api/chat/auditoria/vulnerabilidades/solicitudes', {'programado': True} if programado else {})
        if c != 200:
            if c != 503: log('%s: solicitudes HTTP %s' % (d['url'], c))
            continue
        esc = b.get('escaneo')
        if not esc: continue
        id_run = esc['id']
        log('%s: tomé el escaneo #%s (%s)' % (d['url'], id_run, esc.get('origen')))
        try:
            h, s = escanear(lambda t: progreso(d, id_run, t))
            c, b = syner(d, '/api/chat/auditoria/vulnerabilidades', {'idRun': id_run, 'repos': s['repos'], 'paquetes': s['paquetes'], 'resumen': resumen(h, s), 'hallazgos': h})
            log('%s: publicado HTTP %s %s' % (d['url'], c, json.dumps(b, ensure_ascii=False)[:200]))
            if c != 200: raise RuntimeError('publicación HTTP %s: %s' % (c, json.dumps(b, ensure_ascii=False)[:200]))
        except Exception as e:
            log('falló: %s' % str(e)[:300])
            syner(d, '/api/chat/auditoria/vulnerabilidades/solicitudes', {'fallo': id_run, 'error': str(e)[:300]})


if __name__ == '__main__':
    main()
