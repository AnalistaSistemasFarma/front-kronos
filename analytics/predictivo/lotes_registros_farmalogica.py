#!/usr/bin/env python3
"""
Lotes y registros sanitarios de Farmalógica (SOLO LECTURA en SAP).

1) Lotes con vencimiento REAL: vista `Farma_LotesBodegaInsumosB1SLQuery`
   (stock por lote y almacén + `Caducidad` = fecha de vencimiento del lote en SAP).
   Solo se toman los almacenes de producto terminado aprobado, los mismos del
   cálculo de inventario. Se verificó que la suma por artículo coincide con
   `Farma_InventarioB1SLQuery` en esos almacenes.
   Riesgo: se simula la venta de los lotes de cada producto en orden de
   vencimiento (primero vence, primero sale) al ritmo de venta proyectado;
   lo que no alcanza a venderse antes de la fecha de vencimiento queda "en riesgo".
   El valor en riesgo usa el precio promedio de venta de los últimos 12 meses.

2) Registros sanitarios (INVIMA): UDO `FAR_RegiSanitario` (U_Fecha_Vencimiento).
   Si SAP no responde se usa la caché de la lista SharePoint `FAR - REGISTRO SANITARIO`
   (copia del mismo UDO). Se cruzan con las ventas de los últimos 12 meses.

Uso desde generar_farmalogica.py:
    from lotes_registros_farmalogica import generar
    bloque = generar(hoy, ritmo, valor12, unid12, nombres)
"""
import json
import os
import sqlite3
from collections import defaultdict
from datetime import date

VISTA_LOTES = "Farma_LotesBodegaInsumosB1SLQuery"
ALMACENES_APROBADOS = {"BAPPT", "BAPPT2", "BAPPT_YB"}
SIN_FECHA = 9000  # SAP guarda 9999-01-01 cuando el registro no tiene fecha de vencimiento cargada
MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _num(v):
    return f"{round(v):,.0f}".replace(",", ".")


def _pesos_corto(v):
    a = abs(v)
    if a >= 1e9:
        t = f"{a / 1e9:,.1f}".replace(".", ",") + " mil millones"
    elif a >= 1e6:
        t = f"{a / 1e6:,.0f}".replace(",", ".") + " millones"
    else:
        t = f"{a:,.0f}".replace(",", ".")
    return ("-$" if v < 0 else "$") + t


def _fecha(d):
    return f"{d.day} de {MESES_ES[d.month - 1]} de {d.year}"


def _sap(name, args):
    """tools/call de solo lectura contra el MCP de SAP Farmalógica."""
    from generar_farmalogica import _mcp_post
    _, sid = _mcp_post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                                   "clientInfo": {"name": "predictivo-gss", "version": "1"}}})
    _mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    res, _ = _mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                        "params": {"name": name, "arguments": args}}, sid)
    if not res or "result" not in res or res["result"].get("isError"):
        raise RuntimeError(f"SAP no respondió bien: {str(res)[:300]}")
    return json.loads(res["result"]["content"][0]["text"])["value"]


# ------------------------------------------------------------------ lotes
def cargar_lotes_sap():
    filas = _sap("sap_query_view", {"view": VISTA_LOTES, "maxPageSize": 0})
    por_lote = {}
    for r in filas:
        if r.get("WhsCode") not in ALMACENES_APROBADOS or not r.get("Caducidad"):
            continue
        cant = float(r.get("CantEnBodega") or 0)
        if cant <= 0:
            continue
        k = (r["ItemCode"], str(r["Lote"]))
        if k not in por_lote:
            por_lote[k] = {"codigo": r["ItemCode"], "nombre": (r.get("ItemName") or "").strip(),
                           "lote": str(r["Lote"]), "cantidad": 0.0,
                           "vence": date.fromisoformat(r["Caducidad"][:10]), "almacenes": set()}
        por_lote[k]["cantidad"] += cant
        por_lote[k]["almacenes"].add(r["WhsCode"])
    return list(por_lote.values())


