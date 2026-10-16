#!/usr/bin/env python3
"""
Cartera y flujo de caja — Farmalógica S.A. (sección "Cartera y caja" de Predicciones).

Lo llama generar_farmalogica.py y su resultado va en el campo `cartera` del
snapshot. También se puede correr solo para probar:
  python3 analytics/predictivo/cartera_farmalogica.py --hoy 2026-09-24 --out /tmp/cartera.json

Fuentes (SOLO LECTURA):
  - SAP B1 Farmalógica vía el mismo conector MCP del generador (sap_query):
      Invoices (abiertas + historial desde 2024) e IncomingPayments (pagos de
      clientes con sus facturas aplicadas).
  - Caché SQLite de la lista SharePoint "FAR - BANCOS MOVIMIENTOS"
    (skill consulta-sharepoint-gss) para los egresos típicos.

Método (resumen):
  * Comportamiento de pago por cliente: días reales de pago frente al
    vencimiento de cada factura, ponderados por monto. Lo que sigue sin pagarse
    más de 180 días después de vencido cuenta como "no pagó". Con poca historia
    se mezcla con el comportamiento general de todos los clientes.
  * Recaudo esperado de cada factura abierta = saldo × probabilidad de que se
    pague en cada semana, dado lo que ya lleva vencida (condicional).
  * Recaudo de facturas que todavía no existen (ventas nuevas): promedio de lo
    que históricamente se recaudó, semana a semana, de facturas emitidas
    después de cada fecha de corte.
  * Rango probable y confiabilidad: backtest re-corriendo todo en fechas de
    corte pasadas (con la información que había en ese momento).
  * Flujo de caja: entradas = recaudo esperado; salidas = promedio semanal de
    egresos de FAR - BANCOS MOVIMIENTOS (sin traslados entre cuentas propias).
    La lista no trae saldo inicial, así que se muestra el neto acumulado.
"""
import argparse
import json
import os
import sqlite3
from bisect import bisect_right
from collections import defaultdict
from datetime import date, datetime, timedelta

import numpy as np

CACHE_DIR = os.environ.get("FAR_CACHE_DIR", "/Users/horus/.horus/cache")
DIAS_NO_PAGO = 180        # vencido y sin pagar más de esto = "no pagó"
MIN_FACTURAS_CLIENTE = 8  # con menos historia se mezcla con el comportamiento general
MORA_RIESGO = 30          # cliente "paga tarde" si su mora típica supera esto
VENCIDA_GESTION = 60      # facturas vencidas hace más de esto: gestionar cobro
SEMANAS = 13
EMPRESAS_GRUPO = ("LABORATORIOS RYAN", "ONE LATAM", "ONELATAM", "ABAMIA", "MEDITRACK", "KELAB")


# ----------------------------------------------------------------- formato
def pesos_corto(v):
    a = abs(v)
    if a >= 1e9:
        t = f"{a / 1e9:,.1f}".replace(".", ",") + " mil millones"
    elif a >= 1e6:
        t = f"{a / 1e6:,.0f}".replace(",", ".") + " millones"
    else:
        t = f"{a:,.0f}".replace(",", ".")
    return ("-$" if v < 0 else "$") + t


MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_corta(d):
    return f"{d.day} de {MESES_ES[d.month - 1]}"


SIGLAS = {"SA", "SAS", "S", "A", "IPS", "CV", "JM", "LTDA", "SAC", "EPS", "ESE", "S&D", "D", "&"}
MINUSC = {"DE", "DEL", "Y", "LA", "EL", "LOS", "LAS"}


def titulo_cliente(n):
    out = []
    for i, w in enumerate(n.split()):
        if "." in w or w.strip(".,") in SIGLAS:
            out.append(w)
        elif w in MINUSC and i > 0:
            out.append(w.lower())
        else:
            out.append(w.capitalize())
    return " ".join(out)


