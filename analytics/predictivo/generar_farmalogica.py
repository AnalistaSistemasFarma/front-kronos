#!/usr/bin/env python3
"""
Motor predictivo — PILOTO Farmalógica S.A. (módulo "Predicciones" de SynerLink).

Lee las cachés SQLite compartidas de la flota (listas SharePoint GSSLATAM,
ver skill `consulta-sharepoint-gss`) y genera `lib/predictivo/farmalogica.json`,
un JSON compacto con NÚMEROS + TEXTOS YA REDACTADOS en lenguaje sencillo, que la
página /process/predicciones solo pinta (no calcula nada).

Fuentes (solo lectura; este script NUNCA escribe en SharePoint ni en SAP):
  - SAP Business One Farmalógica, vista `Farma_VentasB1SLQuery` (la MISMA vista
    que alimenta FAR - VENTAS) vía el conector MCP de solo lectura
    (SAP_MCP_URL, por defecto http://192.168.10.5:3012/mcp). Es la FUENTE DE
    VERDAD de ventas: desde 2026-07-28 el cargue SAP -> SharePoint dejó de
    subir facturas (solo sube notas crédito), así que FAR - VENTAS quedó sin
    julio (parcial), agosto ni septiembre. Si SAP no responde, se usa la caché
    de SharePoint y se descartan los meses incompletos.
  - far_ventas.db              FAR - VENTAS            (respaldo + conciliación)
  - far_inventario.db          FAR - INVENTARIO        (existencias por almacén)
  - far_lotes.db               FAR - LOTES             (lotes con fecha de fabricación)
  - far_registro_sanitario.db  FAR - REGISTRO SANITARIO (vida útil en meses)

Antes de correrlo, refresque las cachés (incremental, ~1-60 s c/u):
  cd /Users/horus/.horus/cache/far_ventas      && python3 far_ventas_export.py
  cd /Users/horus/.horus/cache/far_inventario  && python3 far_inventario_export.py
  cd /Users/horus/.horus/cache/far_lotes       && python3 far_lotes_export.py

Uso:
  python3 analytics/predictivo/generar_farmalogica.py            # escribe lib/predictivo/farmalogica.json
  python3 analytics/predictivo/generar_farmalogica.py --hoy 2026-09-24 --out /tmp/x.json
  python3 analytics/predictivo/generar_farmalogica.py --sin-sap   # solo SharePoint
  FAR_CACHE_DIR=/otra/ruta python3 analytics/predictivo/generar_farmalogica.py

Dependencias: Python 3.9+ y numpy (nada más: sin pandas/statsmodels, para que
corra en cualquier máquina de la flota).

Método (resumen):
  * Ventas netas mensuales (facturas + notas débito − notas crédito), deduplicadas.
  * Se descartan los meses finales "incompletos" (cargue parcial en SharePoint).
  * Pronóstico 1-3 meses: se prueban varios modelos simples y robustos
    (suavizamiento exponencial ETS(A,N,N) con y sin estacionalidad amortiguada,
    Holt amortiguado, promedio móvil) CONTRA dos referencias ingenuas (último
    valor y estacional-ingenuo = mismo mes del año anterior) y se elige el de
    menor WAPE en backtest de origen móvil. Si ninguna variante ETS le gana al
    ingenuo, se usa el ingenuo y se dice.
  * Productos con venta intermitente (muchos meses sin venta, ADI > 1,32):
    se agregan Croston y TSB como candidatos.
  * "¿Cómo le fue al pronóstico el mes pasado?": se re-corre todo con datos
    hasta el penúltimo mes cerrado y se compara con lo realmente vendido.
  * Rango probable = cuantiles p10-p90 de los errores relativos del backtest.
  * Confiabilidad Alta/Media/Baja según el error medio del backtest.
  * Inventario: días de cobertura = stock aprobado / venta diaria proyectada.
  * Lotes: vencimiento = fabricación + vida útil del registro sanitario; se
    simula la venta FEFO (primero lo que vence primero) al ritmo proyectado.
"""
import argparse
import json
import math
import os
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta

import numpy as np

CACHE_DIR = os.environ.get("FAR_CACHE_DIR", "/Users/horus/.horus/cache")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(REPO_ROOT, "lib", "predictivo", "farmalogica.json")

# Almacenes de producto terminado APROBADO (disponible para vender).
ALMACENES_APROBADOS = {"BAPPT", "BAPPT2", "BAPPT_YB"}
ALMACENES_CUARENTENA = {"BQAPT2"}
LEAD_TIME_DIAS = 30          # supuesto: tiempo de reposición (producción/compra)
COBERTURA_OBJETIVO_DIAS = 90  # pedir para quedar cubiertos ~3 meses
MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


# ----------------------------------------------------------------- formato
def pesos(v):
    """$1.234.567 (formato latino, sin decimales)."""
    s = f"{abs(round(v)):,.0f}".replace(",", ".")
    return f"-${s}" if v < 0 else f"${s}"


def pesos_corto(v):
    """$1.234 millones / $12,3 mil millones — para frases."""
    a = abs(v)
    if a >= 1e9:
        t = f"{a / 1e9:,.1f}".replace(".", ",") + " mil millones"
    elif a >= 1e6:
        t = f"{a / 1e6:,.0f}".replace(",", ".") + " millones"
    else:
        t = f"{a:,.0f}".replace(",", ".")
    return ("-$" if v < 0 else "$") + t


def pct1(x):
    """0.1034 -> '10,3 %'"""
    return f"{x * 100:.1f}".replace(".", ",") + " %"


