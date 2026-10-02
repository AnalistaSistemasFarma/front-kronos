#!/usr/bin/env python3
"""
HOJA DE VIDA DE LOS AGENTES (Auditoría de agentes, F2) — jobs de la Mac de horus.

  hoja_de_vida.py --nocturno [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD] [--historial-completo]
      Pide a SynerLink que recalcule las métricas diarias (por defecto los
      últimos 7 días) y complete la línea de tiempo. launchd
      com.horus.agent-cv-nocturno, 3:00 a. m. (después del inventario de las 2:30).

  hoja_de_vida.py --semanal [--semana YYYY-MM-DD] [--solo code1,code2] [--dry-run]
      Trae los INSUMOS de la semana (solo datos estructurados: cifras,
      inventario, hallazgos e historial; NUNCA texto de conversaciones), le pide
      a Claude un resumen por agente y lo publica. launchd
      com.horus.agent-cv-semanal, lunes 4:00 a. m. (resume la semana anterior).

Configuración: la misma del recolector del inventario
(~/.horus/agent-inventory/collector.env: SYNERLINK_INVENTORY_URL y
SYNERLINK_INVENTORY_KEY). Apunta solo a PRUEBAS mientras F2 esté en pruebas.

CLAUDE HEADLESS SIN TOCAR LA SESIÓN VIVA (memorias tema-claude-p-headless-curador
y gotcha-jobs-claude-p-matan-poller-telegram):
  - CLAUDE_CONFIG_DIR aislado (~/.horus/claude-config-hoja-vida): sin hooks,
    sin plugins, sin MCP; nunca el config de horus.
  - --settings con los plugins de Telegram y Teams apagados (no arranca un
    poller que le haga SIGTERM al de la sesión principal).
  - --tools "" y --strict-mcp-config: la IA no puede leer ni ejecutar nada; solo
    redacta con lo que se le pasa en el mensaje.
  - Token de ~/.horus/.env (CLAUDE_CODE_OAUTH_TOKEN), cwd neutro.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser('~')
CONF = os.environ.get('HV_CONF', os.path.join(HOME, '.horus/agent-inventory/collector.env'))
CLAUDE_BIN = os.environ.get('HV_CLAUDE_BIN', os.path.join(HOME, '.local/bin/claude'))
CLAUDE_CONFIG = os.environ.get('HV_CLAUDE_CONFIG', os.path.join(HOME, '.horus/claude-config-hoja-vida'))
TOKEN_ENV = os.path.join(HOME, '.horus/.env')
TRABAJO = os.path.join(HOME, '.horus/agent-cv/trabajo')
MODELO = os.environ.get('HV_MODEL', 'sonnet')
SETTINGS = json.dumps({'enabledPlugins': {
    'telegram@claude-plugins-official': False,
    'teams@claude-plugins-official': False,
}})


def log(msg):
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}", flush=True)


def leer_env(path):
    out = {}
    if not os.path.exists(path):
        return out
    for linea in open(path, encoding='utf-8-sig'):
        linea = linea.strip()
        if not linea or linea.startswith('#') or '=' not in linea:
            continue
        k, v = linea.split('=', 1)
        out[k.strip().removeprefix('export ').strip()] = v.strip().strip('"').strip("'")
    return out


def conf():
    c = leer_env(CONF)
    url, key = c.get('SYNERLINK_INVENTORY_URL'), c.get('SYNERLINK_INVENTORY_KEY')
    if not url or not key:
        sys.exit(f'Falta SYNERLINK_INVENTORY_URL o SYNERLINK_INVENTORY_KEY en {CONF}')
    return url.rstrip('/'), key


def http(metodo, url, key, cuerpo=None, timeout=300):
    data = json.dumps(cuerpo).encode('utf-8') if cuerpo is not None else None
    req = urllib.request.Request(url, data=data, method=metodo, headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        return e.code, {'error': e.read().decode('utf-8', 'replace')[:500]}


# ── Nocturno ────────────────────────────────────────────────────────────────

def nocturno(args):
    url, key = conf()
    cuerpo = {}
    if args.desde:
        cuerpo['desde'] = args.desde
    if args.hasta:
        cuerpo['hasta'] = args.hasta
    if args.historial_completo:
        cuerpo['historialCompleto'] = True
    st, r = http('POST', url + '/api/chat/auditoria/hoja-de-vida/nocturno', key, cuerpo)
    if st != 200:
        log(f'ERROR nocturno HTTP {st}: {r}')
        return 1
    m, h = r.get('metricas', {}), r.get('historial', {})
    log(f"nocturno: métricas {m.get('desde')}..{m.get('hasta')} = {m.get('filas')} filas; "
        f"historial {h.get('creadas')} entradas nuevas de {h.get('revisadas')} revisadas; {r.get('ms')} ms")
    return 0


# ── Semanal ─────────────────────────────────────────────────────────────────

INSTRUCCIONES = """Usted redacta el resumen semanal de la hoja de vida de un agente de inteligencia artificial de Group Shared Services Latinoamérica, para el equipo de Gobierno de IA.