def riesgo_lotes(lotes, hoy, ritmo, precio, nombres):
    """Lotes que no alcanzan a venderse antes de vencer (orden primero-vence-primero-sale)."""
    salida = []
    por_ref = defaultdict(list)
    for l in lotes:
        por_ref[l["codigo"]].append(l)
    for ref, ls in por_ref.items():
        diaria = ritmo.get(ref, 0.0)
        acumulado = 0.0
        for l in sorted(ls, key=lambda x: x["vence"]):
            dias = (l["vence"] - hoy).days
            capacidad = max(dias, 0) * diaria
            acumulado += l["cantidad"]
            sobrante = min(l["cantidad"], max(0.0, acumulado - capacidad))
            if dias < 0:
                nivel = "rojo"
            elif diaria <= 0:
                # sin ventas recientes: solo se alerta si vence en los próximos 6 meses
                if dias > 180:
                    continue
                nivel = "rojo" if dias < 90 else "amarillo"
            elif sobrante > 0:
                nivel = "rojo" if dias < 90 or sobrante >= 0.5 * l["cantidad"] else "amarillo"
            else:
                continue
            nombre = nombres.get(ref) or l["nombre"] or ref
            valor = sobrante * precio.get(ref, 0.0)
            if dias < 0:
                frase = (f"El lote {l['lote']} de {nombre} venció el {_fecha(l['vence'])} y aún figura con "
                         f"{_num(l['cantidad'])} unidades en bodega aprobada.")
                accion = "Verificar el físico y gestionar la baja o destrucción con Calidad."
            elif diaria <= 0:
                frase = (f"El lote {l['lote']} de {nombre} vence el {_fecha(l['vence'])} y el producto no "
                         f"registra ventas en los últimos 12 meses: {_num(l['cantidad'])} unidades en riesgo.")
                accion = "Buscar salida comercial (clientes, exportación o canje) o planear su baja."
            else:
                frase = (f"Priorizar la venta del lote {l['lote']} de {nombre}: vence el {_fecha(l['vence'])}; "
                         f"al ritmo actual quedarían ~{_num(sobrante)} de {_num(l['cantidad'])} unidades sin vender")
                frase += f" (≈ {_pesos_corto(valor)})." if valor > 0 else "."
                accion = "Despacharlo primero, ofrecerlo a clientes de mayor rotación o evaluar una promoción."
            salida.append({
                "codigo": ref, "nombre": nombre, "lote": l["lote"],
                "cantidad": round(l["cantidad"]), "vence": l["vence"].isoformat(),
                "dias_para_vencer": dias, "unidades_sin_vender": round(sobrante),
                "valor_en_riesgo": round(valor), "venta_diaria": round(diaria, 1),
                "almacenes": sorted(l["almacenes"]), "nivel": nivel,
                "frase": frase, "accion": accion,
            })
    orden = {"rojo": 0, "amarillo": 1}
    salida.sort(key=lambda x: (orden[x["nivel"]], -x["valor_en_riesgo"], x["dias_para_vencer"]))
    return salida


# ------------------------------------------------------ registros sanitarios
def cargar_registros_sap():
    filas = _sap("sap_query", {"entity": "FAR_RegiSanitario", "maxPageSize": 0, "select": (
        "DocEntry,U_Referencia,U_Descripcion,U_Registro_Sanitario,U_Fecha_Vencimiento,"
        "U_Estado_Comercializacion,U_Obsoleto")})
    return [{"ref": r.get("U_Referencia"), "desc": r.get("U_Descripcion"),
             "registro": r.get("U_Registro_Sanitario"), "vence": r.get("U_Fecha_Vencimiento"),
             "estado": r.get("U_Estado_Comercializacion"), "obsoleto": r.get("U_Obsoleto")} for r in filas]


def cargar_registros_sharepoint(cache_dir):
    path = os.path.join(cache_dir, "far_registro_sanitario", "far_registro_sanitario.db")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    out = []
    for (d,) in conn.execute("SELECT data FROM items"):
        r = json.loads(d)
        v = r.get("Fecha_x0020_Vencimiento")  # "MM/DD/YYYY 00:00:00"
        if v and "/" in v:
            m, dd, y = v.split(" ")[0].split("/")
            v = f"{y}-{m}-{dd}"
        out.append({"ref": r.get("Referencia"), "desc": None, "registro": r.get("Registro_x0020_Sanitario"),
                    "vence": v, "estado": r.get("Estado_x0020_Comercializaci_x00f"), "obsoleto": r.get("Obsoleto")})
    conn.close()
    return out