def num(v):
    return f"{round(v):,.0f}".replace(",", ".")


def mes_nombre(ym):
    y, m = ym
    return f"{MESES_ES[m - 1]} {y}"


def fecha_larga(d):
    return f"{d.day} de {MESES_ES[d.month - 1]} de {d.year}"


def add_months(ym, k):
    y, m = ym
    t = y * 12 + (m - 1) + k
    return (t // 12, t % 12 + 1)


def ym_key(ym):
    return f"{ym[0]:04d}-{ym[1]:02d}"


# ----------------------------------------------------------------- lectura
def rows(db, cols):
    path = os.path.join(CACHE_DIR, db, f"{db}.db")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    sel = ", ".join(f"json_extract(data,'$.{c}')" for c in cols)
    out = conn.execute(f"SELECT {sel} FROM items").fetchall()
    conn.close()
    return out


def cargar_ventas():
    cols = ["Documento", "N_x00b0__x0020_Documento", "Linea", "Referencia",
            "Descripci_x00f3_n", "Cantidad", "Total", "Fecha", "TipoVenta", "Nombre"]
    crudas = rows("far_ventas", cols)
    vistos, ventas = set(), []
    for doc, ndoc, lin, ref, desc, cant, tot, fec, tipo, cli in crudas:
        if not fec:
            continue
        # Dedupe: el cargue SAP -> SharePoint reinserta filas idénticas.
        clave = (doc, ndoc, lin, ref, cant, tot, fec)
        if clave in vistos:
            continue
        vistos.add(clave)
        doc = (doc or "").strip()
        signo = -1 if doc.lower().startswith("nota") and "cr" in doc.lower() else 1
        ventas.append({
            "doc": doc, "ref": ref or "", "desc": (desc or "").strip(),
            "cant": float(cant or 0) * (signo if float(cant or 0) > 0 else 1),
            "total": float(tot or 0),  # las notas crédito ya vienen negativas
            "fecha": date.fromisoformat(fec[:10]), "tipo": tipo or "", "cliente": cli or "",
        })
    return len(crudas), ventas


SAP_MCP_URL = os.environ.get("SAP_MCP_URL", "http://192.168.10.5:3012/mcp")
SAP_VISTA_VENTAS = "Farma_VentasB1SLQuery"


def _mcp_post(body, sid=None):
    import urllib.request
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if sid:
        h["Mcp-Session-Id"] = sid
    req = urllib.request.Request(SAP_MCP_URL, json.dumps(body).encode(), h)
    with urllib.request.urlopen(req, timeout=300) as r:
        txt = r.read().decode()
        nuevo = r.headers.get("Mcp-Session-Id")
    if "data:" in txt[:200]:
        txt = "\n".join(l[5:] for l in txt.splitlines() if l.startswith("data:"))
    return (json.loads(txt) if txt.strip() else None), nuevo


def cargar_ventas_sap(desde="2024-01-01"):
    """Líneas de venta desde SAP (solo lectura: tools/call sap_query_view)."""
    _, sid = _mcp_post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                                   "clientInfo": {"name": "predictivo-gss", "version": "1"}}})
    _mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    res, _ = _mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
        "name": "sap_query_view",
        "arguments": {"view": SAP_VISTA_VENTAS, "filter": f"Fecha ge '{desde}'", "maxPageSize": 0}}}, sid)
    if not res or "result" not in res or res["result"].get("isError"):
        raise RuntimeError(f"SAP no respondió bien: {str(res)[:300]}")
    filas = json.loads(res["result"]["content"][0]["text"])["value"]
    ventas = []
    for r in filas:
        if not r.get("Fecha"):
            continue
        ventas.append({
            "doc": (r.get("Documento") or "").strip(), "ref": r.get("Referencia") or "",
            "desc": (r.get("Descripción") or "").strip(),
            "cant": float(r.get("Cantidad") or 0),  # en SAP las notas crédito ya vienen negativas
            "total": float(r.get("Total") or 0),
            "fecha": date.fromisoformat(r["Fecha"][:10]), "tipo": r.get("Tipo") or "",
            "cliente": r.get("Nombre") or "",
        })
    return ventas


def conciliar(v_sp, v_sap):
    """Brecha por mes SharePoint (deduplicado) vs SAP."""
    agg = lambda vs: defaultdict(lambda: [0, 0.0])
    a, b = agg(v_sp), agg(v_sap)
    for vs, d in ((v_sp, a), (v_sap, b)):
        for v in vs:
            k = ym_key((v["fecha"].year, v["fecha"].month))
            d[k][0] += 1
            d[k][1] += v["total"]
    out = []
    for m in sorted(set(a) | set(b)):
        sp_t, sap_t = a[m][1], b[m][1]
        dif = sap_t - sp_t
        out.append({"mes": m, "lineas_sharepoint": a[m][0], "lineas_sap": b[m][0],
                    "total_sharepoint": round(sp_t), "total_sap": round(sap_t),
                    "brecha": round(dif), "completo_en_sharepoint": abs(dif) <= max(1.0, 0.005 * abs(sap_t))})
    return out


# ----------------------------------------------------------------- modelos
def ses(y, alpha):
    lvl = y[0]
    for v in y[1:]:
        lvl = alpha * v + (1 - alpha) * lvl
    return lvl


