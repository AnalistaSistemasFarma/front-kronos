#!/usr/bin/env python3
"""
Decisiones por artículo (FASE 1) — módulo "Predicciones" de SynerLink.

Funciones PURAS (sin red ni base de datos): reciben las series de venta, el
inventario y los datos de SAP ya leídos por generar_farmalogica.py /
generar_empresa.py y devuelven una fila por (artículo, decisión) lista para
publicar en dbo.predictivo_decisiones (ver publicar_decisiones.js).

Núcleo: reglas + estadística. Nada de modelos de lenguaje.

Decisiones de F1 (catálogo del plan 2026-09-29):
  D1 reabastecer ........ urgente / pronto / no / no_aplica (+ cantidad sugerida)
  D2 quiebre en 30 días . alto / medio / bajo (+ probabilidad)
  D3 vence antes de venderse (solo empresas con lotes: Farmalógica) . alto / medio / bajo
  D7 registro sanitario por vencer que afecta la venta . bloquea / renovar_ya / vigilar / ok

Distribución de la demanda (Monte Carlo, ~1.000 trayectorias mensuales):
  * Demanda regular (>= 4 de los últimos 6 meses con venta): ritmo mensual =
    0,5 x SES(0,3) + 0,5 x promedio de 6 meses (la MISMA fórmula que ya usa el
    snapshot para los días de inventario) multiplicado por un factor de error
    remuestreado de los errores reales del backtest de origen móvil
    (real / pronóstico a 1 mes). Con pocos errores se usa un lognormal con
    CV 50 % y la calidad del dato baja.
  * Demanda intermitente (ADI > 1,32): TSB separa la probabilidad de que haya
    venta en un mes (p) y el tamaño cuando la hay (z). Cada mes: Bernoulli(p) x
    tamaño binomial negativo (o Poisson si no hay sobredispersión).
  * Horizontes en días: se interpola la demanda acumulada de la trayectoria.

Posición de inventario = aprobado + cuarentena + OC abiertas - comprometido.
Disponible hoy       = aprobado - comprometido (lo que se puede despachar ya).

La probabilidad del evento y la CALIDAD DEL DATO (alta / media / baja) se
entregan por separado. Prioridad = probabilidad x impacto en pesos.

Pruebas: python3 -m unittest analytics/predictivo/test_decisiones_articulo.py
"""
import math
import zlib
from datetime import date

import numpy as np

VERSION_MOTOR = 'f1-2026-09-30'
NIVEL_SERVICIO = 0.95
COBERTURA_OBJETIVO_DIAS = 90
LEAD_TIME_DEFECTO_DIAS = 30
HORIZONTE_QUIEBRE_DIAS = 30
N_SIMULACIONES = 1000
SIN_FECHA_RS = 9000  # SAP guarda 9999-01-01 cuando el registro no tiene fecha cargada

# Umbrales de las opciones (probabilidad del evento)
UMBRAL_ALTO = 0.5
UMBRAL_MEDIO = 0.2

DECISIONES = {
    'D1': ('urgente', 'pronto', 'no', 'no_aplica'),
    'D2': ('alto', 'medio', 'bajo'),
    'D3': ('alto', 'medio', 'bajo'),
    'D7': ('bloquea', 'renovar_ya', 'vigilar', 'ok'),
}
ACCIONABLES = {
    'D1': {'urgente', 'pronto'},
    'D2': {'alto', 'medio'},
    'D3': {'alto', 'medio'},
    'D7': {'bloquea', 'renovar_ya'},
}


# ----------------------------------------------------------------- formato
def num(v):
    return f'{round(v):,.0f}'.replace(',', '.')


def pesos_corto(v):
    a = abs(v)
    if a >= 1e9:
        t = f'{a / 1e9:,.1f}'.replace('.', ',') + ' mil millones'
    elif a >= 1e6:
        t = f'{a / 1e6:,.0f}'.replace(',', '.') + ' millones'
    else:
        t = f'{a:,.0f}'.replace(',', '.')
    return ('-$' if v < 0 else '$') + t