def riesgo_registros(regs, hoy, valor12, unid12, nombres):
    # agrupar por número de registro (un registro puede amparar varias referencias)
    grupos = {}
    sin_fecha = set()
    for r in regs:
        num_rs = (r["registro"] or "").strip()
        if not r["ref"] or num_rs.upper().replace(".", "").replace("/", "") in ("", "NA", "NE"):
            continue
        if (r["obsoleto"] or "").upper() == "SI" or (r["estado"] or "").lower() == "inactivo":
            continue
        if not r["vence"] or int(r["vence"][:4]) >= SIN_FECHA:
            sin_fecha.add(num_rs)
            continue
        v = date.fromisoformat(r["vence"][:10])
        g = grupos.setdefault(num_rs, {"vence": v, "refs": set()})
        g["vence"] = max(g["vence"], v)
        g["refs"].add(r["ref"])
    lista, vencidos_sin_venta = [], 0
    for num_rs, g in grupos.items():
        ventas = sum(valor12.get(x, 0.0) for x in g["refs"])
        unid = sum(unid12.get(x, 0.0) for x in g["refs"])
        dias = (g["vence"] - hoy).days
        if ventas <= 0:
            if dias < 0:
                vencidos_sin_venta += 1
            continue
        if dias > 365:
            continue
        meses = dias / 30.4
        nivel = "rojo" if meses < 3 else "amarillo" if meses < 6 else "verde"
        principal = max(g["refs"], key=lambda x: valor12.get(x, 0.0))
        nombre = nombres.get(principal) or principal
        ente = "el INVIMA" if num_rs.upper().startswith("INVIMA") else "la autoridad sanitaria del país"
        if dias < 0:
            frase = (f"El registro sanitario de {nombre} ({num_rs}) figura vencido desde el {_fecha(g['vence'])} "
                     f"y el producto vendió {_pesos_corto(ventas)} en los últimos 12 meses.")
            accion = (f"Confirmar con Asuntos Regulatorios si la renovación ya está radicada ante {ente} "
                      "y actualizar la fecha en SAP; si no, iniciarla de inmediato.")
        else:
            frase = (f"El registro sanitario de {nombre} vence el {_fecha(g['vence'])}; representa "
                     f"{_pesos_corto(ventas)} de ventas al año.")
            accion = f"Iniciar la renovación ante {ente}." if meses < 6 else f"Programar la renovación ante {ente}."
        lista.append({"registro": num_rs, "codigos": sorted(g["refs"]), "nombre": nombre,
                      "vence": g["vence"].isoformat(), "dias_para_vencer": dias,
                      "ventas_12m": round(ventas), "unidades_12m": round(unid),
                      "nivel": nivel, "frase": frase, "accion": accion})
    orden = {"rojo": 0, "amarillo": 1, "verde": 2}
    lista.sort(key=lambda x: (orden[x["nivel"]], -x["ventas_12m"]))
    return lista, len(sin_fecha), vencidos_sin_venta


