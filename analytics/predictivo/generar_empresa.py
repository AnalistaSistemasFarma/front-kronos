#!/usr/bin/env python3
"""
Motor predictivo — resto de empresas del grupo (Ryan, OLP, Abamia, Meditrack, Kelab).

Mismo método que generar_farmalogica.py (se importan de allí los modelos, el
backtest y el formato, así Farmalógica queda intacta), pero con las ventas
tomadas directamente de SAP Business One de cada empresa, en SOLO LECTURA, por
el conector MCP HTTP de serfarma05 (tools/call sap_query / sap_query_view;
nunca se llama una herramienta de escritura).

Fuente por empresa:
  ryan       vista Farma_VentasB1SLQuery   (líneas: productos + inventario)
  olp        vista OLP_IND_VentasB1SLQuery (líneas: productos + inventario)
  abamia     vista ABA_IND_VentasB1SLQuery (líneas: productos + inventario)
  meditrack  Invoices / CreditNotes (encabezados; su conector pagina de 20 en 20
             y es una empresa de servicios: solo ventas totales)
  kelab      Invoices / CreditNotes (la vista de ventas de Kelab falla en SAP:
             columna U_InfoCo01 inexistente; solo ventas totales)

Inventario (solo donde el conector entrega todo en una llamada):
  Items + ItemWarehouseInfoCollection; "aprobado" = almacén cuyo nombre
  contiene "aprobado"; "cuarentena" = nombre con "cuarentena".
  No hay lotes con vencimiento para estas empresas: esa parte se omite.

Uso:
  python3 analytics/predictivo/generar_empresa.py --empresa ryan --out /tmp/ryan.json
  python3 analytics/predictivo/generar_empresa.py --empresa olp --hoy 2026-09-24
Variables: SAP_MCP_HOST (por defecto http://192.168.10.5).
"""
import argparse
import json
import math
import os
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generar_farmalogica import (  # noqa: E402
    MESES_ES, LEAD_TIME_DIAS, COBERTURA_OBJETIVO_DIAS, pesos, pesos_corto, pct1, num,
    mes_nombre, add_months, ym_key, forecast, es_intermitente, pronosticar, evaluar_mes_pasado,
)

SAP_MCP_HOST = os.environ.get("SAP_MCP_HOST", "http://192.168.10.5")
DESDE = "2023-01-01"

EMPRESAS = {
    "ryan": {"nombre": "Laboratorios Ryan", "company_id": 2, "puerto": 3013,
             "fuente": "vista", "vista": "Farma_VentasB1SLQuery", "inventario": True},
    "olp": {"nombre": "One Latam Pharma", "company_id": 3, "puerto": 3015,
            "fuente": "vista", "vista": "OLP_IND_VentasB1SLQuery", "inventario": True},
    "abamia": {"nombre": "Abamia", "company_id": 7, "puerto": 3022,
               "fuente": "vista", "vista": "ABA_IND_VentasB1SLQuery", "inventario": True},
    "meditrack": {"nombre": "Meditrack", "company_id": 6, "puerto": 3014,
                  "fuente": "documentos", "inventario": False},
    "kelab": {"nombre": "Kelab", "company_id": 9, "puerto": 3021,
              "fuente": "documentos", "inventario": False},
}
HERRAMIENTAS_LECTURA = {"sap_query", "sap_query_view"}


# ----------------------------------------------------------------- SAP (solo lectura)
class Sap:
    def __init__(self, puerto):
        self.url = f"{SAP_MCP_HOST}:{puerto}/mcp"

    def _post(self, body, sid=None):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if sid:
            h["Mcp-Session-Id"] = sid
        req = urllib.request.Request(self.url, json.dumps(body).encode(), h)
        with urllib.request.urlopen(req, timeout=600) as r:
            txt = r.read().decode()
            nuevo = r.headers.get("Mcp-Session-Id")
        if "data:" in txt[:200]:
            txt = "\n".join(l[5:] for l in txt.splitlines() if l.startswith("data:"))
        return (json.loads(txt) if txt.strip() else None), nuevo

    def call(self, tool, args):
        if tool not in HERRAMIENTAS_LECTURA:  # salvaguarda: jamás escribir en SAP
            raise ValueError(f"Herramienta no permitida: {tool}")
        _, sid = self._post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                             "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                                        "clientInfo": {"name": "predictivo-gss", "version": "1"}}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
        res, _ = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                             "params": {"name": tool, "arguments": args}}, sid)
        if not res or "result" not in res or res["result"].get("isError"):
            raise RuntimeError(f"SAP no respondió bien ({tool}): {str(res)[:300]}")
        txt = res["result"]["content"][0]["text"]
        try:
            return json.loads(txt)
        except ValueError:
            raise RuntimeError(f"SAP devolvió un error ({tool}): {txt[:300]}")