def pct(p):
    return f'{round(p * 100):.0f} %'


def dias_txt(n, articulo=True):
    """'los 7 días' / 'el 1 día' (o sin artículo)."""
    base = f'{n} día' if n == 1 else f'{n} días'
    if not articulo:
        return base
    return ('el ' if n == 1 else 'los ') + base


def redondear10(x):
    return int(math.ceil(max(0.0, x) / 10.0) * 10)


# ----------------------------------------------------------------- sugerido
def sugerido_pedir(venta_diaria, stock, cuarentena=0.0, oc_abiertas=0.0, comprometido=0.0,
                   cobertura_dias=COBERTURA_OBJETIVO_DIAS):
    """Unidades a pedir para quedar cubiertos `cobertura_dias`, en múltiplos de 10.

    Sin OC ni comprometido (valores por defecto) da EXACTAMENTE el sugerido
    histórico del snapshot: 90 x venta diaria - aprobado - cuarentena. Con el
    arreglo aprobado se descuentan además las OC abiertas y se suma lo ya
    comprometido con clientes (pedidos de venta aún sin despachar).
    """
    falta = (cobertura_dias * venta_diaria - stock - cuarentena
             - max(0.0, oc_abiertas) + max(0.0, comprometido))
    return redondear10(falta)


# ----------------------------------------------------------------- series
def ses(y, alpha):
    lvl = y[0]
    for v in y[1:]:
        lvl = alpha * v + (1 - alpha) * lvl
    return lvl


def es_intermitente(y):
    """ADI (intervalo medio entre ventas) > 1,32 en los últimos 12 meses."""
    u = np.asarray(y[-12:], float)
    nz = int((u > 0).sum())
    return nz > 0 and len(u) / nz > 1.32


def es_regular(y):
    return int((np.asarray(y[-6:], float) > 0).sum()) >= 4


def tsb_componentes(y, alpha=0.1, beta=0.1):
    """(p, z) de TSB: probabilidad de venta por mes y tamaño medio cuando hay venta.

    p x z coincide con croston(y, tsb=True) de generar_farmalogica.py.
    """
    y = np.asarray(y, float)
    nz = np.nonzero(y > 0)[0]
    if len(nz) == 0:
        return 0.0, 0.0
    z = float(y[nz[0]])
    p = len(nz) / len(y)
    for v in y[nz[0] + 1:]:
        p = beta * (1.0 if v > 0 else 0.0) + (1 - beta) * p
        if v > 0:
            z = alpha * v + (1 - alpha) * z
    return p, z


def ritmo_mensual(y):
    """Venta mensual proyectada con la MISMA regla del snapshot. None si no aplica."""
    y = np.asarray(y, float)
    if len(y) == 0 or y[-12:].sum() <= 0:
        return None, None
    if es_regular(y):
        return 0.5 * ses(y, 0.3) + 0.5 * float(y[-6:].mean()), 'regular'
    if es_intermitente(y):
        p, z = tsb_componentes(y)
        return p * z, 'intermitente'
    return None, None


def errores_ritmo(y, n_origenes=12, minimo_historia=6):
    """Cocientes real / pronóstico a 1 mes (origen móvil) de la regla de ritmo."""
    y = np.asarray(y, float)
    out = []
    for o in range(max(minimo_historia, len(y) - n_origenes), len(y)):
        f, _ = ritmo_mensual(y[:o])
        if f and f > 0:
            out.append(y[o] / f)
    return np.array(out, float)


