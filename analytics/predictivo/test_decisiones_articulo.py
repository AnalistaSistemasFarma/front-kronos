"""Pruebas de decisiones_articulo.py (stdlib unittest; también corren con pytest).

    python3 -m unittest analytics/predictivo/test_decisiones_articulo.py
"""
import os
import sys
import unittest
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import decisiones_articulo as da  # noqa: E402

HOY = date(2026, 9, 30)
MESES = [(2024 + (8 + k) // 12, (8 + k) % 12 + 1) for k in range(24)]  # sep-2024 .. ago-2026


def serie_regular(nivel=100.0, ruido=0.1, n=24, semilla=1):
    rng = np.random.default_rng(semilla)
    return np.maximum(nivel * (1 + ruido * rng.standard_normal(n)), 0).round()


class SugeridoPedir(unittest.TestCase):
    def test_sin_oc_da_el_sugerido_historico(self):
        # 90 x 10/día - 300 - 100 = 500
        self.assertEqual(da.sugerido_pedir(10, 300, 100), 500)

    def test_descuenta_oc_y_suma_comprometido(self):
        self.assertEqual(da.sugerido_pedir(10, 300, 100, oc_abiertas=400), 100)
        self.assertEqual(da.sugerido_pedir(10, 300, 100, oc_abiertas=400, comprometido=50), 150)

    def test_nunca_negativo_y_multiplo_de_10(self):
        self.assertEqual(da.sugerido_pedir(1, 1000), 0)
        self.assertEqual(da.sugerido_pedir(1.01, 0) % 10, 0)


class Distribucion(unittest.TestCase):
    def test_regular_usa_bootstrap_y_media_cercana_al_ritmo(self):
        y = serie_regular()
        d = da.Demanda(y, meses=6, semilla=7)
        self.assertEqual(d.tipo, 'regular')
        self.assertEqual(d.metodo, 'bootstrap_errores')
        self.assertAlmostEqual(d.media(30) / d.ritmo, 1.0, delta=0.15)
        # cuantiles crecientes
        self.assertLess(d.cuantil(30, 0.5), d.cuantil(30, 0.95))
        self.assertLess(d.cuantil(30, 0.95), d.cuantil(60, 0.95))

    def test_intermitente_usa_tsb(self):
        y = np.array([0, 0, 5, 0, 0, 0, 8, 0, 0, 3, 0, 0] * 2, float)
        d = da.Demanda(y, meses=6, semilla=3)
        self.assertEqual(d.tipo, 'intermitente')
        self.assertTrue(d.metodo.startswith('tsb_'))
        # hay escenarios con cero venta en un mes
        self.assertGreater(float((d.acumulada(30) == 0).mean()), 0.3)

    def test_sin_demanda(self):
        d = da.Demanda(np.zeros(24), meses=3)
        self.assertIsNone(d.ritmo)
        self.assertEqual(d.prob_supera(30, 0), 0.0)

    def test_determinista_con_la_misma_semilla(self):
        y = serie_regular()
        a = da.Demanda(y, semilla=da.semilla('X', '2026-09-30'))
        b = da.Demanda(y, semilla=da.semilla('X', '2026-09-30'))
        self.assertEqual(a.cuantil(45, 0.95), b.cuantil(45, 0.95))

    def test_interpolacion_por_dias(self):
        d = da.Demanda(serie_regular(), meses=3, semilla=1)
        m15, m30 = d.media(15), d.media(30)
        self.assertAlmostEqual(m15 * 2, m30, delta=1e-6)
        # más allá del horizonte simulado se extiende proporcionalmente
        self.assertGreater(d.media(200), d.media(90))


class D1D2(unittest.TestCase):
    def setUp(self):
        self.y = serie_regular(nivel=300)
        self.dem = da.Demanda(self.y, meses=6, semilla=1)

    def _filas(self, stock, oc=0.0, comp=0.0, lt=30, cuarentena=0.0):
        return da.decidir_d1_d2('A1', 'Artículo', self.y, self.dem, stock, cuarentena, oc, comp, lt, 1000.0)

    def test_sin_inventario_es_urgente_y_quiebre_alto(self):
        d1, d2 = self._filas(stock=50)
        self.assertEqual(d1['opcion'], 'urgente')
        self.assertTrue(d1['accionable'])
        self.assertGreater(d1['cantidad'], 0)
        self.assertEqual(d2['opcion'], 'alto')
        self.assertGreater(d2['probabilidad'], 0.9)
        self.assertGreater(d2['prioridad'], 0)

    def test_mucho_inventario_no_pide(self):
        d1, d2 = self._filas(stock=5000)
        self.assertEqual(d1['opcion'], 'no')
        self.assertFalse(d1['accionable'])
        self.assertEqual(d2['opcion'], 'bajo')

    def test_oc_abiertas_bajan_la_urgencia(self):
        sin_oc, _ = self._filas(stock=50, lt=60)
        con_oc, q_con = self._filas(stock=50, oc=3000, lt=60)
        self.assertEqual(sin_oc['opcion'], 'urgente')
        self.assertEqual(con_oc['opcion'], 'no')
        # con reposición de 60 días la OC no llega dentro de los 30: el quiebre sigue alto
        self.assertEqual(q_con['opcion'], 'alto')
        self.assertFalse(q_con['detalle']['oc_cuenta_en_30'])

    def test_oc_cuenta_en_30_dias_si_la_reposicion_es_corta(self):
        _, q = self._filas(stock=50, oc=3000, lt=10)
        self.assertTrue(q['detalle']['oc_cuenta_en_30'])
        self.assertEqual(q['opcion'], 'bajo')

    def test_oc_no_cuenta_si_el_lead_time_es_supuesto(self):
        _, q = self._filas(stock=50, oc=3000, lt=None)
        self.assertFalse(q['detalle']['oc_cuenta_en_30'])

    def test_comprometido_mayor_que_el_stock_es_quiebre(self):
        _, libre = self._filas(stock=400)
        _, comp = self._filas(stock=400, comp=900)
        self.assertLess(libre['probabilidad'], 0.9)
        self.assertEqual(comp['probabilidad'], 1.0)
        d1_libre, _ = self._filas(stock=400)
        d1_comp, _ = self._filas(stock=400, comp=900)
        # el comprometido baja la posición: pide más
        self.assertGreater(d1_comp['cantidad'], d1_libre['cantidad'] or 0)

    def test_precio_solo_con_facturas(self):
        p = da.precio_promedio([('A', 10, 1000.0), ('A', -9, -900.0), ('B', -1, -5.0)])
        self.assertEqual(p, {'A': 100.0})

    def test_lead_time_por_defecto_baja_la_calidad(self):
        d1, _ = self._filas(stock=400, lt=None)
        self.assertTrue(d1['detalle']['lead_time_por_defecto'])
        self.assertEqual(d1['detalle']['lead_time_dias'], da.LEAD_TIME_DEFECTO_DIAS)
        self.assertIn(d1['calidad'], ('media', 'baja'))

    def test_bajo_pedido_no_aplica(self):
        d1, _ = self._filas(stock=0)
        self.assertEqual(d1['opcion'], 'no_aplica')
        self.assertEqual(d1['calidad'], 'baja')

    def test_motivo_en_una_linea(self):
        for f in self._filas(stock=200):
            self.assertNotIn('\n', f['motivo'])
            self.assertLessEqual(len(f['motivo']), 400)


class D3(unittest.TestCase):
    def test_lote_que_vence_pronto_con_poca_venta(self):
        y = serie_regular(nivel=10)
        dem = da.Demanda(y, meses=12, semilla=2)
        lotes = [{'codigo': 'A', 'lote': 'L1', 'cantidad': 500.0, 'vence': HOY + timedelta(days=60)}]
        f = da.decidir_d3('A', 'Art', lotes, dem, HOY, 100.0, 'alta')
        self.assertEqual(f['opcion'], 'alto')
        self.assertGreater(f['cantidad'], 400)

    def test_lote_que_alcanza_a_venderse(self):
        y = serie_regular(nivel=1000)
        dem = da.Demanda(y, meses=12, semilla=2)
        lotes = [{'codigo': 'A', 'lote': 'L1', 'cantidad': 500.0, 'vence': HOY + timedelta(days=300)}]
        f = da.decidir_d3('A', 'Art', lotes, dem, HOY, 100.0, 'alta')
        self.assertEqual(f['opcion'], 'bajo')

    def test_fefo_el_lote_posterior_es_el_que_sobra(self):
        y = serie_regular(nivel=100)
        dem = da.Demanda(y, meses=12, semilla=2)
        lotes = [{'codigo': 'A', 'lote': 'L2', 'cantidad': 300.0, 'vence': HOY + timedelta(days=120)},
                 {'codigo': 'A', 'lote': 'L1', 'cantidad': 300.0, 'vence': HOY + timedelta(days=90)}]
        f = da.decidir_d3('A', 'Art', lotes, dem, HOY, 100.0, 'alta')
        por_lote = {x['lote']: x for x in f['detalle']['lotes']}
        self.assertLess(por_lote['L1']['prob_sobrante'], por_lote['L2']['prob_sobrante'])

    def test_lote_vencido_es_alto_y_no_absorbe_demanda(self):
        y = serie_regular(nivel=100)
        dem = da.Demanda(y, meses=12, semilla=2)
        lotes = [{'codigo': 'A', 'lote': 'V', 'cantidad': 50.0, 'vence': HOY - timedelta(days=5)},
                 {'codigo': 'A', 'lote': 'B', 'cantidad': 100.0, 'vence': HOY + timedelta(days=400)}]
        f = da.decidir_d3('A', 'Art', lotes, dem, HOY, 100.0, 'alta')
        self.assertEqual(f['opcion'], 'alto')
        self.assertIn('ya venció', f['motivo'])


class D7(unittest.TestCase):
    REGS = [
        {'ref': 'A', 'registro': 'INVIMA 2020M-1', 'vence': '2026-10-15', 'estado': 'Activo', 'obsoleto': 'NO'},
        {'ref': 'B', 'registro': 'INVIMA 2020M-2', 'vence': '2026-01-01', 'estado': 'Activo', 'obsoleto': 'NO'},
        {'ref': 'C', 'registro': 'INVIMA 2020M-3', 'vence': '2031-01-01', 'estado': 'Activo', 'obsoleto': 'NO'},
        {'ref': 'D', 'registro': 'INVIMA 2020M-4', 'vence': '9999-01-01', 'estado': 'Activo', 'obsoleto': 'NO'},
        {'ref': 'E', 'registro': 'INVIMA 2020M-5', 'vence': '2026-10-15', 'estado': 'Inactivo', 'obsoleto': 'SI'},
        {'ref': 'F', 'registro': 'NA', 'vence': '2026-10-15', 'estado': 'Activo', 'obsoleto': 'NO'},
    ]

    def test_opciones(self):
        rs = da.registros_por_articulo(self.REGS)
        self.assertNotIn('E', rs)  # obsoleto
        self.assertNotIn('F', rs)  # sin número de registro
        op = {r: da.decidir_d7(r, r, rs[r], HOY, 1.2e6, 10)['opcion'] for r in rs}
        self.assertEqual(op, {'A': 'renovar_ya', 'B': 'bloquea', 'C': 'ok', 'D': 'vigilar'})

    def test_sin_fecha_es_calidad_baja(self):
        rs = da.registros_por_articulo(self.REGS)
        self.assertEqual(da.decidir_d7('D', 'D', rs['D'], HOY, 1e6, 0)['calidad'], 'baja')


class Construir(unittest.TestCase):
    def test_orquestacion(self):
        unid = {'A': {m: 100.0 for m in MESES}, 'B': {}}
        out = da.construir_decisiones(
            company_id=3, hoy=HOY, completos=MESES, unid=unid,
            valor12={'A': 12e6}, unid12={'A': 1200.0}, nombres={'A': 'Art A', 'B': 'Art B'},
            stock={'A': 50.0, 'B': 30.0}, cuarentena={}, items_sap={'A': {'oc': 0, 'comprometido': 0, 'lead_time': 20}},
            lotes=None,
            registros=[{'ref': 'A', 'registro': 'INVIMA X', 'vence': '2026-11-01', 'estado': 'Activo', 'obsoleto': 'NO'}],
            n_sim=200)
        clave = {(f['item_code'], f['decision']): f['opcion'] for f in out['filas']}
        self.assertEqual(clave[('A', 'D1')], 'urgente')
        self.assertEqual(clave[('A', 'D2')], 'alto')
        self.assertEqual(clave[('B', 'D1')], 'no_aplica')
        self.assertEqual(clave[('A', 'D7')], 'renovar_ya')
        self.assertEqual(out['resumen']['D1'], {'urgente': 1, 'no_aplica': 1})
        # sin duplicados (company, fecha, artículo, decisión)
        self.assertEqual(len(clave), len(out['filas']))


if __name__ == '__main__':
    unittest.main()