def ventas_vista(sap, vista):
    filas = sap.call("sap_query_view", {"view": vista, "filter": f"Fecha ge '{DESDE}'",
                                        "maxPageSize": 0})["value"]
    out = []
    for r in filas:
        if not r.get("Fecha"):
            continue
        out.append({"doc": (r.get("Documento") or "").strip(), "ref": r.get("Referencia") or "",
                    "desc": (r.get("Descripción") or "").strip(),
                    "cant": float(r.get("Cantidad") or 0),  # notas crédito ya vienen negativas
                    "total": float(r.get("Total") or 0),
                    "fecha": date.fromisoformat(r["Fecha"][:10]), "tipo": r.get("Tipo") or ""})
    return out


def ventas_documentos(sap):
    """Encabezados de facturas y notas crédito (página fija de 20 en estos conectores).

    Valor neto antes de IVA = DocTotal - VatSum. Se excluyen las facturas
    canceladas y sus documentos de cancelación (CancelStatus = csNo).
    """
    out = []
    for entidad, signo in (("Invoices", 1), ("CreditNotes", -1)):
        filtro = f"DocDate ge '{DESDE}' and CancelStatus eq 'csNo'"
        n = sap.call("sap_query", {"entity": entidad, "filter": filtro, "select": "DocEntry",
                                   "count": True, "top": 1})["count"]

        def pagina(skip):
            return sap.call("sap_query", {"entity": entidad, "filter": filtro,
                                          "select": "DocEntry,DocDate,DocTotal,VatSum",
                                          "skip": skip, "top": 20})["value"]
        vistos = set()
        with ThreadPoolExecutor(6) as ex:
            for filas in ex.map(pagina, range(0, n, 20)):
                for r in filas:
                    if r["DocEntry"] in vistos:
                        continue
                    vistos.add(r["DocEntry"])
                    out.append({"doc": entidad, "ref": "", "desc": "", "cant": 0.0,
                                "total": signo * (float(r.get("DocTotal") or 0) - float(r.get("VatSum") or 0)),
                                "fecha": date.fromisoformat(r["DocDate"][:10]), "tipo": "Documento"})
        if len(vistos) < n:
            raise RuntimeError(f"{entidad}: se leyeron {len(vistos)} de {n} documentos")
    return out


def inventario(sap):
    items = sap.call("sap_query", {"entity": "Items", "filter": "QuantityOnStock gt 0",
                                   "select": "ItemCode,ItemName,ItemWarehouseInfoCollection",
                                   "maxPageSize": 0})["value"]
    alm = sap.call("sap_query", {"entity": "Warehouses", "select": "WarehouseCode,WarehouseName",
                                 "maxPageSize": 0})["value"]
    nombre_alm = {a["WarehouseCode"]: (a.get("WarehouseName") or "").lower() for a in alm}
    stock, cuarentena, nombres = defaultdict(float), defaultdict(float), {}
    for it in items:
        nombres[it["ItemCode"]] = (it.get("ItemName") or "").strip()
        for w in it.get("ItemWarehouseInfoCollection") or []:
            q = float(w.get("InStock") or 0)
            nom = nombre_alm.get(w.get("WarehouseCode"), "")
            if q <= 0:
                continue
            if "aprobado" in nom:
                stock[it["ItemCode"]] += q
            elif "cuarentena" in nom:
                cuarentena[it["ItemCode"]] += q
    return stock, cuarentena, nombres