# ----------------------------------------------------------------- distribución
class Demanda:
    """Trayectorias Monte Carlo de la demanda mensual futura de un artículo."""

    def __init__(self, y, meses=24, n_sim=N_SIMULACIONES, semilla=0):
        self.y = np.asarray(y, float)
        self.n_sim = n_sim
        self.ritmo, self.tipo = ritmo_mensual(self.y)
        self.n_errores = 0
        self.metodo = 'sin_demanda'
        rng = np.random.default_rng(semilla)
        meses = max(1, int(meses))
        if not self.ritmo:
            self.caminos = np.zeros((n_sim, meses))
        elif self.tipo == 'regular':
            e = errores_ritmo(self.y)
            self.n_errores = len(e)
            if len(e) >= 4:
                self.metodo = 'bootstrap_errores'
                fact = rng.choice(np.maximum(e, 0.0), size=(n_sim, meses), replace=True)
            else:
                self.metodo = 'lognormal_cv50'
                s = math.sqrt(math.log(1 + 0.5 ** 2))
                fact = rng.lognormal(-s * s / 2, s, size=(n_sim, meses))
            self.caminos = self.ritmo * fact
        else:
            p, z = tsb_componentes(self.y)
            nz = self.y[-24:][self.y[-24:] > 0]
            var = float(nz.var(ddof=1)) if len(nz) >= 3 else z * z
            self.n_errores = len(nz)
            ocurre = rng.random((n_sim, meses)) < p
            if var > z + 1e-9 and z > 0:
                self.metodo = 'tsb_binomial_negativa'
                n = z * z / (var - z)
                tam = rng.negative_binomial(n, n / (n + z), size=(n_sim, meses)).astype(float)
            else:
                self.metodo = 'tsb_poisson'
                tam = rng.poisson(max(z, 0.0), size=(n_sim, meses)).astype(float)
            # una venta ocurrida nunca es de 0 unidades
            tam = np.maximum(tam, 1.0)
            self.caminos = np.where(ocurre, tam, 0.0)
        self.acum = np.concatenate([np.zeros((n_sim, 1)), np.cumsum(self.caminos, axis=1)], axis=1)

    def acumulada(self, dias):
        """Demanda acumulada simulada en `dias` (vector de n_sim)."""
        k = max(0.0, dias) / 30.0
        m = self.acum.shape[1] - 1
        if k >= m:  # más allá del horizonte simulado: se extiende al ritmo del último mes
            return self.acum[:, m] * (k / m)
        i = int(math.floor(k))
        fr = k - i
        return self.acum[:, i] + fr * (self.acum[:, i + 1] - self.acum[:, i])

    def cuantil(self, dias, q):
        return float(np.quantile(self.acumulada(dias), q))

    def media(self, dias):
        return float(self.acumulada(dias).mean())

    def prob_supera(self, dias, cantidad):
        """P(D(dias) > cantidad)."""
        return float((self.acumulada(dias) > cantidad).mean())

    def faltante_esperado(self, dias, disponible):
        return float(np.maximum(self.acumulada(dias) - max(disponible, 0.0), 0.0).mean())

    def quiebre(self, dias, oferta, piso=0.0):
        """(P, faltante esperado) de que max(D(dias), piso) supere `oferta`.

        `piso` = lo ya comprometido con clientes: esos pedidos salen en el periodo
        y ya están dentro de la demanda pronosticada (que se basa en lo facturado),
        así que no se suman dos veces; solo se asegura que la demanda no sea menor.
        """
        d = np.maximum(self.acumulada(dias), piso)
        return float((d > oferta).mean()), float(np.maximum(d - oferta, 0.0).mean())


def semilla(codigo, fecha):
    return zlib.crc32(f'{codigo}|{fecha}'.encode())