def croston(y, alpha=0.1, tsb=False, beta=0.1):
    """Croston clásico / TSB para demanda intermitente. Devuelve el nivel por periodo."""
    nz = np.nonzero(y > 0)[0]
    if len(nz) == 0:
        return 0.0
    z = float(y[nz[0]])
    if tsb:
        p = len(nz) / len(y)
        for v in y[nz[0] + 1:]:
            p = beta * (1.0 if v > 0 else 0.0) + (1 - beta) * p
            if v > 0:
                z = alpha * v + (1 - alpha) * z
        return p * z
    intervalo = float(nz[0] + 1)
    q = 1
    for v in y[nz[0] + 1:]:
        if v > 0:
            z = alpha * v + (1 - alpha) * z
            intervalo = alpha * q + (1 - alpha) * intervalo
            q = 1
        else:
            q += 1
    return z / intervalo if intervalo else 0.0


def holt_amortiguado(y, h, alpha=0.4, beta=0.1, phi=0.8):
    lvl, tr = y[0], (y[1] - y[0]) if len(y) > 1 else 0.0
    for v in y[1:]:
        prev = lvl
        lvl = alpha * v + (1 - alpha) * (lvl + phi * tr)
        tr = beta * (lvl - prev) + (1 - beta) * phi * tr
    return np.array([lvl + sum(phi ** (i + 1) for i in range(k + 1)) * tr for k in range(h)])


def forecast(y, h, modelo, months):
    """Pronóstico h pasos. y: np.array; months: lista (y,m) alineada con y."""
    y = np.asarray(y, float)
    if modelo == "ingenuo":
        return np.maximum(np.full(h, y[-1]), 0)
    if modelo == "estacional_ingenuo":
        # mismo mes del año anterior; sin 12 meses de historia cae al último valor
        return np.maximum(np.array([y[len(y) - 12 + (k % 12)] if len(y) >= 12 else y[-1]
                                    for k in range(h)]), 0)
    if modelo in ("croston", "tsb"):
        return np.full(h, croston(y, tsb=(modelo == "tsb")))
    if modelo == "holt_amort":
        return np.maximum(holt_amortiguado(y, h), 0)
    if modelo == "promedio3":
        base = np.full(h, y[-3:].mean())
    elif modelo.startswith("ses"):
        a = float(modelo.split("_")[1])
        base = np.full(h, ses(y, a))
    else:
        raise ValueError(modelo)
    if modelo.endswith("_est") and len(y) >= 13:
        # índice estacional por mes del año, amortiguado 50 % (poca historia)
        idx = defaultdict(list)
        media = y.mean()
        for v, ym in zip(y, months):
            idx[ym[1]].append(v / media if media else 1)
        fut = [add_months(months[-1], k + 1) for k in range(h)]
        f = np.array([1 + 0.5 * (np.mean(idx[m[1]]) - 1) if idx[m[1]] else 1 for m in fut])
        # des-estacionalizar el nivel base con el índice del último tramo
        ult = np.mean([1 + 0.5 * (np.mean(idx[m[1]]) - 1) for m in months[-3:]])
        base = base / (ult or 1) * f
    return np.maximum(base, 0)


MODELOS_ETS = ["ses_0.3", "ses_0.5", "ses_0.3_est", "ses_0.5_est", "holt_amort"]
MODELOS_INGENUOS = ["ingenuo", "estacional_ingenuo"]
MODELOS = ["promedio3"] + MODELOS_ETS + MODELOS_INGENUOS
MODELOS_INTERMITENTES = ["croston", "tsb", "promedio3", "ingenuo"]
NOMBRE_MODELO = {
    "promedio3": "promedio de los últimos 3 meses",
    "ses_0.3": "suavizamiento exponencial (ETS)", "ses_0.5": "suavizamiento exponencial (ETS)",
    "ses_0.3_est": "suavizamiento exponencial con estacionalidad (ETS)",
    "ses_0.5_est": "suavizamiento exponencial con estacionalidad (ETS)",
    "holt_amort": "tendencia amortiguada (Holt)",
    "ingenuo": "último mes vendido (ingenuo)",
    "estacional_ingenuo": "mismo mes del año anterior (estacional-ingenuo)",
    "croston": "venta intermitente (Croston)", "tsb": "venta intermitente (TSB)",
}


def es_intermitente(y):
    """ADI (intervalo medio entre ventas) > 1,32 en los últimos 12 meses."""
    u = np.asarray(y[-12:], float)
    nz = int((u > 0).sum())
    return nz > 0 and len(u) / nz > 1.32


def backtest(y, months, modelo, h=3, n_origenes=6):
    """Errores de origen móvil: (relativos real/pronóstico-1, WAPE)."""
    errs, abs_err, real_sum = [], 0.0, 0.0
    n = len(y)
    for o in range(max(6, n - n_origenes - h + 1), n - 1):
        f = forecast(y[:o], min(h, n - o), modelo, months[:o])
        for k, fv in enumerate(f):
            abs_err += abs(y[o + k] - fv)
            real_sum += abs(y[o + k])
            if fv > 0:
                errs.append(y[o + k] / fv - 1)
    wape = abs_err / real_sum if real_sum else None
    return np.array(errs), wape