Reglas obligatorias:
- Escriba en español colombiano formal, en tercera persona, como lo contaría una persona: prosa natural, sin listas, sin títulos, sin Markdown y sin tono de reporte técnico.
- Entre 3 y 5 frases, máximo 900 caracteres.
- Use SOLO los datos del bloque JSON. No invente nada ni suponga de qué trataron las conversaciones: no tiene acceso a ellas y no debe sugerir que sí.
- Diga qué tanto se usó el agente en la semana y cómo se compara con la semana anterior, si hubo cambios en su inventario (herramientas, MCP, skills, modelo) y cómo está en riesgos (hallazgos abiertos, en especial críticos y altos, y los que se abrieron o cerraron).
- Cifras en formato colombiano (1.234.567). Fechas en prosa ("28 de septiembre de 2026"). Los tokens, como "consumo de tokens".
- No use nombres de tablas, campos ni términos de programación. Puede nombrar MCP o skills tal como vienen.
- Responda únicamente con el texto del resumen."""


def fmt(n):
    return f'{int(n):,}'.replace(',', '.')


MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
         'septiembre', 'octubre', 'noviembre', 'diciembre']


def fecha_prosa(dia):
    a, m, d = (int(x) for x in dia.split('-'))
    return f'{d} de {MESES[m - 1]} de {a}'


def sin_actividad(a, semana):
    s = a['semanaActual']
    return (s['mensajesRecibidos'] + s['mensajesEnviados'] + s['turnos'] == 0
            and not a['historialDeLaSemana'])


def resumen_sin_actividad(a, semana):
    """Sin uso ni cambios no hace falta la IA: el texto se arma aquí mismo."""
    h = a['hallazgosAbiertos']
    graves = h['critico'] + h['alto']
    total = sum(h.values())
    partes = [f"Durante la semana del {fecha_prosa(semana['desde'])} al {fecha_prosa(semana['hasta'])}, {a['nombre']} no registró actividad en SynerLink y su inventario no tuvo cambios."]
    if total == 0:
        partes.append('No tiene hallazgos de riesgo abiertos.')
    else:
        detalle = []
        if h['critico']:
            detalle.append(f"{fmt(h['critico'])} {'crítico' if h['critico'] == 1 else 'críticos'}")
        if h['alto']:
            detalle.append(f"{fmt(h['alto'])} {'alto' if h['alto'] == 1 else 'altos'}")
        partes.append(f"Mantiene {fmt(total)} {'hallazgo abierto' if total == 1 else 'hallazgos abiertos'}"
                      + (f", de los cuales {' y '.join(detalle)} {'requiere' if graves == 1 else 'requieren'} atención prioritaria." if detalle else '.'))
    if a['usuariosAsignados'] == 0:
        partes.append('Nadie lo tiene asignado en este momento.')
    return ' '.join(partes)


def redactar(a, semana):
    datos = json.dumps({'semana': semana, 'agente': a}, ensure_ascii=False, indent=1)
    prompt = f"{INSTRUCCIONES}\n\nDatos:\n```json\n{datos}\n```"
    env = dict(os.environ)
    env.update({k: v for k, v in leer_env(TOKEN_ENV).items() if k == 'CLAUDE_CODE_OAUTH_TOKEN'})
    env['CLAUDE_CONFIG_DIR'] = CLAUDE_CONFIG
    env['DISABLE_AUTOUPDATER'] = '1'
    os.makedirs(TRABAJO, exist_ok=True)
    cmd = [CLAUDE_BIN, '-p', prompt, '--model', MODELO, '--tools', '', '--strict-mcp-config',
           '--no-session-persistence', '--settings', SETTINGS]
    r = subprocess.run(cmd, cwd=TRABAJO, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or '').strip()[:300])
    return r.stdout.strip()


def semanal(args):
    url, key = conf()
    q = f'?semana={args.semana}' if args.semana else ''
    st, ins = http('GET', url + '/api/chat/auditoria/hoja-de-vida/resumen' + q, key)
    if st != 200:
        log(f'ERROR insumos HTTP {st}: {ins}')
        return 1
    semana = ins['semana']
    solo = set(x.strip().lower() for x in args.solo.split(',')) if args.solo else None
    agentes = [a for a in ins['agentes'] if not solo or a['code'].lower() in solo]
    log(f"semanal: semana {semana['desde']}..{semana['hasta']}, {len(agentes)} agentes")

    resumenes, fallas, ia, plantilla = [], [], 0, 0
    for a in agentes:
        huella = hashlib.sha256(json.dumps(a, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
        try:
            if sin_actividad(a, semana):
                texto, modelo = resumen_sin_actividad(a, semana), 'plantilla-sin-actividad'
                plantilla += 1
            else:
                texto, modelo = redactar(a, semana), MODELO
                ia += 1
            if len(texto) < 40:
                raise RuntimeError('respuesta vacía o demasiado corta')
            resumenes.append({'code': a['code'], 'summary': texto[:2500], 'model': modelo, 'inputHash': huella})
            if args.dry_run:
                print(f"\n── {a['code']} ({modelo})\n{texto}")
        except Exception as e:  # un agente que falla no tumba la corrida
            fallas.append(f"{a['code']}: {e}")
            log(f"falló {a['code']}: {e}")

    if args.dry_run:
        log(f'dry-run: {len(resumenes)} resúmenes ({ia} con IA, {plantilla} sin actividad), {len(fallas)} fallas; nada publicado')
        return 0

    publicados = 0
    for i in range(0, len(resumenes), 20):
        st, r = http('POST', url + '/api/chat/auditoria/hoja-de-vida/resumen', key,
                     {'semana': semana['desde'], 'resumenes': resumenes[i:i + 20]})
        if st != 200:
            log(f'ERROR publicando lote {i // 20 + 1}: HTTP {st}: {r}')
            fallas.append(f'lote {i // 20 + 1}: HTTP {st}')
            continue
        publicados += len(r.get('guardados', []))
    log(f'semanal: {publicados} publicados ({ia} con IA, {plantilla} sin actividad), {len(fallas)} fallas')
    return 1 if fallas else 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--nocturno', action='store_true')
    g.add_argument('--semanal', action='store_true')
    p.add_argument('--desde')
    p.add_argument('--hasta')
    p.add_argument('--historial-completo', action='store_true')
    p.add_argument('--semana')
    p.add_argument('--solo')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()
    sys.exit(nocturno(args) if args.nocturno else semanal(args))


if __name__ == '__main__':
    main()