# ----------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Genera el JSON predictivo de una empresa del grupo")
    ap.add_argument("--empresa", required=True, choices=sorted(EMPRESAS))
    ap.add_argument("--hoy", help="Fecha de corte YYYY-MM-DD (por defecto hoy)")
    ap.add_argument("--out", help="Archivo de salida (por defecto /tmp/predictivo_<empresa>.json)")
    args = ap.parse_args()
    cfg = EMPRESAS[args.empresa]
    hoy = date.fromisoformat(args.hoy) if args.hoy else date.today()
    out_path = args.out or f"/tmp/predictivo_{args.empresa}.json"
    sap = Sap(cfg["puerto"])

    if cfg["fuente"] == "vista":
        ventas = ventas_vista(sap, cfg["vista"])
        fuente_ventas = f"SAP Business One (vista {cfg['vista']})"
    else:
        ventas = ventas_documentos(sap)
        fuente_ventas = "SAP Business One (facturas y notas crédito, valor antes de IVA)"
    if not ventas:
        raise SystemExit("SAP no devolvió ventas")

    # ---- serie mensual
    por_mes, lineas_mes = defaultdict(float), defaultdict(int)
    for v in ventas:
        ym = (v["fecha"].year, v["fecha"].month)
        por_mes[ym] += v["total"]
        lineas_mes[ym] += 1
    meses = sorted(m for m in por_mes if m < (hoy.year, hoy.month))
    # meses sin ninguna venta también cuentan (valen 0): serie calendario continua
    if meses:
        meses = [add_months(meses[0], k) for k in range(
            (meses[-1][0] - meses[0][0]) * 12 + meses[-1][1] - meses[0][1] + 1)]
    en_curso = sorted(m for m in por_mes if m >= (hoy.year, hoy.month))
    # meses iniciales de arranque/pruebas (p. ej. facturas de $1 antes de operar):
    # se empieza en el primer mes con al menos 10 % de la mediana mensual.
    med_total = float(np.median([por_mes[m] for m in meses])) if meses else 0.0
    ini = 0
    while ini < len(meses) - 1 and por_mes[meses[ini]] < 0.10 * med_total:
        ini += 1
    arranque = meses[:ini]
    meses = meses[ini:]
    # meses finales incompletos (mismo criterio que Farmalógica)
    ultimo = len(meses) - 1
    while ultimo > 6:
        med = np.median([lineas_mes[m] for m in meses[ultimo - 6:ultimo]])
        if lineas_mes[meses[ultimo]] < 0.5 * med:
            ultimo -= 1
        else:
            break
    completos = meses[:ultimo + 1]
    incompletos = meses[ultimo + 1:] + en_curso
    n_meses = len(completos)
    if n_meses < 4:
        raise SystemExit(f"Muy poca historia ({n_meses} meses cerrados): no se publica pronóstico")
    serie = np.array([por_mes[m] for m in completos])
    pv = pronosticar(serie, completos, 3)
    mp = evaluar_mes_pasado(serie, completos)

    # confiabilidad honesta: sin dos años no se puede validar la estacionalidad
    poca_historia = n_meses < 24
    conf_modelo = pv["confiabilidad"]
    if n_meses < 12:
        pv["confiabilidad"] = "Baja"
    elif poca_historia and pv["confiabilidad"] == "Alta":
        pv["confiabilidad"] = "Media"

    # mes objetivo = próximo mes calendario
    prox_ym = ym_key(add_months((hoy.year, hoy.month), 1))
    idx_obj = next((i for i, p in enumerate(pv["pronostico"]) if p["mes"] >= prox_ym),
                   len(pv["pronostico"]) - 1)
    obj = pv["pronostico"][idx_obj]
    ym_obj = tuple(int(x) for x in obj["mes"].split("-"))
    mes_txt = MESES_ES[ym_obj[1] - 1]
    ym_ano = (ym_obj[0] - 1, ym_obj[1])
    # solo meses CERRADOS: el mismo mes del año pasado o, si no existe, el último mes cerrado
    if ym_ano in completos and por_mes[ym_ano]:
        var_sem = (obj["esperado"] / por_mes[ym_ano] - 1) * 100
        frase_var = (f"Prácticamente igual a {mes_txt} del año pasado." if abs(var_sem) < 1 else
                     f"{abs(var_sem):.0f} % {'más' if var_sem >= 0 else 'menos'} que {mes_txt} del año pasado.")
    else:
        ref = por_mes[completos[-1]]
        var_sem = (obj["esperado"] / ref - 1) * 100 if ref else 0.0
        frase_var = (f"{abs(var_sem):.0f} % {'más' if var_sem >= 0 else 'menos'} que "
                     f"{mes_nombre(completos[-1])} (último mes cerrado; aún no hay {mes_txt} del año pasado "
                     "para comparar).")
    resumen = (f"En {mes_txt} se espera vender entre {pesos_corto(obj['min'])} y {pesos_corto(obj['max'])}, "
               f"lo más probable {pesos_corto(obj['esperado'])}. {frase_var}")
    aviso = None
    if poca_historia:
        aviso = (f"Aún hay poca historia ({n_meses} meses cerrados, desde {mes_nombre(completos[0])}); "
                 "tómelo como referencia.")

    # ---- productos (solo con ventas por línea)
    top_productos, ritmo, intermitentes, desc_ref = [], {}, set(), {}
    if cfg["fuente"] == "vista":
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

        for ref in sorted(valor12, key=valor12.get, reverse=True)[:5]:
            s = serie_ref(ref)
            inter = es_intermitente(s)
            p = pronosticar(s, completos, 3, inter)
            if n_meses < 12:
                p["confiabilidad"] = "Baja"
            f1 = p["pronostico"][idx_obj]
            top_productos.append({
                "codigo": ref, "nombre": desc_ref[ref], "valor_12m": round(valor12[ref]),
                "unidades_mes_esperadas": f1["esperado"], "unidades_min": f1["min"], "unidades_max": f1["max"],
                "confiabilidad": p["confiabilidad"], "metodo": p["modelo_nombre"], "intermitente": inter,
                "frase_metodo": ("Se vende de forma intermitente (hay meses sin venta), por eso usamos un "
                                 "método especial para este tipo de producto." if inter else
                                 ("Aquí el método más simple (repetir lo reciente) acertó más que los "
                                  "modelos, así que usamos ese." if p["comparacion"]["gana_ingenuo"] else
                                  f"Método: {p['modelo_nombre']}.")),
                "frase": (f"Se esperan unas {num(f1['esperado'])} unidades en {mes_txt} "
                          f"(entre {num(f1['min'])} y {num(f1['max'])})."),
            })
        for ref in unid:
            s = serie_ref(ref)
            if s[-12:].sum() <= 0:
                continue
            if (s[-6:] > 0).sum() >= 4:
                mensual = 0.5 * forecast(s, 1, "ses_0.3", completos)[0] + 0.5 * s[-6:].mean()
            elif es_intermitente(s):
                mensual = forecast(s, 1, "tsb", completos)[0]
                intermitentes.add(ref)
            else:
                continue
            if mensual > 0:
                ritmo[ref] = mensual / 30.0

    # ---- inventario
    productos_inv, sin_stock, error_inv = [], [], None
    if cfg["inventario"] and ritmo:
        try:
            stock, cuarentena, nombre_inv = inventario(sap)
        except Exception as exc:  # sin inventario se sigue solo con ventas
            error_inv = str(exc)[:200]
            print(f"AVISO: inventario no disponible ({error_inv})")
            stock = None
        if stock is not None:
            for ref, diaria in ritmo.items():
                st = stock.get(ref, 0.0)
                if st <= 0:
                    if ref not in intermitentes:
                        sin_stock.append(ref)
                    continue
                dias = st / diaria
                nivel = "rojo" if dias < LEAD_TIME_DIAS else "amarillo" if dias < 60 else "verde"
                pedir = max(0.0, COBERTURA_OBJETIVO_DIAS * diaria - st - cuarentena.get(ref, 0.0))
                pedir = int(math.ceil(pedir / 10.0) * 10)
                fecha_pedido = hoy + timedelta(days=max(0, int(dias - LEAD_TIME_DIAS)))
                productos_inv.append({
                    "codigo": ref, "nombre": desc_ref.get(ref) or nombre_inv.get(ref, ref),
                    "stock": round(st), "cuarentena": round(cuarentena.get(ref, 0.0)),
                    "venta_diaria": round(diaria, 1), "dias_cobertura": round(dias), "nivel": nivel,
                    "sugerido_pedir": pedir, "pedir_antes_de": fecha_pedido.isoformat(),
                    "intermitente": ref in intermitentes,
                })
            productos_inv.sort(key=lambda p: p["dias_cobertura"])
    con_inventario = cfg["inventario"] and error_inv is None and bool(ritmo)
    en_riesgo = [p for p in productos_inv if p["nivel"] != "verde"]

    # ---- alertas
    alertas = []
    for p in en_riesgo[:8]:
        txt = f"{p['nombre']}: el inventario alcanza para unos {p['dias_cobertura']} días."
        if p["intermitente"]:
            txt += " (Se vende de forma intermitente: el cálculo es aproximado.)"
        cuando = ("cuanto antes (idealmente esta semana)" if p["pedir_antes_de"] <= hoy.isoformat()
                  else f"antes del {p['pedir_antes_de']}")
        accion = (f"Pedir ~{num(p['sugerido_pedir'])} unidades {cuando}." if p["sugerido_pedir"] > 0
                  else "Liberar lo que está en cuarentena para cubrir la demanda.")
        if p["cuarentena"] > 0 and p["sugerido_pedir"] > 0:
            accion += f" Hay {num(p['cuarentena'])} en cuarentena que ayudarían si se liberan."
        alertas.append({"prioridad": "alta" if p["nivel"] == "rojo" else "media", "tipo": "agotamiento",
                        "titulo": txt, "accion": accion, "codigo": p["codigo"]})
    if sin_stock:
        alertas.append({"prioridad": "baja", "tipo": "datos",
                        "titulo": (f"{len(sin_stock)} productos se venden con regularidad pero no tienen "
                                   "existencias en los almacenes aprobados (quizá se fabrican o compran bajo "
                                   "pedido, o se guardan en otro almacén)."),
                        "accion": "Confirmar con Planeación si requieren inventario de seguridad.", "codigo": None})
    if not con_inventario:
        alertas.append({"prioridad": "baja", "tipo": "datos",
                        "titulo": "Por ahora esta página muestra solo ventas: no incluye inventario ni lotes.",
                        "accion": ("Las alertas de agotamiento y vencimiento se agregarán cuando haya una "
                                   "fuente de inventario sencilla para esta empresa."), "codigo": None})
    orden = {"alta": 0, "media": 1, "baja": 2}
    alertas.sort(key=lambda a: orden[a["prioridad"]])

    # ---- mes pasado y modelo
    mes_pasado = None
    if mp:
        ym_mp = tuple(int(x) for x in mp["mes"].split("-"))
        e = mp["error"] or 0.0
        dif = mp["real"] - mp["pronosticado"]
        frase = (f"En {MESES_ES[ym_mp[1] - 1]} pronosticamos {pesos_corto(mp['pronosticado'])}; se vendieron "
                 f"{pesos_corto(mp['real'])}: "
                 + (f"acertamos con un margen de {e*100:.0f} %" if e < 0.20 else f"nos equivocamos en un {e*100:.0f} %")
                 + (" (se vendió más de lo esperado)." if dif > 0 else " (se vendió menos de lo esperado)."))
        mes_pasado = dict(mp, semaforo="verde" if e < 0.10 else "amarillo" if e < 0.20 else "rojo",
                          frase=frase, detalle=(
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
    if poca_historia:
        frase_modelo += " Con tan pocos meses, estas pruebas son todavía limitadas."

    sem_var = "verde" if var_sem >= -3 else "amarillo" if var_sem >= -10 else "rojo"
    n_rojo = sum(1 for p in en_riesgo if p["nivel"] == "rojo")
    detalle_conf = f"En pruebas con meses pasados se equivocó en promedio un {pv['error_medio']*100:.0f} % (WAPE)"
    if poca_historia:
        detalle_conf += f"; solo hay {n_meses} meses de historia"
    tarjetas = [
        {"id": "ventas", "titulo": f"Ventas esperadas en {mes_txt}", "valor": pesos(obj["esperado"]),
         "detalle": f"Rango probable: {pesos_corto(obj['min'])} a {pesos_corto(obj['max'])}",
         "semaforo": sem_var, "frase": frase_var},
    ]
    if con_inventario:
        tarjetas.append(
            {"id": "agotamiento", "titulo": "Productos en riesgo de agotarse", "valor": str(len(en_riesgo)),
             "detalle": f"{n_rojo} urgentes (menos de {LEAD_TIME_DIAS} días de inventario)",
             "semaforo": "rojo" if n_rojo else "amarillo" if en_riesgo else "verde",
             "frase": "Revise las alertas para saber cuánto pedir." if en_riesgo else "Inventario suficiente."})
    else:
        tarjetas.append(
            {"id": "alcance", "titulo": "Qué incluye esta página", "valor": "Solo ventas",
             "detalle": "Sin inventario ni lotes por ahora", "semaforo": "amarillo",
             "frase": "Aún no calculamos riesgo de agotamiento para esta empresa."})
    tarjetas.append(
        {"id": "confiabilidad", "titulo": "Qué tan confiable es el pronóstico", "valor": pv["confiabilidad"],
         "detalle": detalle_conf,
         "semaforo": {"Alta": "verde", "Media": "amarillo", "Baja": "rojo"}[pv["confiabilidad"]],
         "frase": ("Aún hay poca historia; tómelo como referencia." if poca_historia else
                   {"Alta": "Puede usarlo para planear con tranquilidad.",
                    "Media": "Úselo como guía; revise el rango probable.",
                    "Baja": "Tómelo como referencia general, no como cifra exacta."}[pv["confiabilidad"]])})

    fechas = [v["fecha"] for v in ventas]
    como_leer = [
        ("Las cifras de ventas son netas: facturas menos notas crédito, en pesos colombianos, tomadas de SAP."
         if cfg["fuente"] == "vista" else
         "Las cifras de ventas son netas (facturas menos notas crédito, antes de IVA), en pesos colombianos, "
         "tomadas de SAP."),
        "La línea sólida es lo que realmente se vendió; la punteada es lo que esperamos vender.",
        "La franja sombreada es el rango probable: lo normal es que el resultado caiga ahí.",
        "Semáforo: 🟢 todo bien, 🟡 conviene revisarlo, 🔴 requiere acción pronto.",
    ]
    if con_inventario:
        como_leer.append(f"Los días de inventario suponen que reponer un producto toma unos {LEAD_TIME_DIAS} días "
                         "y cuentan solo los almacenes aprobados.")
    else:
        como_leer.append("Para esta empresa la página muestra solo ventas (sin inventario ni lotes).")
    salida = {
        "empresa": cfg["nombre"],
        "empresa_clave": args.empresa,
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "fecha_corte": hoy.isoformat(),
        "aviso": aviso,
        "alcance": {"ventas": True, "productos": bool(top_productos), "inventario": con_inventario,
                    "lotes": False, "meses_historia": n_meses, "poca_historia": poca_historia},
        "fuente": {
            "ventas_desde": ym_key(completos[0]) + "-01", "ventas_hasta": max(fechas).isoformat(),
            "primer_registro_sap": min(fechas).isoformat(),
            "meses_de_arranque_descartados": [ym_key(m) for m in arranque],
            "registros_ventas": len(ventas), "ultimo_mes_completo": ym_key(completos[-1]),
            "meses_incompletos": [ym_key(m) for m in incompletos], "ventas_origen": fuente_ventas,
            "error_inventario": error_inv, "productos_sin_stock_aprobado": len(sin_stock),
            "confiabilidad_modelo_sin_ajuste": conf_modelo,
        },
        "resumen": resumen,
        "tarjetas": tarjetas,
        "mes_pasado": mes_pasado,
        "ventas": {"historia": [{"mes": ym_key(m), "real": round(por_mes[m])} for m in completos],
                   "parciales": [{"mes": ym_key(m), "registrado": round(por_mes[m])} for m in incompletos],
                   "pronostico": pv["pronostico"], "confiabilidad": pv["confiabilidad"],
                   "error_medio": pv["error_medio"], "modelo": pv["modelo"], "modelo_nombre": pv["modelo_nombre"],
                   "comparacion": comp, "frase_modelo": frase_modelo},
        "top_productos": top_productos,
        "inventario": productos_inv[:40],
        "lotes_riesgo": [],
        "alertas": alertas,
        "como_leer": como_leer,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"OK -> {out_path}")
    print(f"{cfg['nombre']}: {resumen}")
    print(f"Historia {ym_key(completos[0])}..{ym_key(completos[-1])} ({n_meses} meses) | fuente {fuente_ventas}")
    print(f"Modelo {pv['modelo']} | WAPE {pv['error_medio']:.1%} | confiabilidad {pv['confiabilidad']} "
          f"(modelo sin ajuste: {conf_modelo}) | inventario {con_inventario} | en riesgo {len(en_riesgo)}")
    if mes_pasado:
        print(mes_pasado["frase"])


if __name__ == "__main__":
    main()