# ----------------------------------------------------------------- calidad
def calidad_dato(y, demanda, lt_por_defecto=False, stock_conocido=True):
    """alta / media / baja + razones (independiente de la probabilidad)."""
    y = np.asarray(y, float)
    meses_con_historia = len(y) - int(np.argmax(y > 0)) if (y > 0).any() else 0
    razones = []
    nivel = 'alta'
    if meses_con_historia < 6 or demanda.n_errores < 4 or not stock_conocido:
        nivel = 'baja'
        if meses_con_historia < 6:
            razones.append('menos de 6 meses de ventas')
        if demanda.n_errores < 4:
            razones.append('pocas pruebas con meses pasados')
        if not stock_conocido:
            razones.append('inventario no disponible')
    else:
        if demanda.tipo == 'intermitente':
            razones.append('venta intermitente')
        if meses_con_historia < 12:
            razones.append('menos de 12 meses de ventas')
        if lt_por_defecto:
            razones.append(f'sin tiempo de reposición en SAP (se supone {LEAD_TIME_DEFECTO_DIAS} días)')
        if demanda.tipo == 'regular' and demanda.n_errores:
            e = errores_ritmo(y)
            if len(e) and float(np.mean(np.abs(e - 1))) > 0.5:
                razones.append('demanda muy variable')
        if razones:
            nivel = 'media'
    return nivel, razones


def peor_calidad(*niveles):
    orden = {'alta': 0, 'media': 1, 'baja': 2}
    return max(niveles, key=lambda n: orden[n])


def nivel_probabilidad(p):
    return 'alto' if p >= UMBRAL_ALTO else 'medio' if p >= UMBRAL_MEDIO else 'bajo'


# ----------------------------------------------------------------- decisiones
def _fila(codigo, nombre, decision, opcion, motivo, calidad, probabilidad=None, cantidad=None,
          impacto=None, detalle=None):
    if opcion not in DECISIONES[decision]:
        raise ValueError(f'Opción {opcion} no válida para {decision}')
    prioridad = None
    if impacto is not None:
        prioridad = round((probabilidad if probabilidad is not None else 1.0) * impacto, 2)
    return {
        'item_code': str(codigo)[:50],
        'item_nombre': (nombre or '')[:200] or None,
        'decision': decision,
        'opcion': opcion,
        'probabilidad': None if probabilidad is None else round(float(probabilidad), 4),
        'cantidad': None if cantidad is None else round(float(cantidad), 2),
        'impacto_cop': None if impacto is None else round(float(impacto), 2),
        'prioridad': prioridad,
        'calidad': calidad,
        'accionable': opcion in ACCIONABLES[decision],
        'motivo': motivo[:400],
        'detalle': detalle or {},
    }