def pronosticar(y, months, h=3, intermitente=False):
    y = np.asarray(y, float)
    candidatos = MODELOS_INTERMITENTES if intermitente else MODELOS
    res = {}
    for m in candidatos:
        e, w = backtest(y, months, m, h)
        if w is None:
            continue
        res[m] = (w, e)
    if not res:  # serie sin ventas en el periodo de prueba
        res = {"ingenuo": (1.0, np.array([0.0]))}
    modelo = min(res, key=lambda m: res[m][0])
    err_medio, e = res[modelo]
    if len(e) == 0:
        e = np.array([0.0])
    f = forecast(y, h, modelo, months)
    lo_q, hi_q = np.quantile(e, [0.1, 0.9])
    lo_q, hi_q = min(lo_q, -0.08), max(hi_q, 0.08)  # banda mínima ±8 %
    out = []
    for k, fv in enumerate(f):
        ens = math.sqrt(k + 1)  # la incertidumbre crece con el horizonte
        out.append({"mes": ym_key(add_months(months[-1], k + 1)),
                    "esperado": round(float(fv)),
                    "min": round(float(max(fv * (1 + lo_q * ens), 0))),
                    "max": round(float(fv * (1 + hi_q * ens)))})
    conf = "Alta" if err_medio < 0.12 else "Media" if err_medio < 0.25 else "Baja"
    w_ing = min((res[m][0] for m in MODELOS_INGENUOS if m in res), default=None)
    w_ets = min((res[m][0] for m in MODELOS_ETS if m in res), default=None)
    return {"modelo": modelo, "modelo_nombre": NOMBRE_MODELO[modelo],
            "error_medio": round(float(err_medio), 3), "confiabilidad": conf, "pronostico": out,
            "intermitente": intermitente,
            "comparacion": {"wape": {m: round(float(w), 3) for m, (w, _) in res.items()},
                            "wape_mejor_ets": None if w_ets is None else round(float(w_ets), 3),
                            "wape_mejor_ingenuo": None if w_ing is None else round(float(w_ing), 3),
                            "gana_ingenuo": modelo in MODELOS_INGENUOS}}


def evaluar_mes_pasado(y, months, intermitente=False):
    """Pronóstico que se habría hecho con datos hasta el penúltimo mes cerrado vs lo real."""
    if len(y) < 8:
        return None
    p = pronosticar(y[:-1], months[:-1], 1, intermitente)["pronostico"][0]
    real = float(y[-1])
    err = abs(real - p["esperado"]) / abs(real) if real else None
    return {"mes": ym_key(months[-1]), "pronosticado": p["esperado"], "min": p["min"], "max": p["max"],
            "real": round(real), "error": None if err is None else round(err, 3),
            "dentro_del_rango": p["min"] <= real <= p["max"]}