# ------------------------------------------------------------------ bloque
def generar(hoy, ritmo, valor12, unid12, nombres, cache_dir="/Users/horus/.horus/cache"):
    """Devuelve (bloque 'lotes_registros', lotes_riesgo, n_lotes). Lanza si SAP no da los lotes."""
    precio = {r: valor12[r] / unid12[r] for r in valor12 if unid12.get(r, 0) > 0 and valor12[r] > 0}
    lotes = cargar_lotes_sap()
    lr = riesgo_lotes(lotes, hoy, ritmo, precio, nombres)
    n_rojo_l = sum(1 for x in lr if x["nivel"] == "rojo")
    unid_riesgo = sum(x["unidades_sin_vender"] for x in lr)
    valor_riesgo = sum(x["valor_en_riesgo"] for x in lr)

    fuente_rs = "SAP Business One (registros sanitarios, FAR_RegiSanitario)"
    try:
        regs = cargar_registros_sap()
    except Exception as e:  # noqa: BLE001
        print(f"aviso: registros sanitarios desde SAP no disponibles ({e}); se usa la caché de SharePoint")
        regs = cargar_registros_sharepoint(cache_dir)
        fuente_rs = "SharePoint (FAR - REGISTRO SANITARIO)"
    rs, n_sin_fecha, n_venc_sin_venta = riesgo_registros(regs, hoy, valor12, unid12, nombres)
    cuenta = {k: sum(1 for x in rs if x["nivel"] == k) for k in ("rojo", "amarillo", "verde")}
    ventas_rs = sum(x["ventas_12m"] for x in rs if x["nivel"] != "verde")

    tarjetas = [
        {"id": "lotes", "titulo": "Lotes en riesgo de vencer", "valor": str(len(lr)),
         "detalle": (f"{_num(unid_riesgo)} unidades ≈ {_pesos_corto(valor_riesgo)} · {n_rojo_l} urgentes"
                     if lr else f"Se revisaron {len(lotes)} lotes con existencias"),
         "semaforo": "rojo" if n_rojo_l else "amarillo" if lr else "verde",
         "frase": ("Lotes que no alcanzarían a venderse antes de su fecha de vencimiento."
                   if lr else "Todos los lotes alcanzan a venderse antes de vencer.")},
        {"id": "registros", "titulo": "Registros sanitarios por renovar", "valor": str(cuenta["rojo"] + cuenta["amarillo"]),
         "detalle": (f"{cuenta['rojo']} urgentes (vencidos o a menos de 3 meses) · {cuenta['amarillo']} entre 3 y 6 meses"
                     f" · {cuenta['verde']} entre 6 y 12 meses"),
         "semaforo": "rojo" if cuenta["rojo"] else "amarillo" if cuenta["amarillo"] else "verde",
         "frase": (f"Productos que venden {_pesos_corto(ventas_rs)} al año dependen de estas renovaciones."
                   if ventas_rs else "No hay renovaciones urgentes de productos con ventas.")},
    ]
    bloque = {
        "resumen": (f"{len(lr)} lotes podrían vencerse antes de venderse ({_num(unid_riesgo)} unidades, "
                    f"≈ {_pesos_corto(valor_riesgo)}) y {cuenta['rojo'] + cuenta['amarillo']} registros sanitarios "
                    "de productos con ventas vencen en los próximos 6 meses o ya figuran vencidos."),
        "tarjetas": tarjetas,
        "lotes": {"total_lotes": len(lotes), "en_riesgo": len(lr), "urgentes": n_rojo_l,
                  "unidades_en_riesgo": round(unid_riesgo), "valor_en_riesgo": round(valor_riesgo),
                  "lista": lr[:60]},
        "registros": {"rojo": cuenta["rojo"], "amarillo": cuenta["amarillo"], "verde": cuenta["verde"],
                      "sin_fecha": n_sin_fecha, "vencidos_sin_ventas": n_venc_sin_venta, "lista": rs},
        "fuente": {"lotes": f"SAP Business One (vista {VISTA_LOTES}, almacenes {', '.join(sorted(ALMACENES_APROBADOS))})",
                   "registros": fuente_rs},
        "como_leer": [
            "Lotes: se toman las existencias reales por lote de SAP en las bodegas de producto terminado "
            "aprobado, con la fecha de vencimiento registrada en cada lote.",
            "Suponemos que se despacha primero el lote que vence primero y que el producto se sigue vendiendo "
            "al ritmo proyectado; lo que no alcanza a venderse antes de la fecha de vencimiento queda en riesgo.",
            "El valor en riesgo se calcula con el precio promedio de venta de los últimos 12 meses.",
            "Registros sanitarios: 🔴 vencido o vence en menos de 3 meses, 🟡 entre 3 y 6 meses, 🟢 entre 6 y 12 meses. "
            "Solo se listan productos con ventas en los últimos 12 meses, ordenados por lo que venden.",
            f"{n_sin_fecha} registros activos no tienen fecha de vencimiento cargada en SAP y no se pueden evaluar.",
        ],
    }
    return bloque, lr, len(lotes)