def decidir_d1_d2(codigo, nombre, y, demanda, stock, cuarentena, oc, comprometido, lead_time,
                  precio, nivel_servicio=NIVEL_SERVICIO, cobertura_dias=COBERTURA_OBJETIVO_DIAS,
                  stock_conocido=True):
    """Filas D1 (reabastecer) y D2 (quiebre a 30 días) de un artículo con demanda."""
    lt_defecto = not lead_time or lead_time <= 0
    lt = LEAD_TIME_DEFECTO_DIAS if lt_defecto else int(lead_time)
    calidad, razones = calidad_dato(y, demanda, lt_defecto, stock_conocido)
    disponible = max(0.0, stock - comprometido)
    posicion = stock + cuarentena + oc - comprometido
    q_lt = demanda.cuantil(lt, nivel_servicio)
    mediana_lt = demanda.cuantil(lt, 0.5)
    q_lt_30 = demanda.cuantil(lt + 30, nivel_servicio)
    objetivo = demanda.media(lt + cobertura_dias) + max(0.0, q_lt - demanda.media(lt))
    p_lt = demanda.prob_supera(lt, posicion)
    # D2: en 30 días se cuenta lo aprobado + las OC abiertas si el tiempo de reposición real
    # es de 30 días o menos (se espera que lleguen dentro del periodo).
    oc_llega = oc if (not lt_defecto and lt <= HORIZONTE_QUIEBRE_DIAS) else 0.0
    oferta30 = stock + oc_llega
    p30, faltante30 = demanda.quiebre(HORIZONTE_QUIEBRE_DIAS, oferta30, comprometido)
    impacto30 = faltante30 * precio if precio else None
    mensual = demanda.ritmo or 0.0
    # impacto de D1 = venta que se perdería (LT + 30 días) si no se pide nada hoy
    venta_riesgo = demanda.faltante_esperado(lt + 30, posicion) * precio if precio else None
    det = {
        'stock_aprobado': round(stock, 2), 'cuarentena': round(cuarentena, 2),
        'oc_abiertas': round(oc, 2), 'comprometido': round(comprometido, 2),
        'posicion': round(posicion, 2), 'disponible': round(disponible, 2),
        'oferta_30': round(oferta30, 2), 'oc_cuenta_en_30': oc_llega > 0,
        'lead_time_dias': lt, 'lead_time_por_defecto': lt_defecto,
        'venta_mensual': round(mensual, 2), 'tipo_demanda': demanda.tipo,
        'metodo': demanda.metodo, 'n_errores_backtest': demanda.n_errores,
        'demanda_lt_p50': round(mediana_lt, 2), 'demanda_lt_p95': round(q_lt, 2),
        'demanda_30_p50': round(demanda.cuantil(30, 0.5), 2),
        'demanda_30_p95': round(demanda.cuantil(30, nivel_servicio), 2),
        'dias_cobertura': round(disponible / (mensual / 30.0)) if mensual > 0 else None,
        'precio_promedio': round(precio, 2) if precio else None,
        'calidad_razones': razones, 'nivel_servicio': nivel_servicio,
    }
    extra = f' Hay {num(oc)} u en órdenes de compra abiertas.' if oc > 0 else ''
    if stock <= 0 and oc <= 0 and cuarentena <= 0:
        if demanda.tipo == 'intermitente':
            m1 = ('Se vende de forma ocasional y no tiene inventario ni pedidos: '
                  'no se sugiere reabastecer sin un pedido del cliente.')
        else:
            m1 = ('Se vende con regularidad pero no tiene inventario ni pedidos: '
                  'probablemente se fabrica o compra bajo pedido; confirmar con Planeación.')
        d1 = _fila(codigo, nombre, 'D1', 'no_aplica', m1, 'baja', None, None, None, det)
    elif p_lt >= 0.5:
        cant = redondear10(objetivo - posicion)
        oferta = stock + cuarentena + oc
        if comprometido > oferta:
            m1 = (f'Los pedidos de clientes pendientes ({num(comprometido)} u) ya superan lo que hay y lo '
                  f'pedido ({num(oferta)} u); se venden ~{num(mensual)} u al mes. Pedir ~{num(cant)} u ya.')
        else:
            m1 = (f'Lo que hay y lo pedido, menos lo comprometido ({num(posicion)} u), no alcanza para '
                  f'{dias_txt(lt)} que tarda en llegar un pedido; se venden ~{num(mensual)} u al mes. '
                  f'Pedir ~{num(cant)} u ya.')
        d1 = _fila(codigo, nombre, 'D1', 'urgente', m1,
                   calidad, p_lt, cant, venta_riesgo, dict(det, valor_pedido=round(cant * precio) if precio else None))
    elif posicion < q_lt_30:
        cant = redondear10(objetivo - posicion)
        d1 = _fila(codigo, nombre, 'D1', 'pronto',
                   f'Alcanza para el tiempo de reposición ({dias_txt(lt, False)}), pero en el próximo mes '
                   f'quedaría por debajo del nivel de seguridad. Programar un pedido de ~{num(cant)} u.' + extra,
                   calidad, p_lt, cant, venta_riesgo, dict(det, valor_pedido=round(cant * precio) if precio else None))
    else:
        d1 = _fila(codigo, nombre, 'D1', 'no',
                   f'Inventario y pedidos ({num(posicion)} u) cubren el tiempo de reposición con '
                   f'{pct(nivel_servicio)} de confianza. No hace falta pedir por ahora.',
                   calidad, p_lt, 0, venta_riesgo, det)
    op2 = nivel_probabilidad(p30)
    txt_oferta = f'{num(stock)} u aprobadas' + (f' + {num(oc_llega)} u en OC' if oc_llega else '')
    if op2 == 'bajo':
        m2 = (f'Con {txt_oferta} es poco probable ({pct(p30)}) quedarse sin '
              'inventario en los próximos 30 días.')
    else:
        m2 = (f'Probabilidad de {pct(p30)} de agotarse en 30 días: hay {txt_oferta}'
              + (f', {num(comprometido)} u ya comprometidas' if comprometido > 0 else '')
              + f' y se venden ~{num(mensual)} u al mes.')
        if impacto30:
            m2 += f' Venta en riesgo ≈ {pesos_corto(impacto30)}.'
    det2 = dict(det, faltante_esperado_30=round(faltante30, 2))
    d2 = _fila(codigo, nombre, 'D2', op2, m2, calidad, p30, None, impacto30, det2)
    return [d1, d2]