# ----------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Genera el JSON del piloto predictivo de Farmalógica")
    ap.add_argument("--hoy", help="Fecha de corte YYYY-MM-DD (por defecto hoy)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--sin-sap", action="store_true", help="No consultar SAP (solo caché SharePoint)")
    ap.add_argument("--sin-cartera", action="store_true", help="No calcular la sección Cartera y caja")
    args = ap.parse_args()
    hoy = date.fromisoformat(args.hoy) if args.hoy else date.today()

    n_crudas, ventas_sp = cargar_ventas()
    ventas, conciliacion, fuente_ventas, error_sap = ventas_sp, [], "SharePoint (FAR - VENTAS)", None
    if not args.sin_sap:
        try:
            ventas_sap = cargar_ventas_sap()
            conciliacion = conciliar(ventas_sp, ventas_sap)
            ventas, fuente_ventas = ventas_sap, "SAP Business One (vista Farma_VentasB1SLQuery)"
        except Exception as exc:  # sin SAP: se sigue con SharePoint
            error_sap = str(exc)[:200]
            print(f"AVISO: SAP no disponible ({error_sap}); se usa solo SharePoint.")
    brechas = [c for c in conciliacion if not c["completo_en_sharepoint"]]

    # ---- serie mensual de ventas netas
    por_mes = defaultdict(float)
    lineas_mes = defaultdict(int)
    for v in ventas:
        ym = (v["fecha"].year, v["fecha"].month)
        por_mes[ym] += v["total"]
        lineas_mes[ym] += 1
    # el mes en curso nunca está cerrado
    meses = sorted(m for m in por_mes if m < (hoy.year, hoy.month))
    en_curso = [m for m in por_mes if m >= (hoy.year, hoy.month)]
    # meses finales incompletos: < 50 % de las líneas de la mediana de los 6 previos
    ultimo = len(meses) - 1
    while ultimo > 6:
        med = np.median([lineas_mes[m] for m in meses[ultimo - 6:ultimo]])
        if lineas_mes[meses[ultimo]] < 0.5 * med:
            ultimo -= 1
        else:
            break
    completos = meses[:ultimo + 1]
    incompletos = meses[ultimo + 1:] + sorted(en_curso)
    serie = np.array([por_mes[m] for m in completos])
    pv = pronosticar(serie, completos, 3)
    mp = evaluar_mes_pasado(serie, completos)

    # mes "objetivo" = el PRÓXIMO mes calendario (si cae en el horizonte; si no, el último)
    prox_ym = ym_key(add_months((hoy.year, hoy.month), 1))
    idx_obj = next((i for i, p in enumerate(pv["pronostico"]) if p["mes"] >= prox_ym),
                   len(pv["pronostico"]) - 1)
    obj = pv["pronostico"][idx_obj]
    ym_obj = tuple(int(x) for x in obj["mes"].split("-"))
    ym_prev = add_months(ym_obj, -1)
    ref_prev = por_mes.get(ym_prev) if ym_prev in completos else (
        pv["pronostico"][idx_obj - 1]["esperado"] if idx_obj > 0 else serie[-1])
    var = (obj["esperado"] / ref_prev - 1) * 100 if ref_prev else 0
    ym_ano = (ym_obj[0] - 1, ym_obj[1])
    var_ano = (obj["esperado"] / por_mes[ym_ano] - 1) * 100 if por_mes.get(ym_ano) else None

    # ---- productos: consumo mensual en unidades (solo artículos facturados)
    desc_ref = {}
    unid = defaultdict(lambda: defaultdict(float))
    valor12 = defaultdict(float)
    unid12 = defaultdict(float)
    hace12 = add_months(completos[-1], -11)
    for v in ventas:
        if v["tipo"] != "Articulos" or not v["ref"]:
            continue
        ym = (v["fecha"].year, v["fecha"].month)
        if ym not in completos:
            continue
        desc_ref.setdefault(v["ref"], v["desc"])
        unid[v["ref"]][ym] += v["cant"]
        if ym >= hace12:
            valor12[v["ref"]] += v["total"]
            unid12[v["ref"]] += v["cant"]

    def serie_ref(ref):
        return np.array([max(unid[ref].get(m, 0.0), 0.0) for m in completos])

    top = sorted(valor12, key=valor12.get, reverse=True)[:5]
    top_productos = []
    for ref in top:
        s = serie_ref(ref)
        inter = es_intermitente(s)
        p = pronosticar(s, completos, 3, inter)
        f1 = p["pronostico"][idx_obj]
        top_productos.append({
            "codigo": ref, "nombre": desc_ref[ref],
            "valor_12m": round(valor12[ref]),
            "unidades_mes_esperadas": f1["esperado"],
            "unidades_min": f1["min"], "unidades_max": f1["max"],
            "confiabilidad": p["confiabilidad"],
            "metodo": p["modelo_nombre"], "intermitente": inter,
            "frase_metodo": ("Se vende de forma intermitente (hay meses sin venta), por eso usamos un "
                             "método especial para este tipo de producto." if inter else
                             ("Aquí el método más simple (repetir lo reciente) acertó más que los "
                              "modelos, así que usamos ese." if p["comparacion"]["gana_ingenuo"] else
                              f"Método: {p['modelo_nombre']}.")),
            "frase": (f"Se esperan unas {num(f1['esperado'])} unidades en {MESES_ES[ym_obj[1]-1]} "
                      f"(entre {num(f1['min'])} y {num(f1['max'])})."),
        })

    # ---- inventario
    stock = defaultdict(float)
    cuarentena = defaultdict(float)
    nombre_inv = {}
    for cod, nom, alm, exi in rows("far_inventario",
                                   ["Codigo_de_Articuo", "Nombre_Articulo", "Codigo_Almacen", "En_Existencia"]):
        if not cod:
            continue
        nombre_inv[cod] = (nom or "").strip().strip('"')
        if alm in ALMACENES_APROBADOS:
            stock[cod] += float(exi or 0)
        elif alm in ALMACENES_CUARENTENA:
            cuarentena[cod] += float(exi or 0)

    # venta diaria proyectada: pronóstico del mes objetivo, suavizado con el
    # promedio de los últimos 6 meses (productos con venta intermitente).
    ritmo = {}
    intermitentes = set()
    for ref in unid:
        s = serie_ref(ref)
        if s[-12:].sum() <= 0:
            continue
        if (s[-6:] > 0).sum() >= 4:  # demanda regular
            f = forecast(s, 1, "ses_0.3", completos)[0]
            mensual = 0.5 * f + 0.5 * s[-6:].mean()
        elif es_intermitente(s):  # demanda intermitente: TSB (probabilidad x tamaño)
            mensual = forecast(s, 1, "tsb", completos)[0]
            intermitentes.add(ref)
        else:
            continue
        if mensual > 0:
            ritmo[ref] = mensual / 30.0

    productos_inv = []
    sin_stock = []  # se venden con regularidad pero no tienen existencias aprobadas
    for ref, diaria in ritmo.items():
        st = stock.get(ref, 0.0)
        if st <= 0 and ref in intermitentes:
            continue  # venta ocasional sin stock: no es alarma
        if st <= 0:
            # típicamente fabricación bajo pedido (exportación) o almacén no
            # incluido: no se alarma, se informa aparte.
            sin_stock.append(ref)
            continue
        dias = st / diaria if diaria else None
        if dias is None:
            continue
        nivel = "rojo" if dias < LEAD_TIME_DIAS else "amarillo" if dias < 60 else "verde"
        pedir = max(0.0, COBERTURA_OBJETIVO_DIAS * diaria - st - cuarentena.get(ref, 0.0))
        pedir = int(math.ceil(pedir / 10.0) * 10)
        fecha_pedido = hoy + timedelta(days=max(0, int(dias - LEAD_TIME_DIAS)))
        productos_inv.append({
            "codigo": ref, "nombre": desc_ref.get(ref) or nombre_inv.get(ref, ref),
            "stock": round(st), "cuarentena": round(cuarentena.get(ref, 0.0)),
            "venta_diaria": round(diaria, 1), "dias_cobertura": round(dias),
            "nivel": nivel, "sugerido_pedir": pedir, "pedir_antes_de": fecha_pedido.isoformat(),
            "intermitente": ref in intermitentes,
        })
    productos_inv.sort(key=lambda p: p["dias_cobertura"])
    en_riesgo_quiebre = [p for p in productos_inv if p["nivel"] != "verde"]

    # ---- lotes y registros sanitarios: vencimiento REAL por lote desde SAP
    # (lotes_registros_farmalogica.py). Si SAP no responde, se usa el cálculo
    # anterior: vencimiento = fabricación (FAR - LOTES) + vida útil del registro sanitario.
    lotes_registros, lotes_riesgo, fuente_lotes = None, None, "FAR - LOTES"
    if not args.sin_sap:
        try:
            from lotes_registros_farmalogica import generar as generar_lotes
            nombres = {r: (desc_ref.get(r) or nombre_inv.get(r)) for r in set(desc_ref) | set(nombre_inv)}
            lotes_registros, lotes_riesgo, n_lotes = generar_lotes(hoy, ritmo, valor12, unid12, nombres, CACHE_DIR)
            fuente_lotes = "SAP Business One"
            print("Lotes y registros:", lotes_registros["resumen"])
        except Exception as e:  # noqa: BLE001
            print(f"aviso: no se pudieron leer los lotes de SAP ({e}); se usa FAR - LOTES")
            lotes_riesgo = None
    if lotes_riesgo is None:
        vida = {}
        for ref, vu, est in rows("far_registro_sanitario",
                                 ["Referencia", "Vida_x0020__x00da_til", "Estado_x0020_Comercializaci_x00f"]):
            if ref and vu:
                if ref not in vida or (est or "").lower() == "activo":
                    vida[ref] = int(vu)
        lotes = []
        vistos = set()
        for ref, nom, lote, cant, fab in rows("far_lotes", [
                "C_x00f3_digo_x0020_del_x0020_Pro", "Nombre_x0020_del_x0020_Producto", "Lote",
                "Cantidad_x0020_Disponible", "Fecha_x0020_de_x0020_Fabricaci_x"]):
            if not (ref and fab and cant) or (ref, lote) in vistos:
                continue
            vistos.add((ref, lote))
            if ref not in vida:
                continue
            f = date.fromisoformat(fab[:10])
            venc = date(*add_months((f.year, f.month), vida[ref]), min(f.day, 28))
            lotes.append({"codigo": ref, "nombre": (nom or "").strip(), "lote": lote,
                          "cantidad": float(cant), "vence": venc})
        lotes_riesgo = []
        for ref in {l["codigo"] for l in lotes}:
            diaria = ritmo.get(ref, 0.0)
            acumulado = 0.0
            for l in sorted([x for x in lotes if x["codigo"] == ref], key=lambda x: x["vence"]):
                dias = (l["vence"] - hoy).days
                capacidad = max(dias, 0) * diaria  # lo que alcanza a venderse antes de vencer
                acumulado += l["cantidad"]
                sobrante = min(l["cantidad"], max(0.0, acumulado - capacidad))
                if dias < 0:
                    nivel = "rojo"
                elif sobrante > 0 or dias < 90:
                    nivel = "rojo" if dias < 90 or sobrante >= 0.5 * l["cantidad"] else "amarillo"
                else:
                    continue
                lotes_riesgo.append({
                    "codigo": ref, "nombre": l["nombre"], "lote": l["lote"],
                    "cantidad": round(l["cantidad"]), "vence": l["vence"].isoformat(),
                    "dias_para_vencer": dias, "unidades_sin_vender": round(sobrante), "nivel": nivel,
                })
        lotes_riesgo.sort(key=lambda l: l["dias_para_vencer"])
        n_lotes = len(lotes)

    # ---- alertas accionables (priorizadas)
    alertas = []
    for p in en_riesgo_quiebre[:8]:
        prio = "alta" if p["nivel"] == "rojo" else "media"
        if True:
            txt = f"{p['nombre']}: el inventario alcanza para unos {p['dias_cobertura']} días."
            if p.get("intermitente"):
                txt += " (Se vende de forma intermitente: el cálculo es aproximado.)"
        cuando = ("cuanto antes (idealmente esta semana)" if p["pedir_antes_de"] <= hoy.isoformat()
                  else f"antes del {p['pedir_antes_de']}")
        accion = (f"Pedir ~{num(p['sugerido_pedir'])} unidades {cuando}."
                  if p["sugerido_pedir"] > 0 else "Liberar lo que está en cuarentena para cubrir la demanda.")
        if p["cuarentena"] > 0 and p["sugerido_pedir"] > 0:
            accion += f" Hay {num(p['cuarentena'])} en cuarentena que ayudarían si se liberan."
        alertas.append({"prioridad": prio, "tipo": "agotamiento", "titulo": txt, "accion": accion,
                        "codigo": p["codigo"]})
    for l in lotes_riesgo[:6]:
        if l["dias_para_vencer"] < 0:
            txt = f"Lote {l['lote']} de {l['nombre']} ya venció ({l['vence']}) y figura con {num(l['cantidad'])} unidades."
            accion = "Verificar y dar de baja o gestionar su destrucción."
        else:
            txt = (f"Lote {l['lote']} de {l['nombre']} vence el {l['vence']}; al ritmo actual quedarían "
                   f"~{num(l['unidades_sin_vender'])} de {num(l['cantidad'])} unidades sin vender.")
            accion = "Priorizar su despacho (promoción, reasignación a clientes de mayor rotación)."
        if l.get("frase"):  # lotes desde SAP: frase y acción ya redactadas
            txt, accion = l["frase"], l["accion"]
        alertas.append({"prioridad": "alta" if l["nivel"] == "rojo" else "media", "tipo": "vencimiento",
                        "titulo": txt, "accion": accion, "codigo": l["codigo"]})
    if sin_stock:
        alertas.append({"prioridad": "baja", "tipo": "datos",
                        "titulo": (f"{len(sin_stock)} productos se venden con regularidad pero no tienen "
                                   "existencias en los almacenes aprobados (probablemente se fabrican bajo pedido o "
                                   "se guardan en otro almacén)."),
                        "accion": "Confirmar con Planeación si requieren inventario de seguridad.", "codigo": None})
    if brechas:
        meses_b = [mes_nombre(tuple(int(x) for x in c["mes"].split("-"))) for c in brechas]
        alertas.append({"prioridad": "media", "tipo": "datos",
                        "titulo": ("La lista FAR - VENTAS de SharePoint está incompleta en " + ", ".join(meses_b) +
                                   f": le faltan {pesos_corto(sum(c['brecha'] for c in brechas))} frente a SAP "
                                   "(desde el 28 de julio de 2026 el cargue dejó de subir las facturas)."),
                        "accion": "Estas cifras ya se tomaron directamente de SAP. Conviene revisar el "
                                  "cargue SAP → SharePoint para que la lista vuelva a quedar completa.",
                        "codigo": None})
    elif incompletos and error_sap:
        alertas.append({"prioridad": "baja", "tipo": "datos",
                        "titulo": ("Las ventas de " + ", ".join(mes_nombre(m) for m in incompletos) +
                                   " aún no están completas en SharePoint."),
                        "accion": "Revisar el cargue SAP → SharePoint; el pronóstico usa hasta "
                                  f"{mes_nombre(completos[-1])}.", "codigo": None})
    orden = {"alta": 0, "media": 1, "baja": 2}
    alertas.sort(key=lambda a: orden[a["prioridad"]])

    # ---- semáforos y frases
    def sem_var(x):
        return "verde" if x >= -3 else "amarillo" if x >= -10 else "rojo"

    n_rojo_q = sum(1 for p in en_riesgo_quiebre if p["nivel"] == "rojo")
    n_rojo_l = sum(1 for l in lotes_riesgo if l["nivel"] == "rojo")
    valor_l = sum(l.get("valor_en_riesgo", 0) for l in lotes_riesgo)
    mes_txt = MESES_ES[ym_obj[1] - 1]
    sube = "más" if var >= 0 else "menos"
    comp_prev = MESES_ES[ym_prev[1] - 1]
    # La comparación principal es contra el mismo mes del año pasado (dato real y cerrado);
    # el mes anterior puede no haber cerrado todavía y compararía pronóstico contra pronóstico.
    resumen = (f"En {mes_txt} se espera vender entre {pesos_corto(obj['min'])} y {pesos_corto(obj['max'])}, "
               f"lo más probable {pesos_corto(obj['esperado'])}.")
    if var_ano is not None:
        if abs(var_ano) < 1:
            frase_var = f"Prácticamente igual a {mes_txt} del año pasado."
        else:
            frase_var = f"{abs(var_ano):.0f} % {'más' if var_ano >= 0 else 'menos'} que {mes_txt} del año pasado."
        var_sem = var_ano
    else:
        frase_var = f"{abs(var):.0f} % {sube} que {comp_prev}."
        var_sem = var
    resumen += f" {frase_var}"
    mes_pasado = None
    if mp:
        ym_mp = tuple(int(x) for x in mp["mes"].split("-"))
        e = mp["error"] or 0.0
        sem = "verde" if e < 0.10 else "amarillo" if e < 0.20 else "rojo"
        dif = mp["real"] - mp["pronosticado"]
        mes_mp = MESES_ES[ym_mp[1] - 1]
        frase = (f"En {mes_mp} pronosticamos {pesos_corto(mp['pronosticado'])}; se vendieron "
                 f"{pesos_corto(mp['real'])}: acertamos con un margen de {e*100:.0f} %")
        frase += (" (se vendió más de lo esperado)." if dif > 0 else " (se vendió menos de lo esperado).")
        mes_pasado = dict(mp, semaforo=sem, frase=frase, detalle=(
            "El resultado real quedó dentro del rango probable que dimos." if mp["dentro_del_rango"]
            else "El resultado real quedó por fuera del rango probable que dimos."))
    comp = pv["comparacion"]
    if comp["gana_ingenuo"]:
        frase_modelo = (f"En las pruebas con meses pasados, un método sencillo —tomar lo vendido en el "
                        f"{'mismo mes del año anterior' if pv['modelo'] == 'estacional_ingenuo' else 'último mes'}— "
                        f"acertó más (error promedio {pct1(pv['error_medio'])}) que los modelos estadísticos "
                        f"({pct1(comp['wape_mejor_ets'] or 0)}), así que por ahora usamos ese.")
    else:
        frase_modelo = (f"En las pruebas, el método elegido ({pv['modelo_nombre']}) se equivocó en promedio "
                        f"un {pv['error_medio']*100:.0f} %, frente a un {(comp['wape_mejor_ingenuo'] or 0)*100:.0f} % "
                        "del método más simple (repetir lo reciente).")

    tarjetas = [
        {"id": "ventas", "titulo": f"Ventas esperadas en {mes_txt}", "valor": pesos(obj["esperado"]),
         "detalle": f"Rango probable: {pesos_corto(obj['min'])} a {pesos_corto(obj['max'])}",
         "semaforo": sem_var(var_sem),
         "frase": frase_var},
        {"id": "agotamiento", "titulo": "Productos en riesgo de agotarse", "valor": str(len(en_riesgo_quiebre)),
         "detalle": f"{n_rojo_q} urgentes (menos de {LEAD_TIME_DIAS} días de inventario)",
         "semaforo": "rojo" if n_rojo_q else "amarillo" if en_riesgo_quiebre else "verde",
         "frase": "Revise las alertas para saber cuánto pedir." if en_riesgo_quiebre else "Inventario suficiente."},
        {"id": "vencimiento", "titulo": "Lotes en riesgo de vencer", "valor": str(len(lotes_riesgo)),
         "detalle": ((f"{n_rojo_l} urgentes" + (f" · ≈ {pesos_corto(valor_l)} en riesgo" if valor_l else ""))
                    if lotes_riesgo else "Ningún lote en riesgo"),
         "semaforo": "rojo" if n_rojo_l else "amarillo" if lotes_riesgo else "verde",
         "frase": "Lotes que vencerían antes de venderse al ritmo actual."},
        {"id": "confiabilidad", "titulo": "Qué tan confiable es el pronóstico", "valor": pv["confiabilidad"],
         "detalle": f"En pruebas con meses pasados se equivocó en promedio un {pv['error_medio']*100:.0f} % (WAPE)",
         "semaforo": {"Alta": "verde", "Media": "amarillo", "Baja": "rojo"}[pv["confiabilidad"]],
         "frase": {"Alta": "Puede usarlo para planear con tranquilidad.",
                   "Media": "Úselo como guía; revise el rango probable.",
                   "Baja": "Tómelo como referencia general, no como cifra exacta."}[pv["confiabilidad"]]},
    ]

    historia = [{"mes": ym_key(m), "real": round(por_mes[m])} for m in completos]
    parciales = [{"mes": ym_key(m), "registrado": round(por_mes[m])} for m in incompletos]
    fechas = [v["fecha"] for v in ventas]
    salida = {
        "empresa": "Farmalógica S.A.",
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "fecha_corte": hoy.isoformat(),
        "fuente": {
            "listas": ["FAR - VENTAS", "FAR - INVENTARIO", "FAR - LOTES", "FAR - REGISTRO SANITARIO"],
            "ventas_desde": min(fechas).isoformat(), "ventas_hasta": max(fechas).isoformat(),
            "registros_ventas": n_crudas, "registros_ventas_unicos": len(ventas),
            "ultimo_mes_completo": ym_key(completos[-1]),
            "meses_incompletos": [ym_key(m) for m in incompletos],
            "lotes_con_vencimiento": n_lotes,
            "lotes_origen": fuente_lotes,
            "ventas_origen": fuente_ventas,
            "error_sap": error_sap,
            "conciliacion": conciliacion,
            "productos_sin_stock_aprobado": len(sin_stock),
        },
        "resumen": resumen,
        "tarjetas": tarjetas,
        "mes_pasado": mes_pasado,
        "ventas": {"historia": historia, "parciales": parciales, "pronostico": pv["pronostico"],
                   "confiabilidad": pv["confiabilidad"], "error_medio": pv["error_medio"],
                   "modelo": pv["modelo"], "modelo_nombre": pv["modelo_nombre"],
                   "comparacion": comp, "frase_modelo": frase_modelo},
        "top_productos": top_productos,
        "inventario": productos_inv[:40],
        "lotes_riesgo": lotes_riesgo,
        "alertas": alertas,
        "lotes_registros": lotes_registros,
        "como_leer": [
            "Las cifras de ventas son netas: facturas menos notas crédito, en pesos colombianos, tomadas de SAP.",
            "Cuando un producto se vende de forma intermitente (hay meses sin venta), usamos un método "
            "especial para ese tipo de venta y lo indicamos con la etiqueta «Venta intermitente».",
            "La línea sólida es lo que realmente se vendió; la punteada es lo que esperamos vender.",
            "La franja sombreada es el rango probable: lo normal es que el resultado caiga ahí.",
            "Semáforo: 🟢 todo bien, 🟡 conviene revisarlo, 🔴 requiere acción pronto.",
            f"Los días de inventario suponen que reponer un producto toma unos {LEAD_TIME_DIAS} días.",
            ("El vencimiento de cada lote es la fecha registrada en SAP para ese lote." if lotes_registros else
             "El vencimiento de cada lote se calcula con su fecha de fabricación y la vida útil del registro sanitario."),
        ],
    }
    # Cartera y flujo de caja (SAP + FAR - BANCOS MOVIMIENTOS); si falla, el resto del snapshot sigue igual
    if not args.sin_sap and not args.sin_cartera:
        try:
            from cartera_farmalogica import generar as generar_cartera
            salida["cartera"] = generar_cartera(hoy)
            print("Cartera:", salida["cartera"]["resumen"])
        except Exception as e:  # noqa: BLE001
            print(f"aviso: no se pudo calcular la cartera ({e})")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"OK -> {args.out}")
    print(resumen)
    print(f"Fuente ventas: {fuente_ventas}")
    for c in conciliacion[-4:]:
        print(f"  {c['mes']}: SharePoint {c['lineas_sharepoint']} líneas / {pesos(c['total_sharepoint'])}"
              f"  vs SAP {c['lineas_sap']} / {pesos(c['total_sap'])}")
    print(f"Modelo {pv['modelo']} | WAPE {pv['error_medio']:.1%} | confiabilidad {pv['confiabilidad']}")
    print("WAPE por modelo:", comp["wape"])
    if mes_pasado:
        print(mes_pasado["frase"])
    print(f"Productos en riesgo de agotarse: {len(en_riesgo_quiebre)} | lotes en riesgo: {len(lotes_riesgo)}")


if __name__ == "__main__":
    main()