# ----------------------------------------------------------------- datos
def cargar_sap():
    """Facturas y pagos desde SAP (solo lectura, tools/call sap_query)."""
    import generar_farmalogica as gf
    _, sid = gf._mcp_post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                           "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                                      "clientInfo": {"name": "predictivo-cartera", "version": "1"}}})
    gf._mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)

    def q(args):
        args["maxPageSize"] = 0
        res, _ = gf._mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                               "params": {"name": "sap_query", "arguments": args}}, sid)
        if not res or "result" not in res or res["result"].get("isError"):
            raise RuntimeError(f"SAP no respondió bien: {str(res)[:300]}")
        return json.loads(res["result"]["content"][0]["text"])["value"]

    campos = "DocEntry,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate"
    return {
        "inv": q({"entity": "Invoices", "select": campos + ",DocumentStatus",
                  "filter": "DocDate ge '2024-01-01' and Cancelled eq 'tNO'"}),
        "open": q({"entity": "Invoices", "select": campos, "filter": "DocumentStatus eq 'bost_Open'"}),
        "pay": q({"entity": "IncomingPayments", "select": "DocEntry,DocDate,CardCode,DocType,PaymentInvoices",
                  "filter": "DocDate ge '2024-01-01' and Cancelled eq 'tNO'"}),
    }


def egresos_bancos():
    """Egresos mensuales (meses completos) de FAR - BANCOS MOVIMIENTOS, sin traslados propios."""
    path = os.path.join(CACHE_DIR, "far_bancos_movimientos", "far_bancos_movimientos.db")
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    filas = conn.execute("""
        SELECT substr(json_extract(data,'$.FechaContabilizacion'),1,7) AS m,
               SUM(CASE WHEN v > 0 THEN v ELSE 0 END), SUM(CASE WHEN v < 0 THEN -v ELSE 0 END), COUNT(*)
        FROM (SELECT data, json_extract(data,'$.CargoAbonoML') AS v FROM items
              WHERE substr(COALESCE(json_extract(data,'$.CuentaContrapartida'),''),1,4) NOT IN ('1110','1120'))
        GROUP BY m ORDER BY m""").fetchall()
    ult = conn.execute("SELECT MAX(json_extract(data,'$.FechaContabilizacion')) FROM items").fetchone()[0]
    conn.close()
    return {"meses": [{"mes": m, "entradas": e, "salidas": s, "n": n} for m, e, s, n in filas if m],
            "ultimo": (ult or "")[:10]}


# ----------------------------------------------------------------- modelo
def d10(s):
    return date.fromisoformat(s[:10])


class Datos:
    def __init__(self, raw):
        self.fact = {}
        for r in raw["inv"] + raw["open"]:
            self.fact[r["DocEntry"]] = {"cli": r["CardCode"], "nombre": r["CardName"], "fecha": d10(r["DocDate"]),
                                        "vence": d10(r["DocDueDate"]), "total": float(r["DocTotal"]),
                                        "pagado": float(r["PaidToDate"])}
        self.abiertas = {r["DocEntry"] for r in raw["open"]}
        self.hist = {r["DocEntry"] for r in raw["inv"]}  # facturas desde 2024 (historial completo de pagos)
        self.pagos = defaultdict(list)  # DocEntry factura -> [(fecha pago, monto)]
        for p in raw["pay"]:
            if p.get("DocType") != "rCustomer":
                continue
            f = d10(p["DocDate"])
            for l in p.get("PaymentInvoices") or []:
                if l.get("InvoiceType") == "it_Invoice" and l.get("SumApplied"):
                    self.pagos[l["DocEntry"]].append((f, float(l["SumApplied"])))

    def perfiles(self, corte):
        """Muestras (mora_días, monto) por cliente con lo que se sabía en `corte`."""
        por_cli, glob = defaultdict(list), []
        for de in self.hist:
            fa = self.fact[de]
            if fa["fecha"] >= corte or fa["total"] <= 0:
                continue
            pagado = 0.0
            for f, m in self.pagos.get(de, []):
                if f < corte:
                    mora = (f - fa["vence"]).days
                    por_cli[fa["cli"]].append((mora, m)); glob.append((mora, m)); pagado += m
            resto = self.saldo_en(de, corte)
            if resto > 1 and (corte - fa["vence"]).days > DIAS_NO_PAGO:
                por_cli[fa["cli"]].append((10 ** 6, resto)); glob.append((10 ** 6, resto))
        return por_cli, glob

    def saldo_en(self, de, corte):
        """Saldo de la factura en `corte`. Si hoy está cerrada, solo cuenta lo que se pagó con recibos
        (lo cerrado con notas crédito o cruces no es recaudo)."""
        fa = self.fact[de]
        lst = self.pagos.get(de, [])
        antes = sum(m for f, m in lst if f < corte)
        if de in self.abiertas:
            return fa["total"] - fa["pagado"] + sum(m for f, m in lst if f >= corte)
        return sum(m for _, m in lst) - antes