def decidir_d3(codigo, nombre, lotes, demanda, hoy, precio, calidad):
    """D3: ¿algún lote vence antes de venderse? Simulación FEFO sobre las trayectorias."""
    ls = sorted(lotes, key=lambda l: l['vence'])
    total = sum(l['cantidad'] for l in ls)
    acum = 0.0
    peor_p, unid_esperadas, detalle_lotes = 0.0, 0.0, []
    dias_min = None
    for l in ls:
        dias = (l['vence'] - hoy).days
        dias_min = dias if dias_min is None else min(dias_min, dias)
        antes = acum
        if dias < 0:
            # un lote vencido no se puede vender: no absorbe demanda de los demás
            p, sobra = 1.0, l['cantidad']
        else:
            acum += l['cantidad']
            vendido = demanda.acumulada(dias)
            # lo que queda de ESTE lote al vencer: lo vendido va primero a los lotes previos
            restante = np.clip(acum - vendido, 0.0, l['cantidad'])
            p = float((restante > 0.5).mean())
            sobra = float(restante.mean())
        peor_p = max(peor_p, p)
        unid_esperadas += sobra
        detalle_lotes.append({'lote': l['lote'], 'cantidad': round(l['cantidad'], 2),
                              'vence': l['vence'].isoformat(), 'dias': dias,
                              'prob_sobrante': round(p, 4), 'sobrante_esperado': round(sobra, 2),
                              'antes': round(antes, 2)})
    impacto = unid_esperadas * precio if precio else None
    sin_venta = not demanda.ritmo
    if sin_venta:
        op = 'alto' if dias_min is not None and dias_min <= 180 else 'medio' if dias_min is not None and dias_min <= 365 else 'bajo'
        calidad = peor_calidad(calidad, 'media')
    else:
        op = nivel_probabilidad(peor_p)
    peor = max(detalle_lotes, key=lambda d: (d['prob_sobrante'], d['sobrante_esperado']))
    if peor['dias'] < 0:
        m = (f'El lote {peor["lote"]} ya venció ({peor["vence"]}) y figura con {num(peor["cantidad"])} u '
             'en bodega aprobada: verificar y gestionar la baja.')
    elif sin_venta:
        m = (f'No registra ventas en 12 meses y tiene {num(total)} u; el primer lote vence en '
             f'{dias_min} días. Buscar salida comercial o planear la baja.')
    elif op == 'bajo':
        m = f'Al ritmo de venta esperado todos los lotes ({num(total)} u) se venden antes de vencer.'
    else:
        m = (f'Probabilidad de {pct(peor_p)} de que el lote {peor["lote"]} (vence {peor["vence"]}) no se '
             f'venda completo; quedarían ~{num(unid_esperadas)} u sin vender. Priorizar su despacho.')
    det = {'lotes': detalle_lotes, 'unidades_total': round(total, 2), 'venta_mensual': round(demanda.ritmo or 0, 2),
           'sobrante_esperado': round(unid_esperadas, 2), 'metodo': demanda.metodo,
           'precio_promedio': round(precio, 2) if precio else None}
    return _fila(codigo, nombre, 'D3', op, m, calidad, 1.0 if sin_venta and op != 'bajo' else peor_p,
                 round(unid_esperadas, 2), impacto, det)


