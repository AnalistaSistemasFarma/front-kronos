#!/usr/bin/env python3
"""
Genera el SQL de carga de un CORTE de «Casos de uso» (Auditoría de agentes).

Entrada (salidas del análisis de conversaciones, ver justificacion-ia):
  --matriz  matriz-g1.json matriz-g2.json ...   (documentadores: rol, nivel, hecho, en curso, observaciones)
  --recurrencia recurrencia.json                (recurrencia medida por caso de uso)
  --resumen resultado.json                      (horas netas estimadas por agente)
  --tareas tareas.json                          (tareas por agente para contar tareas, recientes y personas)
  --corte 2026-10-29 --desde 2026-09-07 --recientes 2026-10-15 --base KRONOSDB_PRUEBAS|KRONOSDB

Salida: un .sql idempotente (borra el corte y lo vuelve a cargar) con guarda de base.
Solo agentes ya registrados (por código). No lleva datos personales: los textos ya vienen sin
nombres ni credenciales.
"""
import argparse, collections, json

def q(v, n=None):
    if v is None or v == '':
        return 'NULL'
    s = str(v)
    if n: s = s[:n]
    return "N'" + s.replace("'", "''") + "'"

def num(v):
    return 'NULL' if v is None or v == '' else str(v)

ap = argparse.ArgumentParser()
ap.add_argument('--matriz', nargs='+', required=True)
ap.add_argument('--recurrencia', required=True)
ap.add_argument('--resumen', required=True)
ap.add_argument('--tareas', required=True)
ap.add_argument('--corte', required=True)
ap.add_argument('--desde', required=True)
ap.add_argument('--recientes', required=True)
ap.add_argument('--base', required=True, choices=['KRONOSDB_PRUEBAS', 'KRONOSDB'])
ap.add_argument('--salida', required=True)
a = ap.parse_args()

mat = []
for f in a.matriz:
    mat += json.load(open(f))
rec = json.load(open(a.recurrencia))
horas = {f[0]: (f[3], f[4], f[5]) for f in json.load(open(a.resumen))['filas']}
tareas = [e for e in json.load(open(a.tareas)) if e['agente'] and e['agente_msgs'] > 0]
n = collections.Counter(e['agente'] for e in tareas)
nr = collections.Counter(e['agente'] for e in tareas if e['inicio'] >= a.recientes)
pers = collections.defaultdict(set)
for e in tareas:
    pers[e['agente']].add(e['persona'])

GUARDA = f"IF DB_NAME() <> N'{a.base}' THROW 51585, N'Base no esperada para esta carga.', 1;"
# Lotes separados por GO (el conector de PRUEBAS limita el tamaño de cada lote). Idempotente:
# el primer lote borra el corte; si algo falla a la mitad, se vuelve a correr completo.
L = [f"/* Carga del corte {a.corte} de Casos de uso — generado por scripts/agent-use-cases/generar_carga.py */",
     "SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;", GUARDA,
     f"DELETE FROM dbo.agent_use_case WHERE corte = '{a.corte}';",
     f"DELETE FROM dbo.agent_use_summary WHERE corte = '{a.corte}';", "GO"]
INS = []
for m in mat:
    c = m['code']; h = horas.get(c, (None, None, None))
    INS.append(
        "INSERT INTO dbo.agent_use_summary (id_agent, corte, periodo_desde, rol_resumen, nivel_uso, departamento, tareas, tareas_recientes, personas, horas_bajo, horas_base, horas_alto, observaciones) "
        f"SELECT id_agent, '{a.corte}', '{a.desde}', {q(m.get('rol_resumen'), 1000)}, {q(m.get('nivel_uso') or 'bajo', 20)}, {q(m.get('departamento'), 120)}, "
        f"{n.get(c, 0)}, {nr.get(c, 0)}, {len(pers.get(c, ()))}, {num(h[0])}, {num(h[1])}, {num(h[2])}, {q(m.get('observaciones'), 2000)} "
        f"FROM dbo.agent WHERE code = {q(c)};")
    for t in m.get('en_curso', []):
        INS.append(
            "INSERT INTO dbo.agent_use_case (id_agent, corte, tipo, caso, clase) "
            f"SELECT id_agent, '{a.corte}', N'en_curso', {q(t.get('tema'), 300)}, {q(t.get('estado'), 30)} FROM dbo.agent WHERE code = {q(c)};")
for r in rec:
    INS.append(
        "INSERT INTO dbo.agent_use_case (id_agent, corte, tipo, caso, descripcion, clase, ritmo, veces, veces_mes, dias, semanas, personas, primera, ultima, area, sistemas, entregable, candidato_automatizar) "
        f"SELECT id_agent, '{a.corte}', N'hecho', {q(r['caso'], 300)}, {q(r.get('descripcion'), 1000)}, {q(r['clase'], 30)}, {q(r.get('ritmo'), 30)}, "
        f"{num(r['veces'])}, {round(r['veces'] / 7.6 * 4.33, 1)}, {num(r['dias'])}, {num(r['semanas'])}, {num(r['personas'])}, "
        f"{q(r.get('primera'))}, {q(r.get('ultima'))}, {q(r.get('area'), 120)}, {q(r.get('sistemas'), 300)}, {q(r.get('entregable'), 300)}, "
        f"{1 if r['clase'] == 'Recurrente' else 0} FROM dbo.agent WHERE code = {q(r['code'])};")
for i in range(0, len(INS), 50):
    L += ["SET NOCOUNT ON;", GUARDA] + INS[i:i + 50] + ["GO"]
L += [f"SELECT (SELECT COUNT(*) FROM dbo.agent_use_summary WHERE corte = '{a.corte}') AS agentes, "
      f"(SELECT COUNT(*) FROM dbo.agent_use_case WHERE corte = '{a.corte}') AS casos;"]
open(a.salida, 'w').write('\n'.join(L) + '\n')
print(a.salida, len(mat), 'agentes', len(rec), 'casos')
