#!/usr/bin/env python3
"""
Regenera lib/agent-audit/skills-catalog.json — el catálogo de skills instalados
en los agentes de la flota GSS (página Auditoría de agentes → Skills).

USO (desde la Mac de Horus, que tiene llave SSH a los demás equipos):
    python3 scripts/agent-skills-catalog.py            # escanea y fusiona
    python3 scripts/agent-skills-catalog.py --dry-run  # solo muestra el conteo

QUÉ HACE, SOLO LECTURA:
  1. Ejecuta el escáner de abajo (SCAN) en la máquina local y por `ssh <host>`
     en cada equipo de HOSTS. Lee únicamente el frontmatter (name/description)
     de cada SKILL.md en:
       ~/.<bot>/claude-config/skills/*          -> skills del bot
       ~/.<bot>/claude-config/plugins/cache/**  -> skills de plugins instalados
       ~/.agents/skills/*, ~/.claude/skills/*   -> skills globales del usuario
       ~/.openclaw/{plugin-skills,workspace*/skills,agents/*/skills}/*
  2. Deduplica por nombre: un skill -> lista de {agent, host}.
  3. Conserva el `summary` y la `category` ya escritos en el JSON actual. Los
     skills NUEVOS quedan con la descripción original recortada y categoría
     "Otros", para que alguien escriba el resumen en español a mano.

NUNCA copia el contenido del SKILL.md: solo nombre, resumen, categoría y
agentes. No toca nada en los equipos (no reinicia, no escribe).
"""
import json, subprocess, sys, datetime, pathlib

HOSTS = {
    None: 'Mac de Horus',
    'pedro': 'Mac mini de Pedro',
    'jorge': 'Mac mini de Jorge',
    'lisa': 'Mac mini de Lisa',
}
ALIAS = {'~agents': 'global', '~claude': 'global', '~openclaw': 'openclaw'}
OUT = pathlib.Path(__file__).resolve().parent.parent / 'lib/agent-audit/skills-catalog.json'

SCAN = r'''
import os,glob,json,re,socket
H=os.path.expanduser('~')
out=[]
def fm(p):
    try: t=open(p,encoding='utf-8',errors='ignore').read(6000)
    except Exception: return None,None
    m=re.match(r'^---\s*\n(.*?)\n---',t,re.S)
    if not m: return None,None
    b=m.group(1);name=desc=None
    mm=re.search(r'^name:\s*(.+)$',b,re.M)
    if mm:name=mm.group(1).strip().strip('"\'')
    md=re.search(r'^description:\s*(.*?)(?=^\S[\w-]*:|\Z)',b,re.M|re.S)
    if md:
        d=md.group(1).strip()
        if d in('|','>','|-','>-'):d=''
        d=re.sub(r'^[|>]-?\s*','',d);d=' '.join(d.split()).strip('"\'')
        desc=d
    return name,desc
def add(agent,src,skdir):
    p=os.path.join(skdir,'SKILL.md')
    if not os.path.isfile(p):return
    n,d=fm(p);out.append(dict(agent=agent,src=src,dir=os.path.basename(skdir.rstrip('/')),name=n or os.path.basename(skdir),desc=(d or '')[:700]))
for cfg in glob.glob(H+'/.*/claude-config'):
    bot=cfg.split('/')[-2].lstrip('.')
    for s in glob.glob(cfg+'/skills/*'):add(bot,'skills',s)
    for p in glob.glob(cfg+'/plugins/**/skills/*/SKILL.md',recursive=True):
        if '/cache/' in p:
            add(bot,'plugin',os.path.dirname(p))
for s in glob.glob(H+'/.agents/skills/*'):add('~agents','agents',s)
for s in glob.glob(H+'/.claude/skills/*'):add('~claude','claude',s)
for p in glob.glob(H+'/.openclaw/plugin-skills/*/SKILL.md')+glob.glob(H+'/.openclaw/workspace*/skills/*/SKILL.md')+glob.glob(H+'/.openclaw/agents/*/skills/*/SKILL.md'):add('~openclaw','openclaw',os.path.dirname(p))
for p in glob.glob(H+'/.claude/plugins/cache/**/skills/*/SKILL.md',recursive=True):add('~claude','plugin',os.path.dirname(p))
print(json.dumps(out,ensure_ascii=False))
'''


def run(host):
    cmd = ['python3', '-'] if host is None else ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'python3 -']
    try:
        r = subprocess.run(cmd, input=SCAN, capture_output=True, text=True, timeout=120)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        return None


def main():
    prev = {}
    if OUT.exists():
        prev = {s['name']: s for s in json.loads(OUT.read_text())['skills']}
    skills, fallos = {}, []
    for host, label in HOSTS.items():
        rows = run(host)
        if rows is None:
            fallos.append(label)
            print(f'!! no se pudo leer {label}', file=sys.stderr)
            continue
        for x in rows:
            s = skills.setdefault(x['name'], {'desc': x['desc'], 'agents': set()})
            if len(x['desc']) > len(s['desc']):
                s['desc'] = x['desc']
            s['agents'].add((ALIAS.get(x['agent'], x['agent']), label))
    out = []
    for name in sorted(skills, key=str.lower):
        p = prev.get(name, {})
        out.append({
            'name': name,
            'summary': p.get('summary') or skills[name]['desc'][:280],
            'category': p.get('category') or 'Otros',
            'agents': [{'agent': a, 'host': h} for a, h in sorted(skills[name]['agents'])],
        })
    print(f'{len(out)} skills; equipos sin leer: {fallos or "ninguno"}')
    if '--dry-run' in sys.argv:
        return
    OUT.write_text(json.dumps({'generatedAt': datetime.date.today().isoformat(),
                               'skills': out}, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