class Perfil:
    """Distribución ponderada de días de mora (con 'no pagó' = 10**6)."""

    def __init__(self, muestras):
        muestras = sorted(muestras)
        self.x = [m for m, _ in muestras]
        self.cum = np.cumsum([w for _, w in muestras]) if muestras else np.array([])
        self.total = float(self.cum[-1]) if len(self.cum) else 0.0

    def masa_hasta(self, dias):  # peso con mora <= dias
        i = bisect_right(self.x, dias)
        return float(self.cum[i - 1]) if i else 0.0

    def mediana(self):
        if not self.total:
            return None
        i = int(np.searchsorted(self.cum, self.total / 2))
        return self.x[min(i, len(self.x) - 1)]


def prob_semanas(perf_cli, perf_glob, n_cli, mora_actual, semanas):
    """P(pagar en cada semana futura | ya lleva `mora_actual` días), mezclando cliente y general."""
    w = min(1.0, n_cli / MIN_FACTURAS_CLIENTE)
    out = np.zeros(semanas)
    for perf, peso in ((perf_cli, w), (perf_glob, 1 - w)):
        if peso <= 0 or not perf or not perf.total:
            continue
        base = perf.masa_hasta(mora_actual - 1) if mora_actual > -10 ** 5 else 0.0
        vivo = perf.total - base
        if vivo <= 0:
            continue
        prev = base
        for k in range(semanas):
            hasta = perf.masa_hasta(mora_actual + 7 * (k + 1) - 1)
            out[k] += peso * (hasta - prev) / vivo
            prev = hasta
    return out


def proyectar(datos, corte, semanas=SEMANAS):
    """Recaudo esperado por semana de la cartera abierta en `corte`, y detalle por factura."""
    por_cli, glob = datos.perfiles(corte)
    pg = Perfil(glob)
    perf = {c: Perfil(v) for c, v in por_cli.items()}
    ncli = defaultdict(int)
    for de in datos.hist:
        fa = datos.fact[de]
        if fa["fecha"] < corte:
            ncli[fa["cli"]] += 1
    tot = np.zeros(semanas)
    detalle = []
    for de, fa in datos.fact.items():
        if fa["fecha"] >= corte:
            continue
        if de not in datos.hist and de not in datos.abiertas:
            continue
        saldo = datos.saldo_en(de, corte)
        if saldo <= 1:
            continue
        mora = (corte - fa["vence"]).days
        p = prob_semanas(perf.get(fa["cli"]), pg, ncli[fa["cli"]], mora, semanas)
        tot += saldo * p
        detalle.append((de, saldo, mora, p))
    return tot, detalle, perf, pg, ncli


def recaudo_real(datos, desde, hasta, solo_previas=True):
    """Pagos aplicados a facturas entre [desde, hasta). solo_previas: facturas emitidas antes de `desde`."""
    s = 0.0
    for de, lst in datos.pagos.items():
        fa = datos.fact.get(de)
        if fa is None:
            continue
        if solo_previas and fa["fecha"] >= desde:
            continue
        if not solo_previas and fa["fecha"] < desde:
            continue
        s += sum(m for f, m in lst if desde <= f < hasta)
    return s