def registros_por_articulo(regs):
    """{ref: {'vence': date|None, 'registros': [...]}} con los RS activos (no obsoletos)."""
    out = {}
    for r in regs:
        ref = r.get('ref')
        num_rs = (r.get('registro') or '').strip()
        if not ref or num_rs.upper().replace('.', '').replace('/', '') in ('', 'NA', 'NE'):
            continue
        if (r.get('obsoleto') or '').upper() == 'SI' or (r.get('estado') or '').lower() == 'inactivo':
            continue
        g = out.setdefault(ref, {'vence': None, 'registros': set(), 'sin_fecha': 0})
        g['registros'].add(num_rs)
        v = r.get('vence')
        if not v or int(str(v)[:4]) >= SIN_FECHA_RS:
            g['sin_fecha'] += 1
            continue
        d = date.fromisoformat(str(v)[:10])
        g['vence'] = d if g['vence'] is None else max(g['vence'], d)
    return out


def decidir_d7(codigo, nombre, info_rs, hoy, ventas_12m, stock):
    """D7: registro sanitario vencido o por vencer en un artículo que se vende."""
    regs = sorted(info_rs['registros'])
    rs_txt = ', '.join(regs[:2]) + ('…' if len(regs) > 2 else '')
    ventas_mes = ventas_12m / 12.0
    det = {'registros': regs, 'ventas_12m': round(ventas_12m, 2), 'stock': round(stock, 2)}
    if info_rs['vence'] is None:
        return _fila(codigo, nombre, 'D7', 'vigilar',
                     f'El registro sanitario ({rs_txt}) no tiene fecha de vencimiento cargada en SAP: '
                     'no se puede saber si está vigente.', 'baja', None, None, None, det)
    dias = (info_rs['vence'] - hoy).days
    det.update({'vence': info_rs['vence'].isoformat(), 'dias_para_vencer': dias})
    if dias < 0:
        op = 'bloquea'
        m = (f'El registro sanitario {rs_txt} figura vencido desde el {info_rs["vence"].isoformat()}: '
             f'no se puede vender; el producto vende ≈ {pesos_corto(ventas_mes)} al mes. Confirmar la renovación.')
        impacto = ventas_mes * 3
    elif dias < 180:
        op = 'renovar_ya'
        m = (f'El registro sanitario {rs_txt} vence en {dias} días ({info_rs["vence"].isoformat()}) y el '
             f'producto vende ≈ {pesos_corto(ventas_mes)} al mes. Radicar la renovación ya.')
        impacto = ventas_mes * 3
    elif dias < 365:
        op = 'vigilar'
        m = f'El registro sanitario {rs_txt} vence en {dias} días: programar la renovación.'
        impacto = ventas_mes * 3
    else:
        op = 'ok'
        m = f'Registro sanitario vigente por más de un año (vence el {info_rs["vence"].isoformat()}).'
        impacto = 0.0
    calidad = 'media' if info_rs['sin_fecha'] else 'alta'
    return _fila(codigo, nombre, 'D7', op, m, calidad, None, None, impacto, det)


# ----------------------------------------------------------------- orquestación
def precio_promedio(lineas):
    """{ref: precio unitario} con solo las líneas de FACTURA (cantidad y total positivos).

    valor / unidades NETOS no sirve: las notas crédito restan unidades y el cociente se dispara.
    """
    v, u = {}, {}
    for ref, cant, total in lineas:
        if ref and cant > 0 and total > 0:
            v[ref] = v.get(ref, 0.0) + total
            u[ref] = u.get(ref, 0.0) + cant
    return {r: v[r] / u[r] for r in v if u[r] > 0}


