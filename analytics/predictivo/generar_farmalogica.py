#!/usr/bin/env python3
"""
Motor predictivo — PILOTO Farmalógica S.A. (módulo "Predicciones" de SynerLink).

Lee las cachés SQLite compartidas de la flota (listas SharePoint GSSLATAM,
ver skill `consulta-sharepoint-gss`) y genera `lib/predictivo/farmalogica.json`,
un JSON compacto con NÚMEROS + TEXTOS YA REDACTADOS en lenguaje sencillo, que la
página /process/predicciones solo pinta (no calcula nada).

Fuentes (solo lectura; este script NO consulta SharePoint ni SAP):
  - far_ventas.db              FAR - VENTAS            (líneas de factura / notas)
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
  FAR_CACHE_DIR=/otra/ruta python3 analytics/predictivo/generar_farmalogica.py

Dependencias: Python 3.9+ y numpy (nada más: sin pandas/statsmodels, para que
corra en cualquier máquina de la flota).

Método (resumen):
  * Ventas netas mensuales (facturas + notas débito − notas crédito), deduplicadas.
  * Se descartan los meses finales "incompletos" (cargue parcial en SharePoint).
  * Pronóstico 1-3 meses: se prueban varios modelos simples y robustos
    (suavizamiento exponencial, con y sin estacionalidad amortiguada, promedio
    móvil) y se elige el de menor error en backtest de origen móvil.
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


# ----------------------------------------------------------------- modelos
def ses(y, alpha):
    lvl = y[0]
    for v in y[1:]:
        lvl = alpha * v + (1 - alpha) * lvl
    return lvl


def forecast(y, h, modelo, months):
    """Pronóstico h pasos. y: np.array; months: lista (y,m) alineada con y."""
    y = np.asarray(y, float)
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


MODELOS = ["promedio3", "ses_0.3", "ses_0.5", "ses_0.3_est", "ses_0.5_est"]


def backtest(y, months, modelo, h=3, n_origenes=6):
    """Errores relativos (real/pronóstico - 1) por origen móvil."""
    errs = []
    n = len(y)
    for o in range(max(6, n - n_origenes - h + 1), n - 1):
        f = forecast(y[:o], min(h, n - o), modelo, months[:o])
        for k, fv in enumerate(f):
            if fv > 0:
                errs.append(y[o + k] / fv - 1)
    return np.array(errs)


def pronosticar(y, months, h=3):
    y = np.asarray(y, float)
    mejor = None
    for m in MODELOS:
        e = backtest(y, months, m, h)
        if len(e) == 0:
            continue
        score = float(np.mean(np.abs(e)))
        if mejor is None or score < mejor[1]:
            mejor = (m, score, e)
    modelo, err_medio, e = mejor
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
    return {"modelo": modelo, "error_medio": round(err_medio, 3),
            "confiabilidad": conf, "pronostico": out}


# ----------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Genera el JSON del piloto predictivo de Farmalógica")
    ap.add_argument("--hoy", help="Fecha de corte YYYY-MM-DD (por defecto hoy)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    hoy = date.fromisoformat(args.hoy) if args.hoy else date.today()

    n_crudas, ventas = cargar_ventas()

    # ---- serie mensual de ventas netas
    por_mes = defaultdict(float)
    lineas_mes = defaultdict(int)
    for v in ventas:
        ym = (v["fecha"].year, v["fecha"].month)
        por_mes[ym] += v["total"]
        lineas_mes[ym] += 1
    meses = sorted(por_mes)
    # meses finales incompletos: < 50 % de las líneas de la mediana de los 6 previos
    ultimo = len(meses) - 1
    while ultimo > 6:
        med = np.median([lineas_mes[m] for m in meses[ultimo - 6:ultimo]])
        if lineas_mes[meses[ultimo]] < 0.5 * med:
            ultimo -= 1
        else:
            break
    completos = meses[:ultimo + 1]
    incompletos = meses[ultimo + 1:]
    serie = np.array([por_mes[m] for m in completos])
    pv = pronosticar(serie, completos, 3)

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

    def serie_ref(ref):
        return np.array([max(unid[ref].get(m, 0.0), 0.0) for m in completos])

    top = sorted(valor12, key=valor12.get, reverse=True)[:5]
    top_productos = []
    for ref in top:
        s = serie_ref(ref)
        p = pronosticar(s, completos, 3)
        f1 = p["pronostico"][idx_obj]
        top_productos.append({
            "codigo": ref, "nombre": desc_ref[ref],
            "valor_12m": round(valor12[ref]),
            "unidades_mes_esperadas": f1["esperado"],
            "unidades_min": f1["min"], "unidades_max": f1["max"],
            "confiabilidad": p["confiabilidad"],
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
    for ref in unid:
        s = serie_ref(ref)
        # solo demanda regular: vendido en al menos 4 de los últimos 6 meses
        if s[-6:].sum() <= 0 or (s[-6:] > 0).sum() < 4:
            continue
        f = forecast(s, 1, "ses_0.3", completos)[0]
        mensual = 0.5 * f + 0.5 * s[-6:].mean()
        if mensual > 0:
            ritmo[ref] = mensual / 30.0

    productos_inv = []
    sin_stock = []  # se venden con regularidad pero no tienen existencias aprobadas
    for ref, diaria in ritmo.items():
        st = stock.get(ref, 0.0)
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
        })
    productos_inv.sort(key=lambda p: p["dias_cobertura"])
    en_riesgo_quiebre = [p for p in productos_inv if p["nivel"] != "verde"]

    # ---- lotes: vencimiento = fabricación + vida útil (registro sanitario)
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

    # ---- alertas accionables (priorizadas)
    alertas = []
    for p in en_riesgo_quiebre[:8]:
        prio = "alta" if p["nivel"] == "rojo" else "media"
        if True:
            txt = f"{p['nombre']}: el inventario alcanza para unos {p['dias_cobertura']} días."
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
        alertas.append({"prioridad": "alta" if l["nivel"] == "rojo" else "media", "tipo": "vencimiento",
                        "titulo": txt, "accion": accion, "codigo": l["codigo"]})
    if sin_stock:
        alertas.append({"prioridad": "baja", "tipo": "datos",
                        "titulo": (f"{len(sin_stock)} productos se venden con regularidad pero no tienen "
                                   "existencias en los almacenes aprobados (probablemente se fabrican bajo pedido o "
                                   "se guardan en otro almacén)."),
                        "accion": "Confirmar con Planeación si requieren inventario de seguridad.", "codigo": None})
    if incompletos:
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
    mes_txt = MESES_ES[ym_obj[1] - 1]
    sube = "más" if var >= 0 else "menos"
    comp_prev = MESES_ES[ym_prev[1] - 1]
    resumen = (f"En {mes_txt} se espera vender entre {pesos_corto(obj['min'])} y {pesos_corto(obj['max'])}, "
               f"lo más probable {pesos_corto(obj['esperado'])}: un {abs(var):.0f} % {sube} que {comp_prev}.")
    if var_ano is not None:
        resumen += f" Frente a {mes_txt} del año pasado sería un {abs(var_ano):.0f} % {'más' if var_ano >= 0 else 'menos'}."
    tarjetas = [
        {"id": "ventas", "titulo": f"Ventas esperadas en {mes_txt}", "valor": pesos(obj["esperado"]),
         "detalle": f"Rango probable: {pesos_corto(obj['min'])} a {pesos_corto(obj['max'])}",
         "semaforo": sem_var(var),
         "frase": f"{abs(var):.0f} % {sube} que {comp_prev}."},
        {"id": "agotamiento", "titulo": "Productos en riesgo de agotarse", "valor": str(len(en_riesgo_quiebre)),
         "detalle": f"{n_rojo_q} urgentes (menos de {LEAD_TIME_DIAS} días de inventario)",
         "semaforo": "rojo" if n_rojo_q else "amarillo" if en_riesgo_quiebre else "verde",
         "frase": "Revise las alertas para saber cuánto pedir." if en_riesgo_quiebre else "Inventario suficiente."},
        {"id": "vencimiento", "titulo": "Lotes en riesgo de vencer", "valor": str(len(lotes_riesgo)),
         "detalle": f"{n_rojo_l} urgentes" if lotes_riesgo else "Ningún lote en riesgo",
         "semaforo": "rojo" if n_rojo_l else "amarillo" if lotes_riesgo else "verde",
         "frase": "Lotes que vencerían antes de venderse al ritmo actual."},
        {"id": "confiabilidad", "titulo": "Qué tan confiable es el pronóstico", "valor": pv["confiabilidad"],
         "detalle": f"En pruebas con meses pasados se equivocó en promedio un {pv['error_medio']*100:.0f} %",
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
            "lotes_con_vencimiento": len(lotes),
            "productos_sin_stock_aprobado": len(sin_stock),
        },
        "resumen": resumen,
        "tarjetas": tarjetas,
        "ventas": {"historia": historia, "parciales": parciales, "pronostico": pv["pronostico"],
                   "confiabilidad": pv["confiabilidad"], "error_medio": pv["error_medio"],
                   "modelo": pv["modelo"]},
        "top_productos": top_productos,
        "inventario": productos_inv[:40],
        "lotes_riesgo": lotes_riesgo,
        "alertas": alertas,
        "como_leer": [
            "Las cifras de ventas son netas: facturas menos notas crédito, en pesos colombianos.",
            "La línea sólida es lo que realmente se vendió; la punteada es lo que esperamos vender.",
            "La franja sombreada es el rango probable: lo normal es que el resultado caiga ahí.",
            "Semáforo: 🟢 todo bien, 🟡 conviene revisarlo, 🔴 requiere acción pronto.",
            f"Los días de inventario suponen que reponer un producto toma unos {LEAD_TIME_DIAS} días.",
            "El vencimiento de cada lote se calcula con su fecha de fabricación y la vida útil del registro sanitario.",
        ],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"OK -> {args.out}")
    print(resumen)
    print(f"Modelo {pv['modelo']} | error medio {pv['error_medio']:.1%} | confiabilidad {pv['confiabilidad']}")
    print(f"Productos en riesgo de agotarse: {len(en_riesgo_quiebre)} | lotes en riesgo: {len(lotes_riesgo)}")


if __name__ == "__main__":
    main()