def recaudo_facturas_nuevas(datos, cortes, semanas):
    """Promedio por semana k de lo recaudado de facturas emitidas después de cada corte."""
    filas = []
    for c in cortes:
        fila = []
        for k in range(semanas):
            a, b = c + timedelta(days=7 * k), c + timedelta(days=7 * (k + 1))
            s = 0.0
            for de, lst in datos.pagos.items():
                fa = datos.fact.get(de)
                if fa and fa["fecha"] >= c:
                    s += sum(m for f, m in lst if a <= f < b)
            fila.append(s)
        filas.append(fila)
    return np.mean(np.array(filas), axis=0)


# ----------------------------------------------------------------- principal
def construir(raw, hoy, bancos=None):
    datos = Datos(raw)
    ultimo_pago = max(f for lst in datos.pagos.values() for f, _ in lst)

    # --- facturas nuevas: cortes pasados con 13 semanas completas de historia
    cortes_nuevas = [hoy - timedelta(days=7 * (SEMANAS + i)) for i in range(0, 26, 2)]
    nuevas = recaudo_facturas_nuevas(datos, cortes_nuevas, SEMANAS)

    # --- proyección actual
    semanal, detalle, perf, pg, ncli = proyectar(datos, hoy)
    esperado = semanal + nuevas

    # --- backtest (4 y 13 semanas) para rango y confiabilidad
    errs = {4: [], 13: []}
    bt_cortes = [hoy - timedelta(days=7 * (SEMANAS + i)) for i in range(0, 20, 2)]
    for c in bt_cortes:
        s, _, _, _, _ = proyectar(datos, c)
        nv = recaudo_facturas_nuevas(datos, [c - timedelta(days=7 * (SEMANAS + j)) for j in range(0, 12, 3)], SEMANAS)
        for h in (4, 13):
            pred = float(s[:h].sum() + nv[:h].sum())
            real = recaudo_real(datos, c, c + timedelta(days=7 * h), solo_previas=False) + \
                recaudo_real(datos, c, c + timedelta(days=7 * h))
            if real > 0:
                errs[h].append((real - pred) / pred)

    def rango(h):
        e = np.array(errs[h]) if errs[h] else np.array([-0.2, 0.2])
        base = float(esperado[:h].sum())
        lo, hi = np.percentile(e, 10), np.percentile(e, 90)
        wape = float(np.mean(np.abs(e)))
        return {"esperado": round(base), "min": round(base * (1 + min(lo, -0.05))),
                "max": round(base * (1 + max(hi, 0.05))), "error_medio": round(wape, 3), "pruebas": len(e)}

    r4, r13 = rango(4), rango(13)
    wape = r4["error_medio"]
    conf = "Alta" if wape <= 0.12 else "Media" if wape <= 0.25 else "Baja"

    # --- foto de la cartera
    tramos = [("por_vencer", "Por vencer", None, 0), ("1_30", "1 a 30 días", 1, 30), ("31_60", "31 a 60 días", 31, 60),
              ("61_90", "61 a 90 días", 61, 90), ("91_180", "91 a 180 días", 91, 180),
              ("181_365", "181 a 365 días", 181, 365), ("mas_365", "Más de 1 año", 366, None)]
    edades = {k: 0.0 for k, *_ in tramos}
    total = vencida = 0.0
    cli_tot = defaultdict(lambda: {"saldo": 0.0, "vencido60": 0.0, "riesgo": 0.0, "nombre": "", "facturas": 0})
    riesgo_total = riesgo_venc = 0.0
    n_riesgo = 0
    for de in datos.abiertas:
        fa = datos.fact[de]
        saldo = fa["total"] - fa["pagado"]
        if saldo <= 1:
            continue
        mora = (hoy - fa["vence"]).days
        total += saldo
        if mora > 0:
            vencida += saldo
        for k, _, a, b in tramos:
            if (a is None and mora <= 0) or (a is not None and mora >= a and (b is None or mora <= b)):
                edades[k] += saldo
        c = cli_tot[fa["cli"]]
        c["nombre"] = fa["nombre"]; c["saldo"] += saldo; c["facturas"] += 1
        pc = perf.get(fa["cli"])
        med = pc.mediana() if pc and ncli[fa["cli"]] >= 3 else None
        tarde = med is not None and med > MORA_RIESGO
        if mora > VENCIDA_GESTION:
            c["vencido60"] += saldo
        if mora > VENCIDA_GESTION or tarde:
            c["riesgo"] += saldo; riesgo_total += saldo; n_riesgo += 1
            if mora > VENCIDA_GESTION:
                riesgo_venc += saldo
        c["mora_tipica"] = med

    def es_grupo(n):
        return any(g in n.upper() for g in EMPRESAS_GRUPO)

    top = sorted(cli_tot.values(), key=lambda c: -c["riesgo"])[:10]
    top_riesgo = []
    for c in top:
        if c["riesgo"] <= 0:
            continue
        nombre = titulo_cliente(c["nombre"])
        med = c.get("mora_tipica")
        if c["vencido60"] > 0:
            frase = f"Gestionar cobro con {nombre}: {pesos_corto(c['vencido60'])} vencidos hace más de {VENCIDA_GESTION} días."
        else:
            frase = (f"{nombre} suele pagar con unos {med} días de retraso: "
                     f"hacer seguimiento a {pesos_corto(c['riesgo'])} antes de que venzan.")
        if med is not None and med >= 10 ** 5:
            nota = "Casi no registra pagos en su historial."
        elif med is not None:
            nota = f"Mora típica: {med} días." if med > 0 else "Suele pagar a tiempo."
        else:
            nota = "Poca historia de pagos."
        top_riesgo.append({"cliente": nombre, "monto_riesgo": round(c["riesgo"]), "vencido_60": round(c["vencido60"]),
                           "saldo": round(c["saldo"]), "grupo": es_grupo(c["nombre"]),
                           "frase": frase + (" (Empresa del grupo: conviene cruzar cuentas.)" if es_grupo(c["nombre"]) else ""),
                           "nota": nota})

    # --- semanas y flujo
    semanas = []
    salidas_sem = None
    if bancos and bancos["meses"]:
        mes_actual = hoy.strftime("%Y-%m")
        ult_mes = bancos["ultimo"][:7]
        completos = [m for m in bancos["meses"] if m["mes"] < mes_actual and m["mes"] <= ult_mes][-8:]
        if len(completos) >= 3:
            sal = np.array([m["salidas"] for m in completos])
            salidas_sem = float(sal.mean() * 12 / 52)
            # entradas a bancos que no son recaudo de facturas (préstamos, reintegros, otros)
            rec_mes = defaultdict(float)
            for lst in datos.pagos.values():
                for f, m in lst:
                    rec_mes[f.strftime("%Y-%m")] += m
            dif = [m["entradas"] - rec_mes.get(m["mes"], 0) for m in completos]
            otras_sem = max(0.0, float(np.median(dif))) * 12 / 52
            sal_var = float(sal.std() / sal.mean()) if sal.mean() else 0
    acum = 0.0
    otras_sem = 0.0 if salidas_sem is None else otras_sem
    alguna_neg = None
    for k in range(SEMANAS):
        ini = hoy + timedelta(days=7 * k)
        fila = {"semana": k + 1, "desde": ini.isoformat(), "etiqueta": f"Sem {k + 1} ({ini.day:02d}/{ini.month:02d})",
                "entradas": round(float(esperado[k])), "de_cartera": round(float(semanal[k])),
                "de_ventas_nuevas": round(float(nuevas[k]))}
        if salidas_sem is not None:
            neto = float(esperado[k]) + otras_sem - salidas_sem
            acum += neto
            fila.update({"otras_entradas": round(otras_sem), "salidas": round(salidas_sem),
                         "neto": round(neto), "acumulado": round(acum)})
            if acum < 0 and alguna_neg is None:
                alguna_neg = k + 1
        semanas.append(fila)

    flujo = None
    if salidas_sem is not None:
        ent13, sal13 = float(esperado.sum()) + otras_sem * SEMANAS, salidas_sem * SEMANAS
        peor = min(s["acumulado"] for s in semanas)
        if alguna_neg:
            sem = "rojo" if peor < -0.1 * sal13 else "amarillo"
            frase = (f"A partir de la semana {alguna_neg} las salidas acumuladas superarían a las entradas esperadas; "
                     f"en el peor momento faltarían {pesos_corto(-peor)} que deben salir del saldo en bancos o de otras fuentes.")
        else:
            sem = "verde"
            frase = (f"En las próximas 13 semanas las entradas esperadas ({pesos_corto(ent13)}) cubren las salidas "
                     f"típicas ({pesos_corto(sal13)}) en todas las semanas.")
        flujo = {"semaforo": sem, "frase": frase, "salidas_semanales": round(salidas_sem),
                 "otras_entradas_semanales": round(otras_sem),
                 "entradas_13": round(ent13), "salidas_13": round(sal13), "variacion_salidas": round(sal_var, 3),
                 "meses_base": [m["mes"] for m in completos],
                 "aviso": ("La lista FAR - BANCOS MOVIMIENTOS registra movimientos pero no el saldo inicial de las cuentas, "
                           "así que no se puede calcular un saldo confiable: se muestra la diferencia entre entradas y "
                           "salidas esperadas (neto acumulado desde hoy). Las salidas son el promedio de "
                           f"{len(completos)} meses; no incluyen pagos extraordinarios que ya estén programados. "
                           "«Otras entradas» son ingresos a bancos que no vienen de facturas (típicamente préstamos o "
                           "reintegros), estimados con la mediana de esos meses.")}

    # --- ¿cómo le fue el mes pasado?
    mes_pasado = None
    ini_mp = (hoy.replace(day=1) - timedelta(days=1)).replace(day=1)
    fin_mp = hoy.replace(day=1)
    if fin_mp <= ultimo_pago + timedelta(days=1):
        s_mp, _, _, _, _ = proyectar(datos, ini_mp, 6)
        nv_mp = recaudo_facturas_nuevas(datos, [ini_mp - timedelta(days=7 * (SEMANAS + j)) for j in range(0, 12, 3)], 6)
        dias = (fin_mp - ini_mp).days
        pesos_sem = np.array([min(7, max(0, dias - 7 * k)) / 7 for k in range(6)])
        pron = float(((s_mp + nv_mp) * pesos_sem).sum())
        real = recaudo_real(datos, ini_mp, fin_mp) + recaudo_real(datos, ini_mp, fin_mp, solo_previas=False)
        err = (real - pron) / pron if pron else None
        sem = "verde" if err is not None and abs(err) <= 0.10 else "amarillo" if err is not None and abs(err) <= 0.25 else "rojo"
        nombre_mes = MESES_ES[ini_mp.month - 1]
        if err is None:
            frase = "No hay suficiente información para comparar."
        elif err >= 0:
            frase = (f"En {nombre_mes} se esperaba recaudar {pesos_corto(pron)} y entraron {pesos_corto(real)}: "
                     f"{abs(err) * 100:.0f} % más de lo previsto.")
        else:
            frase = (f"En {nombre_mes} se esperaba recaudar {pesos_corto(pron)} y entraron {pesos_corto(real)}: "
                     f"{abs(err) * 100:.0f} % menos de lo previsto.")
        mes_pasado = {"mes": ini_mp.strftime("%Y-%m"), "pronosticado": round(pron), "real": round(real),
                      "error": None if err is None else round(err, 3), "semaforo": sem, "frase": frase,
                      "detalle": "Pronóstico hecho con la información disponible al 1 de " + nombre_mes +
                                 "; lo real son los pagos de clientes aplicados a facturas en SAP."}

    # --- historia mensual de recaudo (para la gráfica)
    por_mes = defaultdict(float)
    for lst in datos.pagos.values():
        for f, m in lst:
            por_mes[f.strftime("%Y-%m")] += m
    mes_hoy = hoy.strftime("%Y-%m")
    historia = [{"mes": m, "recaudo": round(v)} for m, v in sorted(por_mes.items()) if m < mes_hoy][-12:]

    pct_venc = vencida / total if total else 0
    antigua = edades["mas_365"]
    tarjetas = [
        {"id": "cartera_total", "titulo": "Cartera por cobrar hoy", "valor": pesos_corto(total),
         "detalle": f"{len([d for d in datos.abiertas if datos.fact[d]['total'] - datos.fact[d]['pagado'] > 1]):,}".replace(",", ".") +
                    " facturas abiertas en SAP",
         "semaforo": "verde" if pct_venc < 0.3 else "amarillo" if pct_venc < 0.5 else "rojo",
         "frase": f"El {pct_venc * 100:.0f} % ya está vencido ({pesos_corto(vencida)})."},
        {"id": "recaudo_4", "titulo": "Recaudo esperado · 4 semanas", "valor": pesos_corto(r4["esperado"]),
         "detalle": f"Rango probable: {pesos_corto(r4['min'])} a {pesos_corto(r4['max'])}",
         "semaforo": "verde", "frase": "Lo que se espera que paguen los clientes en el próximo mes."},
        {"id": "riesgo", "titulo": "Cartera en riesgo", "valor": pesos_corto(riesgo_total),
         "detalle": f"{pesos_corto(riesgo_venc)} vencidos hace más de {VENCIDA_GESTION} días y "
                    f"{pesos_corto(riesgo_total - riesgo_venc)} de clientes que suelen pagar con más de {MORA_RIESGO} días de retraso"
                    " (" + f"{n_riesgo:,}".replace(",", ".") + " facturas)",
         "semaforo": "rojo" if riesgo_total > 0.3 * total else "amarillo" if riesgo_total > 0.1 * total else "verde",
         "frase": "Revise abajo con quién gestionar el cobro primero."},
        {"id": "confiabilidad", "titulo": "Qué tan confiable es el pronóstico", "valor": conf,
         "detalle": f"En pruebas con fechas pasadas se equivocó en promedio un {wape * 100:.0f} % a 4 semanas",
         "semaforo": {"Alta": "verde", "Media": "amarillo", "Baja": "rojo"}[conf],
         "frase": {"Alta": "Puede usarlo para planear con tranquilidad.",
                   "Media": "Úselo como guía; revise el rango probable.",
                   "Baja": "Tómelo como referencia general, no como cifra exacta."}[conf]},
    ]
    if flujo:
        tarjetas.append({"id": "flujo", "titulo": "Flujo de caja · 13 semanas",
                         "valor": pesos_corto(flujo["entradas_13"] - flujo["salidas_13"]),
                         "detalle": f"Entradas {pesos_corto(flujo['entradas_13'])} · salidas típicas {pesos_corto(flujo['salidas_13'])}",
                         "semaforo": flujo["semaforo"],
                         "frase": "Diferencia esperada entre lo que entra y lo que sale."})

    resumen = (f"En las próximas 4 semanas se espera recaudar entre {pesos_corto(r4['min'])} y {pesos_corto(r4['max'])}, "
               f"y en 13 semanas entre {pesos_corto(r13['min'])} y {pesos_corto(r13['max'])}.")

    alertas = []
    for t in top_riesgo[:5]:
        alertas.append({"prioridad": "alta" if t["vencido_60"] > 0 else "media", "tipo": "cobro",
                        "titulo": f"{t['cliente']} · {pesos_corto(t['monto_riesgo'])} en riesgo", "accion": t["frase"]})
    if antigua > 0:
        alertas.append({"prioridad": "media", "tipo": "cartera_antigua",
                        "titulo": f"{pesos_corto(antigua)} con más de un año vencidos",
                        "accion": "Revisar con Contabilidad si esa cartera ya está provisionada o si se debe depurar; "
                                  "el pronóstico casi no cuenta con recaudarla."})
    if flujo and flujo["semaforo"] != "verde":
        alertas.append({"prioridad": "alta" if flujo["semaforo"] == "rojo" else "media", "tipo": "caja",
                        "titulo": "Posible estrechez de caja", "accion": flujo["frase"]})

    return {
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "fuente": {"sap": "Invoices + IncomingPayments (SAP B1 Farmalógica, solo lectura)",
                   "bancos": "FAR - BANCOS MOVIMIENTOS" if bancos else None,
                   "bancos_hasta": bancos["ultimo"] if bancos else None,
                   "pagos_hasta": ultimo_pago.isoformat(), "historial_desde": "2024-01-01"},
        "resumen": resumen,
        "tarjetas": tarjetas,
        "cartera": {"total": round(total), "vencida": round(vencida), "por_vencer": round(total - vencida),
                    "en_riesgo": round(riesgo_total), "en_riesgo_vencida_60": round(riesgo_venc),
                    "edades": [{"id": k, "tramo": t, "monto": round(edades[k])} for k, t, *_ in tramos]},
        "recaudo": {"semanas_4": r4, "semanas_13": r13, "confiabilidad": conf, "error_medio": wape,
                    "historia": historia},
        "semanas": semanas,
        "flujo": flujo,
        "top_riesgo": top_riesgo,
        "mes_pasado": mes_pasado,
        "alertas": alertas,
        "eps": {"titulo": "Riesgo EPS (próximamente)",
                "frase": "Aquí se mostrará el contexto del sector salud (EPS intervenidas o con pagos atrasados) "
                         "para ajustar la probabilidad de pago de los clientes expuestos. Aún no se incluye: "
                         "no hay una fuente de datos confiable conectada."},
        "como_leer": [
            "La cartera y los pagos salen directamente de SAP; las cifras están en pesos colombianos.",
            "El recaudo esperado usa cómo ha pagado cada cliente desde 2024: si suele pagar 20 días tarde, "
            "se espera su pago unos 20 días después del vencimiento.",
            "Incluye también lo que se cobrará de facturas que aún no se han emitido, según lo que suele pasar.",
            "El rango probable sale de probar el método en fechas pasadas: lo normal es que el resultado caiga ahí.",
            f"«En riesgo» = facturas vencidas hace más de {VENCIDA_GESTION} días o de clientes cuya mora típica supera {MORA_RIESGO} días.",
            "Semáforo: 🟢 todo bien, 🟡 conviene revisarlo, 🔴 requiere acción pronto.",
        ],
    }


def generar(hoy):
    return construir(cargar_sap(), hoy, egresos_bancos())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hoy")
    ap.add_argument("--raw", help="JSON con {inv, open, pay} ya descargado (pruebas)")
    ap.add_argument("--out")
    a = ap.parse_args()
    h = date.fromisoformat(a.hoy) if a.hoy else date.today()
    raw = json.load(open(a.raw)) if a.raw else cargar_sap()
    res = construir(raw, h, egresos_bancos())
    txt = json.dumps(res, ensure_ascii=False, indent=1)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(txt + "\n")
    print(res["resumen"])
    for t in res["tarjetas"]:
        print(" -", t["titulo"], t["valor"], "|", t["detalle"])
    if res["mes_pasado"]:
        print(res["mes_pasado"]["frase"])
    if res["flujo"]:
        print(res["flujo"]["frase"])
    for t in res["top_riesgo"]:
        print("  *", t["frase"])