def construir_decisiones(*, company_id, hoy, completos, unid, valor12, unid12, nombres, stock, cuarentena,
                         items_sap, lotes=None, registros=None, precio=None, n_sim=N_SIMULACIONES,
                         nivel_servicio=NIVEL_SERVICIO, cobertura_dias=COBERTURA_OBJETIVO_DIAS):
    """Filas de decisión de una empresa.

    unid: {ref: {(año, mes): unidades}} solo meses cerrados; completos: lista de (año, mes).
    items_sap: {ref: {'oc', 'comprometido', 'lead_time'}} (vacío si SAP no respondió).
    lotes: lista de {'codigo','lote','cantidad','vence': date} o None si la empresa no tiene lotes.
    registros: lista de {'ref','registro','vence','estado','obsoleto'} o None.
    """
    hoy_iso = hoy.isoformat()
    if precio is None:
        precio = {r: valor12[r] / unid12[r] for r in valor12 if unid12.get(r, 0) > 0 and valor12[r] > 0}

    def serie(ref):
        return np.array([max(unid.get(ref, {}).get(m, 0.0), 0.0) for m in completos])

    lotes_ref = {}
    for l in lotes or []:
        lotes_ref.setdefault(l['codigo'], []).append(l)
    max_dias_lote = max([(l['vence'] - hoy).days for l in lotes or []] + [0])
    meses_sim = max(6, min(60, int(math.ceil(max_dias_lote / 30.0)) + 1))

    filas = []
    demandas = {}
    refs = set(unid) | {r for r, v in stock.items() if v > 0} | set(lotes_ref)
    for ref in sorted(refs):
        y = serie(ref)
        nombre = nombres.get(ref) or ref
        info = items_sap.get(ref, {})
        lt = info.get('lead_time')
        meses = max(6, int(math.ceil(((lt or LEAD_TIME_DEFECTO_DIAS) + cobertura_dias) / 30.0)) + 1)
        if ref in lotes_ref:
            meses = max(meses, meses_sim)
        dem = Demanda(y, meses=meses, n_sim=n_sim, semilla=semilla(ref, hoy_iso))
        demandas[ref] = dem
        st = float(stock.get(ref, 0.0))
        if dem.ritmo:
            filas.extend(decidir_d1_d2(ref, nombre, y, dem, st, float(cuarentena.get(ref, 0.0)),
                                       float(info.get('oc', 0.0)), float(info.get('comprometido', 0.0)), lt,
                                       precio.get(ref, 0.0), nivel_servicio, cobertura_dias,
                                       stock_conocido=True))
        elif st > 0:
            filas.append(_fila(ref, nombre, 'D1', 'no_aplica',
                               f'Tiene {num(st)} u pero no registra ventas regulares en los últimos 12 meses: '
                               'no se sugiere reabastecer.', 'media', None, 0, None,
                               {'stock_aprobado': round(st, 2), 'oc_abiertas': float(info.get('oc', 0.0))}))
        if ref in lotes_ref:
            cal, _ = calidad_dato(y, dem) if dem.ritmo else ('media', [])
            filas.append(decidir_d3(ref, nombre, lotes_ref[ref], dem, hoy, precio.get(ref, 0.0), cal))
    if registros is not None:
        rs = registros_por_articulo(registros)
        for ref, info_rs in rs.items():
            if valor12.get(ref, 0.0) <= 0:
                continue  # solo productos que se venden
            filas.append(decidir_d7(ref, nombres.get(ref) or ref, info_rs, hoy, valor12[ref],
                                    float(stock.get(ref, 0.0))))
    return {
        'company_id': company_id,
        'fecha_corte': hoy_iso,
        'version_motor': VERSION_MOTOR,
        'parametros': {'nivel_servicio': nivel_servicio, 'cobertura_objetivo_dias': cobertura_dias,
                       'lead_time_defecto_dias': LEAD_TIME_DEFECTO_DIAS, 'n_simulaciones': n_sim,
                       'umbral_alto': UMBRAL_ALTO, 'umbral_medio': UMBRAL_MEDIO},
        'resumen': resumir(filas),
        'filas': filas,
    }


def resumir(filas):
    out = {}
    for f in filas:
        d = out.setdefault(f['decision'], {})
        d[f['opcion']] = d.get(f['opcion'], 0) + 1
    return out
