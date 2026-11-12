'use client';

/**
 * Tablero Comercial (OLP) — réplica del tablero de BI «Gestión Comercial»
 * (tema Insight: barra superior azul noche, menú lateral, filtros globales,
 * panel de insights, fichas de cliente / producto / vendedor / pedido).
 *
 * Datos en vivo, solo lectura, desde la vista SAP OLP_IND_VentasB1SLQuery vía
 * /api/dashboards/gestion-comercial (mes del corte, mismo lapso del mes anterior
 * y del año anterior). La agregación por filtros se hace aquí.
 *
 * Pendiente de fuente (no está en SAP): meta / presupuesto, canal, segmento,
 * regional y proveedor. Esos espacios se muestran marcados como pendientes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Loader } from '@mantine/core';
import type { ChartData, ChartOptions } from 'chart.js';
import { ChartBox } from '../../../../../components/charts/ChartBox';
import { useDashboardChartPalette } from '../../../../../components/dashboard/useDashboardChartPalette';
import { hoyBogota } from '../../../../../lib/dashboards/gestion-comercial/calculo';
import type { EmpresaGestionComercial } from '../../../../../lib/dashboards/gestion-comercial/access';
import {
  FILTROS_VACIOS,
  agrupar,
  filtrar,
  finDeMes,
  incluye,
  indice,
  insights,
  mesesCerrados,
  pedidos,
  porCiudad,
  porCliente,
  porLinea,
  porProducto,
  porRecuperar,
  porSemana,
  porVendedor,
  serieDiaria,
  totales,
  valor,
  variacion,
  type Fila,
  type Filtros,
  type Grupo,
  type Medida,
  type TableroDatos,
} from '../../../../../lib/dashboards/gestion-comercial/tablero';
import s from './tablero.module.css';
import {
  Card,
  EstadoCliente,
  HBars,
  Icono,
  Kpi,
  Var,
  cx,
  descargarCsv,
  diasEntre,
  fecha,
  mm,
  money,
  num,
  pct,
} from './ui';

type Pagina = 'diario' | 'resumen' | 'cierre' | 'clientes' | 'productos' | 'vendedores' | 'pedidos' | 'detalle';
type Ficha = { tipo: 'cliente' | 'producto' | 'vendedor' | 'pedido'; clave: string } | null;
type Orden = 'f' | 'cn' | 'd' | 'oc' | 'pn' | 'v' | 'q' | 'val';

const MENU: Array<{ key: Pagina; label: string; desc: string; icon: string; sep?: string }> = [
  { key: 'diario', label: 'Seguimiento diario', desc: 'Mes en curso', icon: 'pulse' },
  { key: 'resumen', label: 'Resumen comercial', desc: 'Periodo y comparativos', icon: 'grid' },
  { key: 'cierre', label: 'Cierre mensual', desc: 'Último mes cerrado', icon: 'flag' },
  { key: 'clientes', label: 'Clientes', desc: 'Ficha e histórico', icon: 'users', sep: 'Consultas' },
  { key: 'productos', label: 'Productos', desc: 'Ventas y compradores', icon: 'box' },
  { key: 'vendedores', label: 'Vendedores', desc: 'Resultados y cartera', icon: 'user' },
  { key: 'pedidos', label: 'Pedidos', desc: 'Trazabilidad', icon: 'truck' },
  { key: 'detalle', label: 'Detalle de ventas', desc: 'Consulta línea a línea', icon: 'table' },
];

const ENCABEZADO: Record<Pagina, { e: string; t: string; d: string }> = {
  diario: { e: 'Seguimiento', t: 'Seguimiento diario', d: 'Ritmo de venta del mes en curso frente al mes y al año anterior, al mismo corte.' },
  resumen: { e: 'Resumen', t: 'Resumen comercial', d: 'Resultado del periodo y comparativos por vendedor, línea terapéutica y ciudad.' },
  cierre: { e: 'Cierre', t: 'Cierre mensual', d: 'Resultado completo de un mes cerrado.' },
  clientes: { e: 'Consultas', t: 'Clientes', d: 'Venta por cliente, estado de compra y ficha con productos y facturas.' },
  productos: { e: 'Consultas', t: 'Productos', d: 'Venta por producto, precio promedio y clientes compradores.' },
  vendedores: { e: 'Consultas', t: 'Vendedores', d: 'Resultados y cartera de cada vendedor.' },
  pedidos: { e: 'Consultas', t: 'Pedidos', d: 'Trazabilidad de pedidos (orden de compra) y facturas.' },
  detalle: { e: 'Consultas', t: 'Detalle de ventas', d: 'Consulta línea a línea, paginada.' },
};

const AZ1 = '#005EA8';
const AZ4 = '#0A9EE0';
const MO2 = '#8254CC';
const MO4 = '#946FEF';
const GRIS = '#BFBFBF';

const nombreMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const unicos = (filas: Fila[], k: (r: Fila) => string) => [...new Set(filas.map(k))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));

export default function TableroComercialPage() {
  const { isDark } = useDashboardChartPalette();
  const hoy = hoyBogota();
  const cerrados = useMemo(() => mesesCerrados(hoy, 12), [hoy]);

  const [empresas, setEmpresas] = useState<EmpresaGestionComercial[] | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [corte, setCorte] = useState(hoy);
  const [mesCierre, setMesCierre] = useState(cerrados[0]);
  const [pagina, setPagina] = useState<Pagina>('diario');
  const [data, setData] = useState<TableroDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [insOn, setInsOn] = useState(true);
  const [focus, setFocus] = useState(false);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [med, setMed] = useState<Medida>('neta');
  const [cliQ, setCliQ] = useState('');
  const [busq, setBusq] = useState('');
  const [ficha, setFicha] = useState<Ficha>(null);
  const [dtQ, setDtQ] = useState('');
  const [dtPs, setDtPs] = useState(50);
  const [dtPg, setDtPg] = useState(0);
  const [dtOrden, setDtOrden] = useState<{ k: Orden; dir: 1 | -1 }>({ k: 'f', dir: -1 });
  const cache = useRef(new Map<string, TableroDatos>());

  const corteEfectivo = pagina === 'cierre' ? finDeMes(mesCierre) : corte;

  useEffect(() => {
    fetch('/api/dashboards/gestion-comercial', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) {
          setSinAcceso(true);
          setEmpresas([]);
          return;
        }
        const d = await r.json().catch(() => ({}));
        const list = (d.empresas ?? []) as EmpresaGestionComercial[];
        setEmpresas(list);
        const primera = list.find((e) => e.lista) ?? list[0];
        if (primera) setCompanyId(String(primera.id));
      })
      .catch(() => setEmpresas([]));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    const key = `${companyId}|${corteEfectivo}`;
    const enCache = cache.current.get(key);
    if (enCache) {
      setData(enCache);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId, corte: corteEfectivo });
      const r = await fetch(`/api/dashboards/gestion-comercial?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403) {
        setSinAcceso(true);
        return;
      }
      if (!r.ok) throw new Error(d.error || 'No se pudo cargar el tablero');
      const datos = d as TableroDatos;
      cache.current.set(key, datos);
      setData(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, corteEfectivo]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  /* ---------------- Derivados ---------------- */
  const fA = useMemo(() => (data ? filtrar(data.filas, filtros) : []), [data, filtros]);
  const fP = useMemo(() => (data ? filtrar(data.filasAnterior, filtros) : []), [data, filtros]);
  const fY = useMemo(() => (data ? filtrar(data.filasAnio, filtros) : []), [data, filtros]);
  const tA = useMemo(() => totales(fA), [fA]);
  const tP = useMemo(() => totales(fP), [fP]);
  const tY = useMemo(() => totales(fY), [fY]);
  const serie = useMemo(() => (data ? serieDiaria(fA, fP, fY, data, med) : []), [data, fA, fP, fY, med]);
  const hallazgos = useMemo(() => insights(fA, fP, fY), [fA, fP, fY]);

  const opVendedores = useMemo(() => (data ? unicos(data.filas, (r) => r.v) : []), [data]);
  const opLineas = useMemo(() => (data ? unicos(data.filas, (r) => r.lt) : []), [data]);
  const opCiudades = useMemo(() => (data ? unicos(data.filas, (r) => r.ciu) : []), [data]);
  const catClientes = useMemo(() => {
    if (!data) return [] as Array<{ cc: string; cn: string; nit: string }>;
    const m = new Map<string, { cc: string; cn: string; nit: string }>();
    for (const r of [...data.filas, ...data.filasAnterior, ...data.filasAnio]) if (r.cc && !m.has(r.cc)) m.set(r.cc, { cc: r.cc, cn: r.cn, nit: r.nit });
    return [...m.values()].sort((a, b) => a.cn.localeCompare(b.cn, 'es'));
  }, [data]);

  const gCli = useMemo(() => agrupar(fA, porCliente, med), [fA, med]);
  const gPro = useMemo(() => agrupar(fA, porProducto, med), [fA, med]);
  const gVen = useMemo(() => agrupar(fA, porVendedor, med), [fA, med]);
  const gLin = useMemo(() => agrupar(fA, porLinea, med), [fA, med]);
  const gCiu = useMemo(() => agrupar(fA, porCiudad, med), [fA, med]);
  const iCliP = useMemo(() => indice(agrupar(fP, porCliente, med)), [fP, med]);
  const iCliY = useMemo(() => indice(agrupar(fY, porCliente, med)), [fY, med]);
  const iProY = useMemo(() => indice(agrupar(fY, porProducto, med)), [fY, med]);
  const iVenP = useMemo(() => indice(agrupar(fP, porVendedor, med)), [fP, med]);
  const iVenY = useMemo(() => indice(agrupar(fY, porVendedor, med)), [fY, med]);
  const iLinY = useMemo(() => indice(agrupar(fY, porLinea, med)), [fY, med]);
  const iCiuP = useMemo(() => indice(agrupar(fP, porCiudad, med)), [fP, med]);
  const iCiuY = useMemo(() => indice(agrupar(fY, porCiudad, med)), [fY, med]);
  const recuperar = useMemo(() => porRecuperar(fA, fP), [fA, fP]);
  const listaPedidos = useMemo(() => pedidos(fA), [fA]);

  /** Última compra (factura) de cada cliente en las tres ventanas cargadas. */
  const ultimaCompra = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const r of [...data.filas, ...data.filasAnterior, ...data.filasAnio]) {
      if (r.t !== 'F' || !r.cc) continue;
      const u = m.get(r.cc);
      if (!u || r.f > u) m.set(r.cc, r.f);
    }
    return m;
  }, [data]);
  /** Vendedor con más venta por cliente (asignado). */
  const vendedorDe = useMemo(() => {
    const acc = new Map<string, Map<string, number>>();
    if (!data) return new Map<string, string>();
    for (const r of [...data.filas, ...data.filasAnterior]) {
      const m = acc.get(r.cc) ?? new Map<string, number>();
      m.set(r.v, (m.get(r.v) ?? 0) + r.val);
      acc.set(r.cc, m);
    }
    const out = new Map<string, string>();
    for (const [cc, m] of acc) out.set(cc, [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—');
    return out;
  }, [data]);

  const habT = data?.diasHabilesTranscurridos ?? 0;
  const habM = data?.diasHabilesMes ?? 0;
  const promHabil = habT ? tA.neta / habT : 0;
  const proyeccion = promHabil * habM;
  const ultimoDia = [...serie].reverse().find((p) => p.actual !== 0);

  /* ---------------- Navegación ---------------- */
  const ir = (p: Pagina, f: Ficha = null) => {
    setPagina(p);
    setFicha(f);
    setMenu(false);
    setBusq('');
  };
  const abrirCliente = (cc: string) => ir('clientes', { tipo: 'cliente', clave: cc });
  const abrirProducto = (pc: string) => ir('productos', { tipo: 'producto', clave: pc });
  const abrirVendedor = (v: string) => ir('vendedores', { tipo: 'vendedor', clave: v });
  const abrirPedido = (oc: string) => ir('pedidos', { tipo: 'pedido', clave: oc });
  const setF = (k: keyof Filtros, v: string | null) => {
    setFiltros((f) => ({ ...f, [k]: v || null }));
    setDtPg(0);
  };
  const hayFiltros = Object.values(filtros).some(Boolean) || med !== 'neta';

  /* ---------------- Gráficas ---------------- */
  const lineOpts: ChartOptions<'line'> = { plugins: { legend: { position: 'top' } }, interaction: { mode: 'index', intersect: false } };
  const barOpts: ChartOptions<'bar'> = { plugins: { legend: { position: 'top' } } };
  const chAcum = useMemo<ChartData<'line'>>(
    () => ({
      labels: serie.map((p) => `Día ${p.dia}`),
      datasets: [
        { label: 'Acumulado del mes', data: serie.map((p) => p.acumActual), borderColor: AZ1, backgroundColor: `${AZ1}22`, fill: true, tension: 0.25, borderWidth: 2.5 },
        { label: 'Mes anterior', data: serie.map((p) => p.acumAnterior), borderColor: MO4, backgroundColor: 'transparent', tension: 0.25, borderWidth: 2 },
        { label: 'Año anterior', data: serie.map((p) => p.acumAnio), borderColor: GRIS, backgroundColor: 'transparent', tension: 0.25, borderWidth: 2 },
        {
          label: 'Proyección (ritmo actual)',
          data: serie.map((p) => (habM && data ? (proyeccion * p.dia) / Number(finDeMes(data.corte.slice(0, 7)).slice(8, 10)) : null)),
          borderColor: AZ4,
          backgroundColor: 'transparent',
          borderDash: [6, 4],
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    }),
    [serie, habM, proyeccion, data]
  );
  const chDia = useMemo<ChartData<'bar'>>(
    () => ({
      labels: serie.map((p) => `${p.dia}`),
      datasets: [
        { label: 'Mes actual', data: serie.map((p) => p.actual), backgroundColor: AZ1, borderRadius: 4 },
        { label: 'Mes anterior', data: serie.map((p) => p.anterior ?? 0), backgroundColor: MO4, borderRadius: 4 },
      ],
    }),
    [serie]
  );
  const chSem = useMemo<ChartData<'bar'>>(() => {
    const a = porSemana(fA, med);
    const p = porSemana(fP, med);
    const n = a.reduce((k, v, i) => (v !== 0 || p[i] !== 0 ? i + 1 : k), 1);
    return {
      labels: Array.from({ length: n }, (_, i) => `Semana ${i + 1}`),
      datasets: [
        { label: 'Mes en seguimiento', data: a.slice(0, n), backgroundColor: AZ1, borderRadius: 6 },
        { label: 'Mes anterior', data: p.slice(0, n), backgroundColor: MO4, borderRadius: 6 },
      ],
    };
  }, [fA, fP, med]);
  const chComp = useMemo<ChartData<'bar'>>(
    () => ({
      labels: ['Venta neta', 'Venta bruta', 'Notas crédito'],
      datasets: [
        { label: 'Año anterior', data: [tY.neta, tY.bruta, Math.abs(tY.notas)], backgroundColor: GRIS, borderRadius: 6 },
        { label: 'Mes anterior', data: [tP.neta, tP.bruta, Math.abs(tP.notas)], backgroundColor: MO4, borderRadius: 6 },
        { label: 'Periodo actual', data: [tA.neta, tA.bruta, Math.abs(tA.notas)], backgroundColor: AZ1, borderRadius: 6 },
      ],
    }),
    [tA, tP, tY]
  );

  /* ---------------- Piezas reutilizadas ---------------- */
  const bars = (g: Grupo[], n = 10) => g.slice(0, n).map((x) => ({ key: x.clave, name: x.nombre, value: x.venta }));
  const ncCliente = useMemo(
    () => agrupar(fA.filter((r) => r.t === 'N'), porCliente, 'notas').map((x) => ({ key: x.clave, name: x.nombre, value: Math.abs(x.venta) })),
    [fA]
  );

  const kpisResultado = (
    <div className={cx(s.kpis, s.kpisSm)}>
      <Kpi label='Venta bruta' value={mm(tA.bruta)} sub={money(tA.bruta)} />
      <Kpi label='Notas crédito' value={mm(Math.abs(tA.notas))} sub={tA.bruta ? `${pct(Math.abs(tA.notas) / tA.bruta, false)} de la bruta` : '—'} tone='b' />
      <Kpi label='Facturas' value={num(tA.facturas)} />
      <Kpi label='Clientes' value={num(tA.clientes)} />
      <Kpi label='Unidades' value={num(tA.unidades)} />
      <Kpi label='Margen' value={mm(tA.margen)} sub={tA.neta ? `${pct(tA.margen / tA.neta, false)} sobre venta` : '—'} />
    </div>
  );

  const tablaVendedores = (id: string, conEstado: boolean) => (
    <>
      <div className={s.h2row}>
        <h2 className={s.h2}>{conEstado ? 'Avance y proyección por vendedor' : 'Ranking de vendedores'}</h2>
        <button
          className={cx(s.btn, s.btnSm, s.btnSolid)}
          type='button'
          onClick={() =>
            descargarCsv(id, ['Vendedor', 'Venta', 'Participación', 'Proyección', 'Mes anterior', 'Var. mes', 'Año anterior', 'Var. año', 'Clientes', 'Facturas'], gVen.map((v) => [
              v.nombre,
              Math.round(v.venta),
              (v.participacion * 100).toFixed(1),
              habT ? Math.round((v.venta / habT) * habM) : '',
              Math.round(iVenP.get(v.clave) ?? 0),
              variacion(v.venta, iVenP.get(v.clave) ?? 0)?.toFixed(3) ?? '',
              Math.round(iVenY.get(v.clave) ?? 0),
              variacion(v.venta, iVenY.get(v.clave) ?? 0)?.toFixed(3) ?? '',
              v.clientes,
              v.documentos,
            ]))
          }
        >
          Descargar tabla
        </button>
      </div>
      {conEstado && (
        <p className={s.note}>
          Estado según el ritmo frente al mismo corte del mes anterior: <b>En ritmo</b> ≥ 0 % · <b>En riesgo</b> entre −10 % y 0 % · <b>Crítico</b> &lt; −10 %.
          Cuando se cargue la meta por vendedor, el estado se medirá contra la meta.
        </p>
      )}
      <div className={s.tw}>
        <table className={s.t}>
          <thead>
            <tr>
              <th>#</th>
              <th>Vendedor</th>
              <th className={s.r}>Venta</th>
              <th className={s.r}>Part.</th>
              {conEstado && <th className={s.r}>Proyección</th>}
              <th className={s.r}>Mes anterior</th>
              <th className={s.r}>Vs. mes ant.</th>
              <th className={s.r}>Vs. año ant.</th>
              <th className={s.r}>Clientes</th>
              <th className={s.r}>Facturas</th>
              <th className={s.r}>Última venta</th>
              {conEstado && <th>Estado</th>}
            </tr>
          </thead>
          <tbody>
            {gVen.map((v, i) => {
              const vm = variacion(v.venta, iVenP.get(v.clave) ?? 0);
              return (
                <tr key={v.clave}>
                  <td className={s.dim}>{i + 1}</td>
                  <td>
                    <button type='button' className={s.lnk} onClick={() => abrirVendedor(v.clave)}>{v.nombre}</button>
                  </td>
                  <td className={s.r}>{money(v.venta)}</td>
                  <td className={s.r}>{pct(v.participacion, false)}</td>
                  {conEstado && <td className={s.r}>{habT ? money((v.venta / habT) * habM) : '—'}</td>}
                  <td className={s.r}>{money(iVenP.get(v.clave) ?? 0)}</td>
                  <td className={s.r}><Var v={vm} /></td>
                  <td className={s.r}><Var v={variacion(v.venta, iVenY.get(v.clave) ?? 0)} /></td>
                  <td className={s.r}>{num(v.clientes)}</td>
                  <td className={s.r}>{num(v.documentos)}</td>
                  <td className={s.r}>{fecha(v.ultima)}</td>
                  {conEstado && (
                    <td>
                      {vm == null ? (
                        <span className={s.dim}>—</span>
                      ) : vm >= 0 ? (
                        <span className={cx(s.st, s.stOk)}>En ritmo</span>
                      ) : vm > -0.1 ? (
                        <span className={cx(s.st, s.stWarn)}>En riesgo</span>
                      ) : (
                        <span className={cx(s.st, s.stCrit)}>Crítico</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>Total</td>
              <td className={s.r}>{money(tA.neta)}</td>
              <td className={s.r}>100 %</td>
              {conEstado && <td className={s.r}>{money(proyeccion)}</td>}
              <td className={s.r}>{money(tP.neta)}</td>
              <td className={s.r}><Var v={variacion(tA.neta, tP.neta)} /></td>
              <td className={s.r}><Var v={variacion(tA.neta, tY.neta)} /></td>
              <td className={s.r}>{num(tA.clientes)}</td>
              <td className={s.r}>{num(tA.facturas)}</td>
              <td />
              {conEstado && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );

  const tablaDimension = (titulo: string, g: Grupo[], ip: Map<string, number>, iy: Map<string, number>) => (
    <Card title={titulo}>
      <div className={s.tw} style={{ maxHeight: 420, boxShadow: 'none' }}>
        <table className={s.t}>
          <thead>
            <tr>
              <th>{titulo.replace('Por ', '').replace(/^\w/, (c) => c.toUpperCase())}</th>
              <th className={s.r}>Venta</th>
              <th className={s.r}>Part.</th>
              <th className={s.r}>Vs. mes ant.</th>
              <th className={s.r}>Vs. año ant.</th>
            </tr>
          </thead>
          <tbody>
            {g.map((x) => (
              <tr key={x.clave}>
                <td>{x.nombre}</td>
                <td className={s.r}>{money(x.venta)}</td>
                <td className={s.r}>{pct(x.participacion, false)}</td>
                <td className={s.r}><Var v={variacion(x.venta, ip.get(x.clave) ?? 0)} /></td>
                <td className={s.r}><Var v={variacion(x.venta, iy.get(x.clave) ?? 0)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  /* ---------------- Páginas ---------------- */
  const pDiario = () => (
    <>
      <div className={s.bar}>
        <label className={s.fld}>
          Fecha de corte
          <input type='date' value={corte} max={hoy} onChange={(e) => {
              const v = e.currentTarget.value;
              if (v) setCorte(v);
            }} />
        </label>
      </div>
      {!focus && (
        <p className={s.lead}>
          Al {fecha(data?.corte)} la venta neta acumulada es <b>{mm(tA.neta)}</b>, <Var v={variacion(tA.neta, tP.neta)} /> frente al mismo corte del mes anterior
          {' '}y <Var v={variacion(tA.neta, tY.neta)} /> frente al año anterior. Con el ritmo actual el mes cerraría en <b>{mm(proyeccion)}</b>.
        </p>
      )}
      {!focus && (
        <div className={s.kpis}>
          <Kpi label='Venta acumulada' value={mm(tA.neta)} sub={money(tA.neta)} tone='a' />
          <Kpi label='Meta del mes' value='—' sub='Pendiente: cargar el presupuesto' />
          <Kpi label='Proyección de cierre' value={mm(proyeccion)} sub={`Promedio por día hábil ${mm(promHabil)}`} tone='b' progress={habM ? habT / habM : null} />
          <Kpi label='Vs. mes anterior al mismo corte' value={<Var v={variacion(tA.neta, tP.neta)} />} sub={`Mes anterior: ${mm(tP.neta)}`} />
          <Kpi label='Vs. año anterior al mismo corte' value={<Var v={variacion(tA.neta, tY.neta)} />} sub={`Año anterior: ${mm(tY.neta)}`} />
          <Kpi label='Venta del último día' value={mm(ultimoDia?.actual ?? 0)} sub={ultimoDia ? `Día ${ultimoDia.dia}` : 'Sin facturación'} tone='b' />
        </div>
      )}
      {!focus && (
        <div className={cx(s.kpis, s.kpisSm)}>
          <Kpi label='Días hábiles' value={`${habT} / ${habM}`} sub='Transcurridos del mes' progress={habM ? habT / habM : null} />
          <Kpi label='Facturas / clientes' value={`${num(tA.facturas)} / ${num(tA.clientes)}`} sub={`${num(tA.diasConVenta)} días con facturación`} />
          <Kpi label='Notas crédito del mes' value={mm(Math.abs(tA.notas))} sub={tA.bruta ? `${pct(Math.abs(tA.notas) / tA.bruta, false)} de la bruta` : '—'} />
          <Kpi label='Unidades' value={num(tA.unidades)} sub='Netas del mes' />
          <Kpi label='Margen bruto' value={mm(tA.margen)} sub={tA.neta ? `${pct(tA.margen / tA.neta, false)} sobre la venta` : '—'} />
          <Kpi label='Clientes por recuperar' value={num(recuperar.length)} sub={mm(recuperar.reduce((a, g) => a + g.venta, 0))} />
        </div>
      )}
      <Card title='Venta acumulada vs. mes anterior, año anterior y proyección'>
        <ChartBox type='line' data={chAcum} options={lineOpts} height={320} entranceKey={`acum-${corteEfectivo}-${med}`} />
      </Card>
      <div className={s.grid}>
        <Card title='Venta diaria' note='Mes en seguimiento frente al mismo día del mes anterior.'>
          <ChartBox type='bar' data={chDia} options={barOpts} height={260} entranceKey={`dia-${corteEfectivo}-${med}`} />
        </Card>
        <Card title='Ritmo semanal vs. mes anterior' note='Venta por semana del mes (semana 1 = días 1 a 7).'>
          <ChartBox type='bar' data={chSem} options={barOpts} height={260} entranceKey={`sem-${corteEfectivo}-${med}`} />
        </Card>
      </div>
      {tablaVendedores('Avance_proyeccion_vendedores', true)}
      <div className={s.grid}>
        {tablaDimension('Por ciudad', gCiu, iCiuP, iCiuY)}
        <Card title='Línea terapéutica' note='Venta del mes por línea terapéutica (SAP).'>
          <HBars items={bars(gLin, 12)} />
        </Card>
      </div>
      <div className={s.grid}>
        <Card title='Clientes por recuperar' note='Compraron el mes anterior y todavía no compran en este mes.'>
          <div className={s.tw} style={{ maxHeight: 380, boxShadow: 'none' }}>
            <table className={s.t}>
              <thead>
                <tr><th>Cliente</th><th>Vendedor</th><th className={s.r}>Venta mes anterior</th><th className={s.r}>Última compra</th></tr>
              </thead>
              <tbody>
                {recuperar.map((g) => (
                  <tr key={g.clave}>
                    <td><button type='button' className={s.lnk} onClick={() => abrirCliente(g.clave)}>{g.nombre}</button></td>
                    <td>{vendedorDe.get(g.clave) ?? '—'}</td>
                    <td className={s.r}>{money(g.venta)}</td>
                    <td className={s.r}>{fecha(ultimaCompra.get(g.clave))}</td>
                  </tr>
                ))}
                {!recuperar.length && (
                  <tr><td colSpan={4} className={s.dim}>No hay clientes por recuperar con los filtros actuales.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title='Top 10 clientes del mes' note='Venta neta acumulada. Clic para ver la ficha.'>
          <HBars items={bars(gCli)} onPick={abrirCliente} />
        </Card>
      </div>
      <div className={cx(s.grid, s.three)}>
        <Card title='Top 10 productos'><HBars items={bars(gPro)} onPick={abrirProducto} /></Card>
        <Card title='Vendedores'><HBars items={bars(gVen)} onPick={abrirVendedor} /></Card>
        <Card title='Notas crédito por cliente'><HBars items={ncCliente.slice(0, 10)} notas onPick={abrirCliente} empty='Sin notas crédito en el periodo.' /></Card>
      </div>
    </>
  );

  const pResumen = () => {
    const crece = gCli
      .map((g) => ({ key: g.clave, name: g.nombre, value: g.venta - (iCliY.get(g.clave) ?? 0) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const caen = [...iCliY.entries()]
      .map(([k, v]) => {
        const g = gCli.find((x) => x.clave === k);
        const nombre = g?.nombre ?? catClientes.find((c) => c.cc === k)?.cn ?? k;
        return { key: k, name: nombre, value: (g?.venta ?? 0) - v };
      })
      .filter((x) => x.value < 0)
      .sort((a, b) => a.value - b.value)
      .slice(0, 10);
    return (
      <>
        {!focus && (
          <p className={s.lead}>
            Periodo del {fecha(data?.actual.desde)} al {fecha(data?.actual.hasta)}: venta neta de <b>{mm(tA.neta)}</b> con {num(tA.clientes)} clientes y {num(tA.facturas)} facturas.
          </p>
        )}
        {!focus && (
          <div className={s.kpis}>
            <Kpi label='Venta neta del periodo' value={mm(tA.neta)} sub={money(tA.neta)} tone='a' />
            <Kpi label='Presupuesto' value='—' sub='Pendiente: cargar el presupuesto' />
            <Kpi label='Vs. mismo periodo mes anterior' value={<Var v={variacion(tA.neta, tP.neta)} />} sub={mm(tP.neta)} tone='b' />
            <Kpi label='Vs. mismo periodo año anterior' value={<Var v={variacion(tA.neta, tY.neta)} />} sub={mm(tY.neta)} tone='b' />
            <Kpi label='Clientes con compra' value={num(tA.clientes)} sub={`Año anterior: ${num(tY.clientes)}`} />
            <Kpi label='Notas crédito' value={mm(Math.abs(tA.notas))} sub={`Año anterior: ${mm(Math.abs(tY.notas))}`} />
          </div>
        )}
        <Card title='Comparativo del periodo' note='Mismo lapso del mes anterior y del año anterior.'>
          <ChartBox type='bar' data={chComp} options={barOpts} height={280} entranceKey={`comp-${corteEfectivo}-${med}`} />
        </Card>
        <div className={s.grid}>
          {tablaDimension('Por vendedor', gVen, iVenP, iVenY)}
          {tablaDimension('Por línea terapéutica', gLin, new Map<string, number>(), iLinY)}
        </div>
        <div className={s.grid}>
          {tablaDimension('Por ciudad', gCiu, iCiuP, iCiuY)}
          <Card title='Por canal y segmento' note='Pendiente de fuente: canal (Institucional / Retail) y segmento no vienen en SAP.'>
            <div className={s.empty}>Se habilita cuando se defina el maestro de canal y segmento de clientes.</div>
          </Card>
        </div>
        <div className={s.grid}>
          <Card title='Clientes con mayor crecimiento' note='Diferencia contra el mismo periodo del año anterior.'>
            <HBars items={crece} onPick={abrirCliente} />
          </Card>
          <Card title='Clientes con mayor caída' note='Diferencia contra el mismo periodo del año anterior.'>
            <HBars items={caen} notas onPick={abrirCliente} />
          </Card>
        </div>
      </>
    );
  };

  const pCierre = () => (
    <>
      <div className={s.bar}>
        <label className={s.fld}>
          Mes de cierre
          <select value={mesCierre} onChange={(e) => setMesCierre(e.currentTarget.value)}>
            {cerrados.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </select>
        </label>
      </div>
      {!focus && (
        <p className={s.lead}>
          {nombreMes(mesCierre)} cerró con una venta neta de <b>{mm(tA.neta)}</b>: <Var v={variacion(tA.neta, tP.neta)} /> frente al mes anterior y{' '}
          <Var v={variacion(tA.neta, tY.neta)} /> frente al mismo mes del año anterior.
        </p>
      )}
      {!focus && (
        <div className={s.kpis}>
          <Kpi label='Venta neta' value={mm(tA.neta)} sub={money(tA.neta)} tone='a' />
          <Kpi label='Presupuesto' value='—' sub='Pendiente: cargar el presupuesto' />
          <Kpi label='Vs. mes anterior' value={<Var v={variacion(tA.neta, tP.neta)} />} sub={mm(tP.neta)} tone='b' />
          <Kpi label='Vs. mismo mes año anterior' value={<Var v={variacion(tA.neta, tY.neta)} />} sub={mm(tY.neta)} tone='b' />
          <Kpi label='Días con facturación' value={num(tA.diasConVenta)} sub={`${habM} días hábiles`} />
          <Kpi label='Promedio por factura' value={mm(tA.facturas ? tA.bruta / tA.facturas : 0)} />
        </div>
      )}
      {!focus && kpisResultado}
      <div className={s.grid}>
        <Card title='Ritmo de facturación por semana'>
          <ChartBox type='bar' data={chSem} options={barOpts} height={260} entranceKey={`csem-${corteEfectivo}-${med}`} />
        </Card>
        <Card title='Venta por línea terapéutica'><HBars items={bars(gLin, 12)} /></Card>
      </div>
      {tablaDimension('Por ciudad', gCiu, iCiuP, iCiuY)}
      {tablaVendedores('Ranking_vendedores', false)}
      {tablaClientes('Ranking_clientes', gCli.slice(0, 200))}
      <Card title='Top 10 productos del mes'><HBars items={bars(gPro)} onPick={abrirProducto} /></Card>
    </>
  );

  function tablaClientes(nombre: string, g: Grupo[]) {
    const corteRef = data?.corte ?? hoy;
    return (
      <>
        <div className={s.h2row}>
          <h2 className={s.h2}>Clientes</h2>
          <button
            className={cx(s.btn, s.btnSm, s.btnSolid)}
            type='button'
            onClick={() =>
              descargarCsv(nombre, ['Código', 'Cliente', 'Vendedor', 'Venta', 'Participación', 'Mes anterior', 'Año anterior', 'Facturas', 'Última compra'], g.map((c) => [
                c.clave,
                c.nombre,
                vendedorDe.get(c.clave) ?? '',
                Math.round(c.venta),
                (c.participacion * 100).toFixed(1),
                Math.round(iCliP.get(c.clave) ?? 0),
                Math.round(iCliY.get(c.clave) ?? 0),
                c.documentos,
                ultimaCompra.get(c.clave) ?? '',
              ]))
            }
          >
            Descargar tabla
          </button>
        </div>
        <div className={s.tw}>
          <table className={s.t}>
            <thead>
              <tr>
                <th>#</th><th>Código</th><th>Cliente</th><th>Vendedor</th><th className={s.r}>Venta</th><th className={s.r}>Part.</th>
                <th className={s.r}>Vs. mes ant.</th><th className={s.r}>Vs. año ant.</th><th className={s.r}>Facturas</th>
                <th className={s.r}>Última compra</th><th className={s.r}>Días sin compra</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {g.map((c, i) => {
                const u = ultimaCompra.get(c.clave) ?? null;
                const dias = u ? Math.max(0, diasEntre(u, corteRef)) : null;
                return (
                  <tr key={c.clave}>
                    <td className={s.dim}>{i + 1}</td>
                    <td className={s.dim}>{c.clave}</td>
                    <td><button type='button' className={s.lnk} onClick={() => abrirCliente(c.clave)}>{c.nombre}</button></td>
                    <td>{vendedorDe.get(c.clave) ?? '—'}</td>
                    <td className={s.r}>{money(c.venta)}</td>
                    <td className={s.r}>{pct(c.participacion, false)}</td>
                    <td className={s.r}><Var v={variacion(c.venta, iCliP.get(c.clave) ?? 0)} /></td>
                    <td className={s.r}><Var v={variacion(c.venta, iCliY.get(c.clave) ?? 0)} /></td>
                    <td className={s.r}>{num(c.documentos)}</td>
                    <td className={s.r}>{fecha(u)}</td>
                    <td className={s.r}>{dias == null ? '—' : num(dias)}</td>
                    <td><EstadoCliente dias={dias} /></td>
                  </tr>
                );
              })}
              {!g.length && <tr><td colSpan={12} className={s.dim}>Sin clientes con los filtros actuales.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className={s.note}>Estado según días sin compra al corte: <b>Activo</b> ≤ 45 · <b>En riesgo</b> 46–90 · <b>Inactivo</b> &gt; 90.</p>
      </>
    );
  }

  const facturasDe = (filas: Fila[]) => {
    const m = new Map<string, { f: string; d: number | null; oc: string; v: string; cn: string; lineas: number; q: number; val: number; t: 'F' | 'N' }>();
    for (const r of filas) {
      const k = `${r.t}-${r.d ?? r.f}`;
      const cur = m.get(k) ?? { f: r.f, d: r.d, oc: r.oc, v: r.v, cn: r.cn, lineas: 0, q: 0, val: 0, t: r.t };
      cur.lineas += 1;
      cur.q += r.q;
      cur.val += r.val;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => (a.f === b.f ? (b.d ?? 0) - (a.d ?? 0) : a.f < b.f ? 1 : -1));
  };

  const tablaFacturas = (filas: Fila[], conCliente: boolean) => {
    const facs = facturasDe(filas);
    return (
      <div className={s.tw} style={{ maxHeight: 420 }}>
        <table className={s.t}>
          <thead>
            <tr>
              <th>Fecha</th><th>Tipo</th><th>Documento</th><th>Pedido</th>{conCliente ? <th>Cliente</th> : <th>Vendedor</th>}
              <th className={s.r}>Líneas</th><th className={s.r}>Unidades</th><th className={s.r}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {facs.map((x) => (
              <tr key={`${x.t}-${x.d}-${x.f}`}>
                <td>{fecha(x.f)}</td>
                <td><span className={cx(s.tipo, x.t === 'N' && s.tipoN)}>{x.t === 'N' ? 'Nota crédito' : 'Factura'}</span></td>
                <td>{x.d ?? '—'}</td>
                <td>{x.oc ? <button type='button' className={s.lnk} onClick={() => abrirPedido(x.oc)}>{x.oc}</button> : '—'}</td>
                <td>{conCliente ? x.cn : x.v}</td>
                <td className={s.r}>{num(x.lineas)}</td>
                <td className={s.r}>{num(x.q)}</td>
                <td className={s.r}>{money(x.val)}</td>
              </tr>
            ))}
            {!facs.length && <tr><td colSpan={8} className={s.dim}>Sin documentos en el periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  const buscador = (placeholder: string, items: Array<{ key: string; t: string; d: string }>, onPick: (k: string) => void) => {
    const q = busq.trim().toLowerCase();
    const res = q.length >= 2 ? items.filter((i) => `${i.t} ${i.d}`.toLowerCase().includes(q)).slice(0, 12) : [];
    return (
      <div className={s.search}>
        <input type='search' placeholder={placeholder} value={busq} onChange={(e) => setBusq(e.currentTarget.value)} autoComplete='off' />
        {q.length >= 2 && (
          <div className={s.sres}>
            {res.map((i) => (
              <button key={i.key} type='button' className={s.sr} onClick={() => { onPick(i.key); setBusq(''); }}>
                <b>{i.t}</b><span>{i.d}</span>
              </button>
            ))}
            {!res.length && <div className={s.empty}>Sin coincidencias.</div>}
          </div>
        )}
      </div>
    );
  };

  const fichaHeader = (eyebrow: string, titulo: string, sub: string) => (
    <div className={s.ficha}>
      <div>
        <p className={s.eyebrow2}>{eyebrow}</p>
        <h2>{titulo}</h2>
        <p>{sub}</p>
      </div>
      <button type='button' className={s.fichaBtn} onClick={() => setFicha(null)}>← Volver al listado</button>
    </div>
  );

  const pClientes = () => {
    if (ficha?.tipo === 'cliente') {
      const cc = ficha.clave;
      const filas = fA.filter((r) => r.cc === cc);
      const t = totales(filas);
      const info = catClientes.find((c) => c.cc === cc);
      const prev = iCliP.get(cc) ?? 0;
      const anio = iCliY.get(cc) ?? 0;
      const prods = agrupar(filas, porProducto, med);
      const u = ultimaCompra.get(cc) ?? null;
      return (
        <>
          {fichaHeader('Ficha del cliente', info?.cn ?? cc, `Código ${cc} · NIT ${info?.nit || '—'} · Vendedor ${vendedorDe.get(cc) ?? '—'}`)}
          <div className={s.kpis}>
            <Kpi label='Venta del periodo' value={mm(t.neta)} sub={money(t.neta)} tone='a' />
            <Kpi label='Vs. mes anterior' value={<Var v={variacion(t.neta, prev)} />} sub={mm(prev)} tone='b' />
            <Kpi label='Vs. año anterior' value={<Var v={variacion(t.neta, anio)} />} sub={mm(anio)} tone='b' />
            <Kpi label='Última compra' value={fecha(u)} sub={u && data ? `${num(Math.max(0, diasEntre(u, data.corte)))} días al corte` : '—'} />
            <Kpi label='Promedio por factura' value={mm(t.facturas ? t.bruta / t.facturas : 0)} sub={`${num(t.facturas)} facturas`} />
            <Kpi label='Margen' value={mm(t.margen)} sub={t.neta ? pct(t.margen / t.neta, false) : '—'} />
          </div>
          <h2 className={s.h2}>Productos adquiridos en el periodo</h2>
          <div className={s.tw}>
            <table className={s.t}>
              <thead><tr><th>Código</th><th>Producto</th><th>Línea terapéutica</th><th className={s.r}>Unidades</th><th className={s.r}>Venta</th><th className={s.r}>Part.</th><th className={s.r}>Facturas</th><th className={s.r}>Última compra</th></tr></thead>
              <tbody>
                {prods.map((p) => (
                  <tr key={p.clave}>
                    <td className={s.dim}>{p.clave}</td>
                    <td><button type='button' className={s.lnk} onClick={() => abrirProducto(p.clave)}>{p.nombre}</button></td>
                    <td>{filas.find((r) => r.pc === p.clave)?.lt ?? '—'}</td>
                    <td className={s.r}>{num(p.unidades)}</td>
                    <td className={s.r}>{money(p.venta)}</td>
                    <td className={s.r}>{pct(p.participacion, false)}</td>
                    <td className={s.r}>{num(p.documentos)}</td>
                    <td className={s.r}>{fecha(p.ultima)}</td>
                  </tr>
                ))}
                {!prods.length && <tr><td colSpan={8} className={s.dim}>Sin compras en el periodo.</td></tr>}
              </tbody>
            </table>
          </div>
          <h2 className={s.h2}>Pedidos y facturas del periodo</h2>
          {tablaFacturas(filas, false)}
        </>
      );
    }
    return (
      <>
        {buscador('Buscar cliente por nombre, NIT o código', catClientes.map((c) => ({ key: c.cc, t: c.cn, d: `Código ${c.cc} · NIT ${c.nit || '—'}` })), abrirCliente)}
        {!focus && <p className={s.lead}>{num(gCli.filter((c) => c.venta > 0).length)} clientes con compra en el periodo. Clic en un cliente para ver su ficha.</p>}
        {tablaClientes('Clientes_venta', gCli)}
      </>
    );
  };

  const pProductos = () => {
    if (ficha?.tipo === 'producto') {
      const pc = ficha.clave;
      const filas = fA.filter((r) => r.pc === pc);
      const t = totales(filas);
      const anio = iProY.get(pc) ?? 0;
      const nombre = filas[0]?.pn ?? fY.find((r) => r.pc === pc)?.pn ?? pc;
      const clientes = agrupar(filas, porCliente, med);
      const movs = [...filas].sort((a, b) => (a.f < b.f ? 1 : -1)).slice(0, 100);
      return (
        <>
          {fichaHeader('Ficha del producto', nombre, `Código ${pc} · Línea terapéutica ${filas[0]?.lt ?? '—'}`)}
          <div className={s.kpis}>
            <Kpi label='Venta del periodo' value={mm(t.neta)} sub={money(t.neta)} tone='a' />
            <Kpi label='Unidades' value={num(t.unidades)} />
            <Kpi label='Precio promedio' value={money(t.unidades ? t.neta / t.unidades : 0)} sub='Venta neta ÷ unidades' />
            <Kpi label='Clientes que compraron' value={num(t.clientes)} />
            <Kpi label='Vs. año anterior' value={<Var v={variacion(t.neta, anio)} />} sub={mm(anio)} tone='b' />
            <Kpi label='Margen' value={mm(t.margen)} sub={t.neta ? pct(t.margen / t.neta, false) : '—'} />
          </div>
          <div className={cx(s.grid, s.three)}>
            <Card title='Por vendedor'><HBars items={bars(agrupar(filas, porVendedor, med))} onPick={abrirVendedor} /></Card>
            <Card title='Por ciudad'><HBars items={bars(agrupar(filas, porCiudad, med))} /></Card>
            <Card title='Por canal' note='Pendiente de fuente (canal no viene en SAP).'><div className={s.empty}>—</div></Card>
          </div>
          <h2 className={s.h2}>Clientes que compraron el producto</h2>
          <div className={s.tw}>
            <table className={s.t}>
              <thead><tr><th>Cliente</th><th>Vendedor</th><th className={s.r}>Unidades</th><th className={s.r}>Venta</th><th className={s.r}>Part.</th><th className={s.r}>Última compra</th></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.clave}>
                    <td><button type='button' className={s.lnk} onClick={() => abrirCliente(c.clave)}>{c.nombre}</button></td>
                    <td>{vendedorDe.get(c.clave) ?? '—'}</td>
                    <td className={s.r}>{num(c.unidades)}</td>
                    <td className={s.r}>{money(c.venta)}</td>
                    <td className={s.r}>{pct(c.participacion, false)}</td>
                    <td className={s.r}>{fecha(c.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className={s.h2}>Últimos movimientos</h2>
          <div className={s.tw}>
            <table className={s.t}>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>Pedido</th><th>Cliente</th><th className={s.r}>Unidades</th><th className={s.r}>Valor</th></tr></thead>
              <tbody>
                {movs.map((r, i) => (
                  <tr key={`${r.d}-${i}`}>
                    <td>{fecha(r.f)}</td>
                    <td><span className={cx(s.tipo, r.t === 'N' && s.tipoN)}>{r.t === 'N' ? 'Nota crédito' : 'Factura'}</span></td>
                    <td>{r.d ?? '—'}</td>
                    <td>{r.oc || '—'}</td>
                    <td>{r.cn}</td>
                    <td className={s.r}>{num(r.q)}</td>
                    <td className={s.r}>{money(r.val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }
    return (
      <>
        {buscador('Buscar producto por código o descripción', gPro.map((p) => ({ key: p.clave, t: p.nombre, d: `Código ${p.clave}` })), abrirProducto)}
        {!focus && <p className={s.lead}>{num(gPro.length)} productos con movimiento en el periodo. Clic en un producto para ver su ficha.</p>}
        <div className={s.h2row}>
          <h2 className={s.h2}>Ventas por producto</h2>
          <button
            className={cx(s.btn, s.btnSm, s.btnSolid)}
            type='button'
            onClick={() =>
              descargarCsv('Ventas_por_producto', ['Código', 'Producto', 'Unidades', 'Venta', 'Participación', 'Precio promedio', 'Clientes', 'Año anterior'], gPro.map((p) => [
                p.clave, p.nombre, Math.round(p.unidades), Math.round(p.venta), (p.participacion * 100).toFixed(1),
                p.unidades ? Math.round(p.venta / p.unidades) : '', p.clientes, Math.round(iProY.get(p.clave) ?? 0),
              ]))
            }
          >
            Descargar tabla
          </button>
        </div>
        <div className={s.tw}>
          <table className={s.t}>
            <thead><tr><th>Código</th><th>Producto</th><th>Línea terapéutica</th><th className={s.r}>Unidades</th><th className={s.r}>Venta</th><th className={s.r}>Part.</th><th className={s.r}>Precio prom.</th><th className={s.r}>Clientes</th><th className={s.r}>Margen %</th><th className={s.r}>Vs. año ant.</th></tr></thead>
            <tbody>
              {gPro.map((p) => (
                <tr key={p.clave}>
                  <td className={s.dim}>{p.clave}</td>
                  <td><button type='button' className={s.lnk} onClick={() => abrirProducto(p.clave)}>{p.nombre}</button></td>
                  <td>{fA.find((r) => r.pc === p.clave)?.lt ?? '—'}</td>
                  <td className={s.r}>{num(p.unidades)}</td>
                  <td className={s.r}>{money(p.venta)}</td>
                  <td className={s.r}>{pct(p.participacion, false)}</td>
                  <td className={s.r}>{p.unidades ? money(p.venta / p.unidades) : '—'}</td>
                  <td className={s.r}>{num(p.clientes)}</td>
                  <td className={s.r}>{p.venta > 0 ? pct((p.venta - p.costo) / p.venta, false) : '—'}</td>
                  <td className={s.r}><Var v={variacion(p.venta, iProY.get(p.clave) ?? 0)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const pVendedores = () => {
    if (ficha?.tipo === 'vendedor') {
      const v = ficha.clave;
      const filas = fA.filter((r) => r.v === v);
      const t = totales(filas);
      const prev = iVenP.get(v) ?? 0;
      const anio = iVenY.get(v) ?? 0;
      const clientes = agrupar(filas, porCliente, med);
      const oport = porRecuperar(filas, fP.filter((r) => r.v === v));
      return (
        <>
          {fichaHeader('Ficha del vendedor', v, `${num(t.clientes)} clientes atendidos · ${num(t.facturas)} facturas en el periodo`)}
          <div className={s.kpis}>
            <Kpi label='Venta del periodo' value={mm(t.neta)} sub={money(t.neta)} tone='a' />
            <Kpi label='Meta del periodo' value='—' sub='Pendiente: cargar el presupuesto' />
            <Kpi label='Vs. mes anterior' value={<Var v={variacion(t.neta, prev)} />} sub={mm(prev)} tone='b' />
            <Kpi label='Vs. año anterior' value={<Var v={variacion(t.neta, anio)} />} sub={mm(anio)} tone='b' />
            <Kpi label='Clientes atendidos' value={num(t.clientes)} />
            <Kpi label='Productos vendidos' value={num(new Set(filas.map((r) => r.pc)).size)} />
          </div>
          <Card title='Oportunidades de gestión' note='Clientes de este vendedor que compraron el mes anterior y no han comprado en este mes.'>
            <div className={s.tw} style={{ maxHeight: 360, boxShadow: 'none' }}>
              <table className={s.t}>
                <thead><tr><th>Cliente</th><th className={s.r}>Compra mes anterior</th><th className={s.r}>Última compra</th><th className={s.r}>Días sin compra</th></tr></thead>
                <tbody>
                  {oport.map((g) => {
                    const u = ultimaCompra.get(g.clave);
                    return (
                      <tr key={g.clave}>
                        <td><button type='button' className={s.lnk} onClick={() => abrirCliente(g.clave)}>{g.nombre}</button></td>
                        <td className={s.r}>{money(g.venta)}</td>
                        <td className={s.r}>{fecha(u)}</td>
                        <td className={s.r}>{u && data ? num(diasEntre(u, data.corte)) : '—'}</td>
                      </tr>
                    );
                  })}
                  {!oport.length && <tr><td colSpan={4} className={s.dim}>Sin clientes pendientes.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <h2 className={s.h2}>Clientes atendidos en el periodo</h2>
          <div className={s.tw}>
            <table className={s.t}>
              <thead><tr><th>Cliente</th><th className={s.r}>Venta</th><th className={s.r}>Part.</th><th className={s.r}>Vs. año ant.</th><th className={s.r}>Facturas</th><th className={s.r}>Última compra</th></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.clave}>
                    <td><button type='button' className={s.lnk} onClick={() => abrirCliente(c.clave)}>{c.nombre}</button></td>
                    <td className={s.r}>{money(c.venta)}</td>
                    <td className={s.r}>{pct(c.participacion, false)}</td>
                    <td className={s.r}><Var v={variacion(c.venta, iCliY.get(c.clave) ?? 0)} /></td>
                    <td className={s.r}>{num(c.documentos)}</td>
                    <td className={s.r}>{fecha(c.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.grid}>
            <Card title='Productos más vendidos'><HBars items={bars(agrupar(filas, porProducto, med))} onPick={abrirProducto} /></Card>
            <Card title='Últimas facturas'>{tablaFacturas(filas.filter((r) => r.t === 'F'), true)}</Card>
          </div>
        </>
      );
    }
    return (
      <>
        {!focus && <p className={s.lead}>{num(gVen.length)} vendedores con venta en el periodo. Clic en un vendedor para ver su ficha.</p>}
        {tablaVendedores('Ventas_por_vendedor', false)}
      </>
    );
  };

  const pPedidos = () => {
    if (ficha?.tipo === 'pedido') {
      const oc = ficha.clave;
      const filas = (data ? [...data.filas, ...data.filasAnterior] : []).filter((r) => r.oc === oc);
      const t = totales(filas);
      const fechas = filas.map((r) => r.f).sort();
      const facs = [...new Set(filas.map((r) => r.d).filter((d): d is number => d != null))];
      return (
        <>
          {fichaHeader('Pedido', `Orden de compra ${oc}`, `${num(filas.length)} líneas · ${num(facs.length)} documento(s)`)}
          <div className={s.kpis}>
            <Kpi label='Cliente' value={<span style={{ fontSize: 15 }}>{filas[0]?.cn ?? '—'}</span>} sub={`NIT ${filas[0]?.nit || '—'}`} />
            <Kpi label='Vendedor' value={<span style={{ fontSize: 15 }}>{filas[0]?.v ?? '—'}</span>} sub={filas[0]?.ciu ?? ''} />
            <Kpi label='Fechas de facturación' value={<span style={{ fontSize: 15 }}>{fecha(fechas[0])} – {fecha(fechas[fechas.length - 1])}</span>} sub='Primera y última' />
            <Kpi label='Valor facturado' value={mm(t.neta)} sub={money(t.neta)} tone='a' />
            <Kpi label='Documentos asociados' value={<span style={{ fontSize: 15 }}>{facs.join(', ') || '—'}</span>} />
          </div>
          <h2 className={s.h2}>Composición</h2>
          <div className={s.tw}>
            <table className={s.t}>
              <thead><tr><th>Código</th><th>Descripción</th><th>Tipo</th><th>Documento</th><th>Fecha</th><th className={s.r}>Unidades</th><th className={s.r}>Valor</th></tr></thead>
              <tbody>
                {filas.map((r, i) => (
                  <tr key={`${r.d}-${r.pc}-${i}`}>
                    <td className={s.dim}>{r.pc}</td>
                    <td><button type='button' className={s.lnk} onClick={() => abrirProducto(r.pc)}>{r.pn}</button></td>
                    <td><span className={cx(s.tipo, r.t === 'N' && s.tipoN)}>{r.t === 'N' ? 'Nota crédito' : 'Factura'}</span></td>
                    <td>{r.d ?? '—'}</td>
                    <td>{fecha(r.f)}</td>
                    <td className={s.r}>{num(r.q)}</td>
                    <td className={s.r}>{money(r.val)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Total</td><td className={s.r}>{num(t.unidades)}</td><td className={s.r}>{money(t.neta)}</td></tr>
              </tfoot>
            </table>
          </div>
        </>
      );
    }
    const items = listaPedidos.map((p) => ({ key: p.oc, t: `Pedido ${p.oc}`, d: `${p.cliente} · facturas ${p.facturas.join(', ')}` }));
    return (
      <>
        {buscador('Buscar por número de pedido, número de factura o cliente', items, abrirPedido)}
        {!focus && <p className={s.lead}>Busque un pedido o una factura para ver su composición: cliente, vendedor, productos, unidades y valores facturados.</p>}
        <Card title='Pedidos facturados más recientes' note='Con los filtros aplicados. Clic para ver el pedido.'>
          <div className={s.tw} style={{ maxHeight: 520, boxShadow: 'none' }}>
            <table className={s.t}>
              <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th className={s.r}>Facturas</th><th className={s.r}>Líneas</th><th className={s.r}>Valor</th></tr></thead>
              <tbody>
                {listaPedidos.slice(0, 200).map((p) => (
                  <tr key={p.oc}>
                    <td><button type='button' className={s.lnk} onClick={() => abrirPedido(p.oc)}>{p.oc}</button></td>
                    <td>{fecha(p.ultima)}</td>
                    <td>{p.cliente}</td>
                    <td>{p.vendedor}</td>
                    <td className={s.r}>{num(p.facturas.length)}</td>
                    <td className={s.r}>{num(p.lineas)}</td>
                    <td className={s.r}>{money(p.valor)}</td>
                  </tr>
                ))}
                {!listaPedidos.length && <tr><td colSpan={7} className={s.dim}>Sin pedidos con orden de compra en el periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  };

  const detalleFilas = useMemo(() => {
    const q = dtQ.trim().toLowerCase();
    const base = fA.filter((r) => incluye(r, med));
    const filtradas = q
      ? base.filter((r) => `${r.cn} ${r.nit} ${r.d ?? ''} ${r.oc} ${r.pc} ${r.pn} ${r.v}`.toLowerCase().includes(q))
      : base;
    const { k, dir } = dtOrden;
    return [...filtradas].sort((a, b) => {
      const va = a[k] ?? '';
      const vb = b[k] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }, [fA, med, dtQ, dtOrden]);

  const pDetalle = () => {
    const t = totales(detalleFilas);
    const paginas = Math.max(1, Math.ceil(detalleFilas.length / dtPs));
    const pg = Math.min(dtPg, paginas - 1);
    const vista = detalleFilas.slice(pg * dtPs, pg * dtPs + dtPs);
    const th = (k: Orden, label: string, right = false) => (
      <th
        className={cx(s.sortable, right && s.r)}
        onClick={() => setDtOrden((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))}
      >
        {label}{dtOrden.k === k ? (dtOrden.dir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    );
    return (
      <>
        {!focus && (
          <Card title='Información disponible en esta consulta' note='Se consulta en pantalla, por páginas. Canal, segmento, regional y proveedor quedan pendientes de fuente.'>
            <div className={s.empty}>Fecha · Documento · Pedido · Código y producto · NIT y cliente · Vendedor · Unidades · Valor · Línea terapéutica · Ciudad · Tipo (venta / nota crédito)</div>
          </Card>
        )}
        <div className={s.bar}>
          <div className={s.search} style={{ flex: 1, minWidth: 260 }}>
            <input type='search' placeholder='Filtrar por cliente, NIT, documento, pedido, producto o vendedor' value={dtQ} onChange={(e) => { setDtQ(e.currentTarget.value); setDtPg(0); }} />
          </div>
          <label className={s.fld}>
            Filas por página
            <select value={dtPs} onChange={(e) => { setDtPs(Number(e.currentTarget.value)); setDtPg(0); }}>
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className={cx(s.kpis, s.kpisSm)}>
          <Kpi label='Registros' value={num(detalleFilas.length)} />
          <Kpi label='Venta bruta' value={mm(t.bruta)} sub='Líneas de factura' selected={med === 'bruta'} onClick={() => setMed('bruta')} />
          <Kpi label='Notas crédito' value={mm(Math.abs(t.notas))} tone='b' selected={med === 'notas'} onClick={() => setMed('notas')} />
          <Kpi label='Venta neta' value={mm(t.neta)} sub='Bruta menos notas crédito' tone='a' selected={med === 'neta'} onClick={() => setMed('neta')} />
          <Kpi label='Unidades' value={num(t.unidades)} />
        </div>
        <div className={cx(s.tw, s.nocopy)} style={{ maxHeight: 640 }}>
          <table className={s.t}>
            <thead>
              <tr>
                {th('f', 'Fecha')}{th('cn', 'Cliente')}{th('d', 'Documento')}{th('oc', 'Pedido')}<th>Código</th>{th('pn', 'Producto')}<th>NIT</th>
                {th('v', 'Vendedor')}{th('q', 'Unidades', true)}{th('val', 'Valor', true)}<th>Tipo</th><th>Línea terapéutica</th><th>Ciudad</th>
              </tr>
            </thead>
            <tbody>
              {vista.map((r, i) => (
                <tr key={`${r.d}-${r.pc}-${pg}-${i}`}>
                  <td>{fecha(r.f)}</td>
                  <td><button type='button' className={s.lnk} onClick={() => abrirCliente(r.cc)}>{r.cn}</button></td>
                  <td>{r.d ?? '—'}</td>
                  <td>{r.oc ? <button type='button' className={s.lnk} onClick={() => abrirPedido(r.oc)}>{r.oc}</button> : '—'}</td>
                  <td className={s.dim}>{r.pc}</td>
                  <td><button type='button' className={s.lnk} onClick={() => abrirProducto(r.pc)}>{r.pn}</button></td>
                  <td className={s.dim}>{r.nit}</td>
                  <td>{r.v}</td>
                  <td className={s.r}>{num(r.q)}</td>
                  <td className={s.r}>{money(valor(r, med))}</td>
                  <td><span className={cx(s.tipo, r.t === 'N' && s.tipoN)}>{r.t === 'N' ? 'Nota crédito' : 'Venta'}</span></td>
                  <td>{r.lt}</td>
                  <td>{r.ciu}</td>
                </tr>
              ))}
              {!vista.length && <tr><td colSpan={13} className={s.dim}>Sin registros con los filtros actuales.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className={s.pager}>
          <span>Página {pg + 1} de {paginas} · {num(detalleFilas.length)} registros</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type='button' disabled={pg === 0} onClick={() => setDtPg(0)}>«</button>
            <button type='button' disabled={pg === 0} onClick={() => setDtPg(pg - 1)}>‹</button>
            <button type='button' disabled={pg >= paginas - 1} onClick={() => setDtPg(pg + 1)}>›</button>
            <button type='button' disabled={pg >= paginas - 1} onClick={() => setDtPg(paginas - 1)}>»</button>
          </div>
        </div>
        <p className={s.note}>Respeta los filtros de la barra superior. Clic en un cliente, pedido o producto para abrir su ficha.</p>
      </>
    );
  };

  /* ---------------- Render ---------------- */
  if (sinAcceso) {
    return (
      <Alert color='yellow' title='Sin acceso' m='md'>
        No tiene acceso a este tablero. Solicite el permiso «Dashboard de gestión comercial» al administrador.
      </Alert>
    );
  }

  const enc = ENCABEZADO[pagina];
  const modulo = MENU.find((m) => m.key === pagina)?.label ?? '';
  const cliSel = filtros.cliente ? catClientes.find((c) => c.cc === filtros.cliente) : null;
  const cliRes = cliQ.trim().length >= 2
    ? catClientes.filter((c) => `${c.cn} ${c.nit} ${c.cc}`.toLowerCase().includes(cliQ.trim().toLowerCase())).slice(0, 10)
    : [];

  return (
    <div className={cx(s.root, isDark && s.dark)}>
      {menu && <div className={s.scrim} onClick={() => setMenu(false)} />}
      {menu && (
        <nav className={s.side} aria-label='Menú del tablero'>
          <div className={s.sideH}>
            <span className={s.logo}><Icono name='chart' size={20} /></span>
            <div><b>Tablero Comercial</b><small>ONE LATAM PHARMA</small></div>
          </div>
          {MENU.map((m) => (
            <div key={m.key} style={{ display: 'contents' }}>
              {m.sep && <div className={s.miSep}>{m.sep}</div>}
              <button type='button' className={cx(s.mi, pagina === m.key && s.miOn)} onClick={() => ir(m.key)}>
                <span className={s.miI}><Icono name={m.icon} /></span>
                <span className={s.miN}>{m.label}</span>
                <span className={s.miD}>{m.desc}</span>
              </button>
            </div>
          ))}
          <div className={s.sideF}><Icono name='shield' size={15} />Datos en vivo de SAP (solo lectura)</div>
        </nav>
      )}

      <header className={s.top}>
        <button type='button' className={s.ib} onClick={() => setMenu(true)} aria-label='Abrir menú'><Icono name='menu' /></button>
        <div className={s.brand}>
          <span className={s.logo}><Icono name='chart' size={20} /></span>
          <div><p className={s.eyebrow}>ONE LATAM PHARMA</p><h1 className={s.title}>Tablero Comercial</h1></div>
        </div>
        <div className={s.topMod}><i />{modulo}</div>
        <div className={s.meta}>
          {empresas && empresas.length > 1 && (
            <select
              value={companyId ?? ''}
              onChange={(e) => { setCompanyId(e.currentTarget.value); setFiltros(FILTROS_VACIOS); }}
              style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 8, padding: '4px 8px' }}
            >
              {empresas.map((e) => <option key={e.id} value={String(e.id)} style={{ color: '#000' }}>{e.nombre}</option>)}
            </select>
          )}
          <span>Corte <b>{fecha(data?.corte)}</b></span>
          <span>Actualizado <b>{data ? new Date(data.actualizado).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : '—'}</b></span>
        </div>
        <div className={s.topActs}>
          <button type='button' className={cx(s.ib, insOn && s.ibOn)} onClick={() => setInsOn((v) => !v)} aria-pressed={insOn}>
            <Icono name='spark' /><span>Insights</span><span className={s.cnt}>{hallazgos.length}</span>
          </button>
          <button type='button' className={cx(s.ib, focus && s.ibOn)} onClick={() => setFocus((v) => !v)} aria-pressed={focus}>
            <Icono name='focus' /><span>Enfoque</span>
          </button>
        </div>
      </header>

      {empresas === null || (loading && !data) ? (
        <div className={s.loading}><Loader size='md' /><div>Cargando información de SAP…</div></div>
      ) : empresas.length === 0 ? (
        <div className={s.loading}>No hay empresas disponibles para este tablero.</div>
      ) : (
        <div className={cx(s.shell, (!insOn || focus) && s.shellFull)}>
          <main className={s.main}>
            <div className={s.gbar}>
              <label className={s.fld}>
                Vendedor
                <select value={filtros.vendedor ?? ''} onChange={(e) => setF('vendedor', e.currentTarget.value)}>
                  <option value=''>Todos</option>
                  {opVendedores.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className={s.fld}>
                Línea terapéutica
                <select value={filtros.linea ?? ''} onChange={(e) => setF('linea', e.currentTarget.value)}>
                  <option value=''>Todas</option>
                  {opLineas.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className={s.fld}>
                Ciudad
                <select value={filtros.ciudad ?? ''} onChange={(e) => setF('ciudad', e.currentTarget.value)}>
                  <option value=''>Todas</option>
                  {opCiudades.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <div className={s.fld} style={{ position: 'relative' }}>
                <span>Cliente</span>
                {cliSel ? (
                  <button type='button' className={cx(s.btn, s.btnSm)} onClick={() => setF('cliente', null)} title='Quitar cliente'>
                    {cliSel.cn.slice(0, 28)} ×
                  </button>
                ) : (
                  <input type='search' placeholder='Nombre o NIT' value={cliQ} onChange={(e) => setCliQ(e.currentTarget.value)} autoComplete='off' />
                )}
                {!cliSel && cliRes.length > 0 && (
                  <div className={s.sres} style={{ width: 'min(420px, 90vw)' }}>
                    {cliRes.map((c) => (
                      <button key={c.cc} type='button' className={s.sr} onClick={() => { setF('cliente', c.cc); setCliQ(''); }}>
                        <b>{c.cn}</b><span>NIT {c.nit || '—'} · {c.cc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className={s.fld}>
                <span>Tipo de venta</span>
                <span className={s.segbtns}>
                  <button type='button' className={med === 'neta' ? s.segOn : undefined} onClick={() => setMed('neta')}>Neta</button>
                  <button type='button' className={med === 'bruta' ? s.segOn : undefined} onClick={() => setMed('bruta')}>Bruta</button>
                  <button type='button' className={med === 'notas' ? s.segOnN : undefined} onClick={() => setMed('notas')}>Solo notas</button>
                </span>
              </span>
              <span className={s.gsp} />
              {hayFiltros && (
                <button type='button' className={s.btn} onClick={() => { setFiltros(FILTROS_VACIOS); setMed('neta'); }}>
                  Limpiar filtros
                </button>
              )}
            </div>

            <div className={s.ph}>
              <div>
                <p className={s.eyebrow3}>{enc.e}</p>
                <h2>{enc.t}</h2>
                {!focus && <p>{enc.d}</p>}
              </div>
              {data && (
                <span className={s.pill}>
                  <Icono name='cal' size={15} />
                  {fecha(data.actual.desde)} – {fecha(data.actual.hasta)}
                </span>
              )}
            </div>

            {error && <Alert color='red' title='No se pudo cargar'>{error}</Alert>}
            {data?.avisos.map((a) => <div key={a} className={s.aviso}>{a}</div>)}
            {loading && data && <div className={s.note}>Actualizando…</div>}

            {data && (
              <section className={s.page} key={`${pagina}-${ficha?.clave ?? ''}`}>
                {pagina === 'diario' && pDiario()}
                {pagina === 'resumen' && pResumen()}
                {pagina === 'cierre' && pCierre()}
                {pagina === 'clientes' && pClientes()}
                {pagina === 'productos' && pProductos()}
                {pagina === 'vendedores' && pVendedores()}
                {pagina === 'pedidos' && pPedidos()}
                {pagina === 'detalle' && pDetalle()}
              </section>
            )}
          </main>

          {insOn && !focus && (
            <aside className={s.ins}>
              <div className={s.insIn}>
                <div className={s.insH}><h4>Insights y alertas</h4><span className={s.cnt}>{hallazgos.length}</span></div>
                {hallazgos.map((h) => (
                  <div key={h.titulo} className={cx(s.insItem, h.tono === 'warn' && s.insWarn, h.tono === 'crit' && s.insCrit, h.tono === 'info' && s.insInfo)}>
                    <b>{h.titulo}</b>
                    <p>{h.texto}</p>
                  </div>
                ))}
                {!hallazgos.length && <div className={s.empty}>Sin hallazgos con los filtros actuales.</div>}
                <div className={cx(s.insItem, s.insWarn)}>
                  <b>Pendiente de fuente</b>
                  <p>Meta / presupuesto, canal, segmento, regional y proveedor no vienen en SAP. Se activan cuando se defina su origen.</p>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      <div className={s.cert}>
        <Icono name='shield' size={20} />
        <div>
          <b>Fuente: SAP Business One · vista OLP_IND_VentasB1SLQuery</b>
          <p>
            Venta neta = líneas de factura menos notas crédito, sin IVA. Comparativos al mismo corte del mes anterior y del año anterior.
            Proyección = promedio por día hábil × días hábiles del mes. Cifras en pesos colombianos; fechas en hora de Colombia.
          </p>
        </div>
      </div>
    </div>
  );
}
