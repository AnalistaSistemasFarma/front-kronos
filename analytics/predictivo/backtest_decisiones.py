#!/usr/bin/env python3
"""
Backtest retrospectivo de las decisiones por artículo (F1) — SOLO LECTURA en SAP.

Pregunta: ¿la probabilidad de quiebre P(D(30) > q) que calcula
decisiones_articulo.py está bien calibrada, y detecta los quiebres mejor que
el semáforo actual del snapshot (días de inventario < 30 = rojo)?

Método (equivale a correr el generador con --hoy en cada uno de los últimos N
meses, pero leyendo las ventas de SAP una sola vez):
  * Para cada mes de corte t de los últimos N meses cerrados y cada artículo con
    ritmo de venta en t, se arma la distribución de la demanda con la historia
    HASTA t (sin mirar el futuro) y se compara con lo vendido en el mes t+1.
  * No existe el inventario histórico, así que se evalúa sobre una grilla de
    coberturas hipotéticas: q = d x venta diaria proyectada, d en 5..120 días.
    Evento "quiebre" = ventas reales del mes siguiente > q.
    Semáforo actual: rojo si d < 30, amarillo si d < 60.
    Modelo: probabilidad P(D(30) > q); alto >= 0,5, medio >= 0,2.
  * Métricas: Brier (modelo y semáforo como 0/1), puntaje de habilidad frente
    a la tasa base, curva de confiabilidad por tramos de 10 %, y precisión /
    recall de "quiebre" para cada regla.

Uso:
  python3 analytics/predictivo/backtest_decisiones.py --empresa farmalogica --hoy 2026-09-30 --meses 12
  python3 analytics/predictivo/backtest_decisiones.py --empresa olp --out /tmp/bt_olp.json
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decisiones_articulo import Demanda, semilla, UMBRAL_ALTO, UMBRAL_MEDIO  # noqa: E402

GRILLA_DIAS = list(range(5, 121, 5))
TRAMOS = np.linspace(0, 1, 11)


def cargar(empresa):
    if empresa == 'farmalogica':
        from generar_farmalogica import cargar_ventas_sap
        return cargar_ventas_sap()
    from generar_empresa import EMPRESAS, Sap, ventas_vista
    cfg = EMPRESAS[empresa]
    return ventas_vista(Sap(cfg['puerto']), cfg['vista'])


def series_mensuales(ventas, hoy):
    unid = defaultdict(lambda: defaultdict(float))
    meses = set()
    for v in ventas:
        ym = (v['fecha'].year, v['fecha'].month)
        if ym >= (hoy.year, hoy.month):
            continue
        meses.add(ym)
        if v.get('tipo') == 'Articulos' and v.get('ref'):
            unid[v['ref']][ym] += v['cant']
    ini, fin = min(meses), max(meses)
    n = (fin[0] - ini[0]) * 12 + fin[1] - ini[1] + 1
    orden = [((ini[0] * 12 + ini[1] - 1 + k) // 12, (ini[0] * 12 + ini[1] - 1 + k) % 12 + 1) for k in range(n)]
    return orden, {r: np.array([max(unid[r].get(m, 0.0), 0.0) for m in orden]) for r in unid}


def metricas(p, y, flag_sem_rojo, flag_sem_amar):
    p, y = np.asarray(p, float), np.asarray(y, float)
    base = float(y.mean())
    brier = float(np.mean((p - y) ** 2))
    brier_base = float(np.mean((base - y) ** 2))

    def pr(pred):
        pred = np.asarray(pred, bool)
        tp = float((pred & (y == 1)).sum())
        return {'precision': round(tp / pred.sum(), 3) if pred.sum() else None,
                'recall': round(tp / (y == 1).sum(), 3) if (y == 1).sum() else None,
                'marcados': int(pred.sum())}

    confiab = []
    for i in range(10):
        lo, hi = TRAMOS[i], TRAMOS[i + 1]
        m = (p >= lo) & ((p < hi) if i < 9 else (p <= hi))
        if m.sum():
            confiab.append({'tramo': f'{int(lo * 100)}-{int(hi * 100)} %', 'n': int(m.sum()),
                            'prob_media': round(float(p[m].mean()), 3), 'frecuencia_real': round(float(y[m].mean()), 3)})
    return {
        'n': int(len(y)), 'tasa_quiebre': round(base, 3),
        'brier_modelo': round(brier, 4),
        'brier_semaforo_rojo': round(float(np.mean((np.asarray(flag_sem_rojo, float) - y) ** 2)), 4),
        'brier_tasa_base': round(brier_base, 4),
        'habilidad_vs_base': round(1 - brier / brier_base, 3) if brier_base else None,
        'modelo_alto': pr(p >= UMBRAL_ALTO), 'modelo_alto_o_medio': pr(p >= UMBRAL_MEDIO),
        'semaforo_rojo': pr(flag_sem_rojo), 'semaforo_rojo_o_amarillo': pr(flag_sem_amar),
        'confiabilidad': confiab,
    }


def main():
    ap = argparse.ArgumentParser(description='Backtest de calibración de P(quiebre a 30 días)')
    ap.add_argument('--empresa', required=True, choices=['farmalogica', 'olp'])
    ap.add_argument('--hoy', help='Fecha de corte final YYYY-MM-DD (por defecto hoy)')
    ap.add_argument('--meses', type=int, default=12, help='Meses de corte a evaluar')
    ap.add_argument('--min-historia', type=int, default=6, help='Meses mínimos de historia en cada corte')
    ap.add_argument('--n-sim', type=int, default=1000)
    ap.add_argument('--out', help='JSON con los resultados')
    args = ap.parse_args()
    hoy = date.fromisoformat(args.hoy) if args.hoy else date.today()

    ventas = cargar(args.empresa)
    meses, series = series_mensuales(ventas, hoy)
    n = len(meses)
    # cortes: el mes objetivo (t+1) debe estar cerrado -> t va de n-1-meses a n-2
    cortes = [t for t in range(max(args.min_historia, n - 1 - args.meses), n - 1)]
    P, Y, ROJO, AMAR, DIAS, TIPO, CORTE = [], [], [], [], [], [], []
    articulos = set()
    for t in cortes:
        for ref, y in series.items():
            hist = y[:t + 1]
            dem = Demanda(hist, meses=1, n_sim=args.n_sim, semilla=semilla(ref, f'bt{t}'))
            if not dem.ritmo:
                continue
            articulos.add(ref)
            real = float(y[t + 1])
            d30 = dem.acumulada(30)
            diaria = dem.ritmo / 30.0
            for d in GRILLA_DIAS:
                q = d * diaria
                P.append(float((d30 > q).mean()))
                Y.append(1.0 if real > q else 0.0)
                ROJO.append(d < 30)
                AMAR.append(d < 60)
                DIAS.append(d)
                TIPO.append(dem.tipo)
                CORTE.append(t)
    P, Y, ROJO, AMAR, DIAS, TIPO = map(np.array, (P, Y, ROJO, AMAR, DIAS, TIPO))
    res = {
        'empresa': args.empresa, 'hoy': hoy.isoformat(),
        'meses_de_corte': [f'{meses[t][0]}-{meses[t][1]:02d}' for t in cortes],
        'historia': f'{meses[0][0]}-{meses[0][1]:02d}..{meses[-1][0]}-{meses[-1][1]:02d}',
        'articulos_evaluados': len(articulos), 'grilla_dias': GRILLA_DIAS,
        'global': metricas(P, Y, ROJO, AMAR),
        'franja_15_45_dias': metricas(*(x[(DIAS >= 15) & (DIAS <= 45)] for x in (P, Y, ROJO, AMAR))),
        'por_tipo': {tp: metricas(*(x[TIPO == tp] for x in (P, Y, ROJO, AMAR)))
                     for tp in sorted(set(TIPO.tolist()))},
        'por_dias': {int(d): {'tasa_quiebre': round(float(Y[DIAS == d].mean()), 3),
                              'prob_media_modelo': round(float(P[DIAS == d].mean()), 3),
                              'semaforo': 'rojo' if d < 30 else 'amarillo' if d < 60 else 'verde'}
                     for d in GRILLA_DIAS},
    }
    txt = json.dumps(res, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(txt + '\n')
    g = res['global']
    print(f"{args.empresa}: {len(cortes)} cortes, {len(articulos)} artículos, n={g['n']} | "
          f"Brier modelo {g['brier_modelo']} vs semáforo {g['brier_semaforo_rojo']} vs base {g['brier_tasa_base']}")
    print('modelo alto', g['modelo_alto'], '| semáforo rojo', g['semaforo_rojo'])


if __name__ == '__main__':
    main()
