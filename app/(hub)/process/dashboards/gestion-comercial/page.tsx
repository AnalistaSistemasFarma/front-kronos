'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconCalendarStats,
  IconCash,
  IconChartBar,
  IconFlag,
  IconReceipt2,
  IconReportAnalytics,
  IconTable,
  IconTrendingDown,
  IconTrendingUp,
  IconTruck,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import type { ChartData, ChartOptions } from 'chart.js';
import { ChartBox } from '../../../../../components/charts/ChartBox';
import DashboardPageShell from '../../../../../components/dashboard/DashboardPageShell';
import { KpiStatCard, RankedListCard } from '../../../../../components/dashboard/actividades/ActividadesUi';
import { useDashboardChartPalette } from '../../../../../components/dashboard/useDashboardChartPalette';
import { hoyBogota, type GestionComercialResultado } from '../../../../../lib/dashboards/gestion-comercial/calculo';
import type { LineasResultado } from '../../../../../lib/dashboards/gestion-comercial/lineas';
import type { EmpresaGestionComercial } from '../../../../../lib/dashboards/gestion-comercial/access';

/** Resultado de la API: base (etapa 1) + bloque de líneas (etapa 2, puede venir null). */
type GestionComercialApi = GestionComercialResultado & { lineas: LineasResultado | null };

/**
 * Dashboard de gestión comercial (etapa 1): estructura visual y funcional,
 * organizada en las secciones del tablero de referencia (seguimiento diario,
 * resumen, cierre, clientes, vendedores, productos, pedidos y detalle), con los
 * datos agregados en vivo desde SAP. Consume /api/dashboards/gestion-comercial.
 * Solo lectura. Acceso: subproceso «Dashboard de gestión comercial» por empresa.
 *
 * Etapa 2: las secciones de productos, pedidos y detalle se alimentan del
 * desglose por línea de la vista OLP_IND_VentasB1SLQuery (líneas de facturas y
 * notas crédito del mes del corte), con venta neta, unidades y margen. Lo que
 * aún queda fuera (presupuesto, fletes) depende de maestros externos a SAP.
 */

const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);
const moneyShort = (v: number) => {
  const millones = v / 1_000_000;
  if (Math.abs(millones) >= 1000) return `$ ${(millones / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MM`;
  return `$ ${millones.toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
};
const pct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;
const num = (v: number) => v.toLocaleString('es-CO');

const COLOR_SUBE = 'var(--mantine-color-teal-6)';
const COLOR_BAJA = 'var(--mantine-color-red-6)';

export default function DashboardGestionComercialPage() {
  const { palette, isDark } = useDashboardChartPalette();
  const [empresas, setEmpresas] = useState<EmpresaGestionComercial[] | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [corte, setCorte] = useState(hoyBogota());
  const [data, setData] = useState<GestionComercialApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId, corte });
      const r = await fetch(`/api/dashboards/gestion-comercial?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo cargar el dashboard');
      setData(d as GestionComercialApi);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, corte]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const colorActual = palette.blue600;
  const colorAnterior = isDark ? '#b69cff' : '#946fef';
  const variacionPositiva = (data?.kpis.variacion ?? 0) >= 0;

  // Serie acumulada: mes actual vs. mes anterior (al mismo corte)
  const chartAcumulado = useMemo<ChartData<'line'> | null>(() => {
    if (!data) return null;
    return {
      labels: data.dias.map((d) => `Día ${d.dia}`),
      datasets: [
        {
          label: 'Acumulado del mes',
          data: data.dias.map((d) => d.acumActual),
          borderColor: colorActual,
          backgroundColor: `${colorActual}22`,
          fill: true,
          tension: 0.25,
        },
        {
          label: 'Mes anterior',
          data: data.dias.map((d) => d.acumAnterior ?? null),
          borderColor: colorAnterior,
          backgroundColor: 'transparent',
          borderDash: [6, 4],
          tension: 0.25,
        },
      ],
    };
  }, [data, colorActual, colorAnterior]);

  // Venta diaria (barras): mes actual vs. mes anterior
  const chartDiario = useMemo<ChartData<'bar'> | null>(() => {
    if (!data) return null;
    return {
      labels: data.dias.map((d) => `Día ${d.dia}`),
      datasets: [
        { label: 'Mes actual', data: data.dias.map((d) => d.actual), backgroundColor: colorActual, borderRadius: 4 },
        { label: 'Mes anterior', data: data.dias.map((d) => d.anterior ?? 0), backgroundColor: colorAnterior, borderRadius: 4 },
      ],
    };
  }, [data, colorActual, colorAnterior]);

  const lineOptions: ChartOptions<'line'> = { plugins: { legend: { position: 'top' } } };
  const barOptions: ChartOptions<'bar'> = { plugins: { legend: { position: 'top' } } };

  const toolbar = (
    <Group align='flex-end' gap='md' wrap='wrap'>
      {empresas && empresas.length > 1 && (
        <Select
          label='Empresa'
          data={empresas.map((e) => ({ value: String(e.id), label: e.nombre }))}
          value={companyId}
          onChange={(v) => v && setCompanyId(v)}
          allowDeselect={false}
          w={220}
        />
      )}
      <TextInput label='Fecha de corte' type='date' value={corte} max={hoyBogota()} onChange={(e) => setCorte(e.currentTarget.value)} />
    </Group>
  );

  const avanceProy = data && data.kpis.proyeccionCierre > 0 ? data.kpis.ventaNeta / data.kpis.proyeccionCierre : null;

  return (
    <DashboardPageShell
      title='Dashboard de gestión comercial'
      description='Seguimiento diario, resumen, cierre, clientes, vendedores, productos, pedidos y detalle de la operación comercial, en vivo desde SAP. Replica la estructura del tablero comercial de BI.'
      toolbar={empresas && empresas.length > 0 ? toolbar : undefined}
    >
      {empresas === null && <Group justify='center' py='xl'><Loader /></Group>}

      {sinAcceso && (
        <Alert color='yellow' title='Sin acceso'>
          No tiene acceso a este tablero. Solicite el permiso «Dashboard de gestión comercial» al administrador.
        </Alert>
      )}

      {error && <Alert color='red' title='No se pudo cargar'>{error}</Alert>}

      {loading && !data && <Group justify='center' py='xl'><Loader /></Group>}

      {data && (
        <Tabs defaultValue='diario' keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value='diario' leftSection={<IconReportAnalytics size={16} />}>Seguimiento diario</Tabs.Tab>
            <Tabs.Tab value='resumen' leftSection={<IconChartBar size={16} />}>Resumen comercial</Tabs.Tab>
            <Tabs.Tab value='cierre' leftSection={<IconFlag size={16} />}>Cierre mensual</Tabs.Tab>
            <Tabs.Tab value='clientes' leftSection={<IconUsers size={16} />}>Clientes</Tabs.Tab>
            <Tabs.Tab value='vendedores' leftSection={<IconUser size={16} />}>Vendedores</Tabs.Tab>
            <Tabs.Tab value='productos' leftSection={<IconReceipt2 size={16} />}>Productos</Tabs.Tab>
            <Tabs.Tab value='pedidos' leftSection={<IconTruck size={16} />}>Pedidos</Tabs.Tab>
            <Tabs.Tab value='detalle' leftSection={<IconTable size={16} />}>Detalle de ventas</Tabs.Tab>
          </Tabs.List>

          {/* ---------- SEGUIMIENTO DIARIO ---------- */}
          <Tabs.Panel value='diario' pt='md'>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb='md'>
              <KpiStatCard label='Venta neta acumulada' value={moneyShort(data.kpis.ventaNeta)} hint={money(data.kpis.ventaNeta)} color={colorActual} icon={IconCash} refreshing={loading} />
              <KpiStatCard label='Proyección de cierre' value={moneyShort(data.kpis.proyeccionCierre)} hint={`Avance ${pct(avanceProy)} · prom. día hábil ${moneyShort(data.kpis.promedioDiaHabil)}`} color={colorAnterior} icon={IconTrendingUp} refreshing={loading} />
              <KpiStatCard label='Vs. mes anterior (mismo corte)' value={pct(data.kpis.variacion)} hint={`${data.kpis.diferencia >= 0 ? '▲' : '▼'} ${money(Math.abs(data.kpis.diferencia))}`} color={variacionPositiva ? COLOR_SUBE : COLOR_BAJA} icon={variacionPositiva ? IconTrendingUp : IconTrendingDown} refreshing={loading} />
              <KpiStatCard label='Venta del último día' value={moneyShort(data.kpis.ventaUltimoDia)} hint={`${data.kpis.diasConVenta} día(s) con facturación`} color={colorActual} icon={IconCalendarStats} refreshing={loading} />
              <KpiStatCard label='Facturas / clientes' value={`${num(data.kpis.facturas)} / ${num(data.kpis.clientes)}`} hint='Documentos y clientes con compra' color={colorActual} icon={IconReceipt2} refreshing={loading} />
              <KpiStatCard label='Días hábiles' value={`${data.kpis.diasHabilesTranscurridos} / ${data.kpis.diasHabilesMes}`} hint='Transcurridos del mes' color={colorAnterior} icon={IconCalendarStats} refreshing={loading} />
            </SimpleGrid>

            <Card shadow='sm' radius='md' withBorder p='lg' mb='md'>
              <Title order={3} fz={16} mb='sm'>Venta acumulada vs. mes anterior</Title>
              {chartAcumulado && <ChartBox type='line' data={chartAcumulado} height={300} entranceKey={`acum-${companyId}-${corte}`} options={lineOptions} />}
            </Card>

            <Card shadow='sm' radius='md' withBorder p='lg' mb='md'>
              <Title order={3} fz={16} mb='sm'>Venta diaria (actual vs. mes anterior)</Title>
              {chartDiario && <ChartBox type='bar' data={chartDiario} height={300} entranceKey={`dia-${companyId}-${corte}`} options={barOptions} />}
            </Card>

            <Card shadow='sm' radius='md' withBorder p={0}>
              <Table.ScrollContainer minWidth={700} mah={420}>
                <Table striped highlightOnHover stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Vendedor</Table.Th>
                      <Table.Th ta='right'>Venta neta</Table.Th>
                      <Table.Th ta='right'>Participación</Table.Th>
                      <Table.Th ta='right'>Clientes</Table.Th>
                      <Table.Th ta='right'>Facturas</Table.Th>
                      <Table.Th ta='right'>Última venta</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.vendedores.map((v) => (
                      <Table.Tr key={v.codigo}>
                        <Table.Td fw={500}>{v.nombre}</Table.Td>
                        <Table.Td ta='right'>{money(v.venta)}</Table.Td>
                        <Table.Td ta='right'>{pct(v.participacion)}</Table.Td>
                        <Table.Td ta='right'>{num(v.clientes)}</Table.Td>
                        <Table.Td ta='right'>{num(v.documentos)}</Table.Td>
                        <Table.Td ta='right'>{v.ultimaVenta ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          </Tabs.Panel>

          {/* ---------- RESUMEN COMERCIAL ---------- */}
          <Tabs.Panel value='resumen' pt='md'>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb='md'>
              <KpiStatCard label='Venta neta del periodo' value={moneyShort(data.kpis.ventaNeta)} hint={money(data.kpis.ventaNeta)} color={colorActual} icon={IconCash} refreshing={loading} />
              <KpiStatCard label='Venta bruta' value={moneyShort(data.kpis.ventaBruta)} hint='Facturas con valor positivo' color={colorActual} icon={IconReceipt2} refreshing={loading} />
              <KpiStatCard label='Notas crédito' value={moneyShort(data.kpis.notasCredito)} hint='Restadas de la venta neta' color={colorAnterior} icon={IconTrendingDown} refreshing={loading} />
              <KpiStatCard label='Vs. mes anterior' value={pct(data.kpis.variacion)} hint={`${data.kpis.diferencia >= 0 ? '▲' : '▼'} ${money(Math.abs(data.kpis.diferencia))}`} color={variacionPositiva ? COLOR_SUBE : COLOR_BAJA} icon={variacionPositiva ? IconTrendingUp : IconTrendingDown} refreshing={loading} />
            </SimpleGrid>

            <Card shadow='sm' radius='md' withBorder p='lg' mb='md'>
              <Title order={3} fz={16} mb='sm'>Evolución de la venta en el mes</Title>
              {chartAcumulado && <ChartBox type='line' data={chartAcumulado} height={300} entranceKey={`r-${companyId}-${corte}`} options={lineOptions} />}
            </Card>

            <SimpleGrid cols={{ base: 1, lg: 2 }}>
              <RankedListCard title='Clientes con mayor venta' description='Venta neta del periodo con los filtros actuales.' items={data.topClientes.map((c) => ({ name: c.nombre, value: c.venta }))} formatValue={money} emptyMessage='Sin clientes con compra en el periodo.' />
              <RankedListCard title='Vendedores con mayor venta' description='Venta neta del periodo.' items={data.vendedores.slice(0, 10).map((v) => ({ name: v.nombre, value: v.venta }))} formatValue={money} emptyMessage='Sin ventas en el periodo.' />
            </SimpleGrid>
          </Tabs.Panel>

          {/* ---------- CIERRE MENSUAL ---------- */}
          <Tabs.Panel value='cierre' pt='md'>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb='md'>
              <KpiStatCard label='Venta neta' value={moneyShort(data.kpis.ventaNeta)} hint={money(data.kpis.ventaNeta)} color={colorActual} icon={IconCash} refreshing={loading} />
              <KpiStatCard label='Venta bruta' value={moneyShort(data.kpis.ventaBruta)} hint='Antes de notas crédito' color={colorActual} icon={IconReceipt2} refreshing={loading} />
              <KpiStatCard label='Notas crédito' value={moneyShort(data.kpis.notasCredito)} hint='Del periodo' color={colorAnterior} icon={IconTrendingDown} refreshing={loading} />
              <KpiStatCard label='Vs. mismo lapso mes anterior' value={pct(data.kpis.variacion)} hint={money(data.kpis.diferencia)} color={variacionPositiva ? COLOR_SUBE : COLOR_BAJA} icon={variacionPositiva ? IconTrendingUp : IconTrendingDown} refreshing={loading} />
              <KpiStatCard label='Facturas' value={num(data.kpis.facturas)} hint='Documentos del periodo' color={colorActual} icon={IconReceipt2} refreshing={loading} />
              <KpiStatCard label='Clientes' value={num(data.kpis.clientes)} hint='Con compra en el periodo' color={colorActual} icon={IconUsers} refreshing={loading} />
              <KpiStatCard label='Días con facturación' value={num(data.kpis.diasConVenta)} hint='En el periodo' color={colorAnterior} icon={IconCalendarStats} refreshing={loading} />
              <KpiStatCard label='Promedio por día hábil' value={moneyShort(data.kpis.promedioDiaHabil)} hint='Venta neta ÷ días hábiles' color={colorActual} icon={IconChartBar} refreshing={loading} />
            </SimpleGrid>
            <Alert color='blue' variant='light' title='Etapa 1'>
              El cierre mensual muestra, por ahora, los indicadores del periodo del corte. El desglose por canal,
              segmento y línea de negocio, y el comparativo contra presupuesto y año anterior, se incorporan en la
              etapa 2 de validación de datos.
            </Alert>
          </Tabs.Panel>

          {/* ---------- CLIENTES ---------- */}
          <Tabs.Panel value='clientes' pt='md'>
            <Card shadow='sm' radius='md' withBorder p={0} mb='md'>
              <Table.ScrollContainer minWidth={640} mah={520}>
                <Table striped highlightOnHover stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>#</Table.Th>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Código</Table.Th>
                      <Table.Th ta='right'>Venta del periodo</Table.Th>
                      <Table.Th ta='right'>Participación</Table.Th>
                      <Table.Th ta='right'>Facturas</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.topClientes.map((c, i) => (
                      <Table.Tr key={c.codigo}>
                        <Table.Td>{i + 1}</Table.Td>
                        <Table.Td fw={500}>{c.nombre}</Table.Td>
                        <Table.Td c='dimmed'>{c.codigo}</Table.Td>
                        <Table.Td ta='right'>{money(c.venta)}</Table.Td>
                        <Table.Td ta='right'>{pct(c.participacion)}</Table.Td>
                        <Table.Td ta='right'>{num(c.documentos)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>

            <Card shadow='sm' radius='md' withBorder p={0}>
              <Group justify='space-between' p='md' pb='xs'>
                <Title order={3} fz={16}>Clientes por recuperar</Title>
                <Badge variant='light' color='orange'>{data.clientesPorRecuperar.length}</Badge>
              </Group>
              <Text size='xs' c='dimmed' px='md' pb='xs'>Compraron el mes anterior y todavía no compran en este mes.</Text>
              <Table.ScrollContainer minWidth={480} mah={380}>
                <Table striped highlightOnHover stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Código</Table.Th>
                      <Table.Th ta='right'>Venta mes anterior</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.clientesPorRecuperar.map((c) => (
                      <Table.Tr key={c.codigo}>
                        <Table.Td fw={500}>{c.nombre}</Table.Td>
                        <Table.Td c='dimmed'>{c.codigo}</Table.Td>
                        <Table.Td ta='right'>{money(c.venta)}</Table.Td>
                      </Table.Tr>
                    ))}
                    {data.clientesPorRecuperar.length === 0 && (
                      <Table.Tr><Table.Td colSpan={3}><Text size='sm' c='dimmed' ta='center' py='md'>No hay clientes por recuperar en este corte.</Text></Table.Td></Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          </Tabs.Panel>

          {/* ---------- VENDEDORES ---------- */}
          <Tabs.Panel value='vendedores' pt='md'>
            <Card shadow='sm' radius='md' withBorder p={0}>
              <Table.ScrollContainer minWidth={700} mah={560}>
                <Table striped highlightOnHover stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>#</Table.Th>
                      <Table.Th>Vendedor</Table.Th>
                      <Table.Th ta='right'>Venta del periodo</Table.Th>
                      <Table.Th ta='right'>Participación</Table.Th>
                      <Table.Th ta='right'>Clientes</Table.Th>
                      <Table.Th ta='right'>Facturas</Table.Th>
                      <Table.Th ta='right'>Última venta</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.vendedores.map((v, i) => (
                      <Table.Tr key={v.codigo}>
                        <Table.Td>{i + 1}</Table.Td>
                        <Table.Td fw={500}>{v.nombre}</Table.Td>
                        <Table.Td ta='right'>{money(v.venta)}</Table.Td>
                        <Table.Td ta='right'>{pct(v.participacion)}</Table.Td>
                        <Table.Td ta='right'>{num(v.clientes)}</Table.Td>
                        <Table.Td ta='right'>{num(v.documentos)}</Table.Td>
                        <Table.Td ta='right'>{v.ultimaVenta ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          </Tabs.Panel>

          {/* ---------- PRODUCTOS (etapa 2: vista OLP_IND_VentasB1SLQuery) ---------- */}
          <Tabs.Panel value='productos' pt='md'>
            {!data.lineas ? (
              <Alert color='yellow' variant='light' title='Detalle de líneas no disponible'>
                No se pudo leer la vista de líneas de venta de SAP en este momento. Los indicadores por cabecera
                (seguimiento diario, clientes y vendedores) sí están disponibles.
              </Alert>
            ) : (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb='md'>
                  <KpiStatCard label='Venta neta (líneas)' value={moneyShort(data.lineas.kpis.ventaNetaLineas)} hint={money(data.lineas.kpis.ventaNetaLineas)} color={colorActual} icon={IconCash} refreshing={loading} />
                  <KpiStatCard label='Unidades' value={num(Math.round(data.lineas.kpis.unidades))} hint='Cantidad neta del periodo' color={colorActual} icon={IconReceipt2} refreshing={loading} />
                  <KpiStatCard label='Margen' value={moneyShort(data.lineas.kpis.margen)} hint={`Margen ${pct(data.lineas.kpis.margenPct)}`} color={colorAnterior} icon={IconTrendingUp} refreshing={loading} />
                  <KpiStatCard label='Productos distintos' value={num(data.lineas.kpis.productosDistintos)} hint={`${num(data.lineas.kpis.lineasTerapeuticas)} líneas terapéuticas`} color={colorActual} icon={IconChartBar} refreshing={loading} />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, lg: 2 }} mb='md'>
                  <RankedListCard title='Líneas terapéuticas con mayor venta' description='Venta neta por U_IT_LineaTerapeutica.' items={data.lineas.lineasTerapeuticas.map((t) => ({ name: t.nombre, value: t.venta }))} formatValue={money} emptyMessage='Sin líneas terapéuticas en el periodo.' />
                  <RankedListCard title='Productos con mayor venta' description='Venta neta por producto.' items={data.lineas.topProductos.slice(0, 10).map((p) => ({ name: p.nombre, value: p.venta }))} formatValue={money} emptyMessage='Sin productos en el periodo.' />
                </SimpleGrid>

                <Card shadow='sm' radius='md' withBorder p={0}>
                  <Table.ScrollContainer minWidth={760} mah={520}>
                    <Table striped highlightOnHover stickyHeader>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>#</Table.Th>
                          <Table.Th>Producto</Table.Th>
                          <Table.Th>Código</Table.Th>
                          <Table.Th ta='right'>Venta neta</Table.Th>
                          <Table.Th ta='right'>Unidades</Table.Th>
                          <Table.Th ta='right'>Margen</Table.Th>
                          <Table.Th ta='right'>Margen %</Table.Th>
                          <Table.Th ta='right'>Part.</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {data.lineas.topProductos.map((p, i) => (
                          <Table.Tr key={p.codigo}>
                            <Table.Td>{i + 1}</Table.Td>
                            <Table.Td fw={500}>{p.nombre}</Table.Td>
                            <Table.Td c='dimmed'>{p.codigo}</Table.Td>
                            <Table.Td ta='right'>{money(p.venta)}</Table.Td>
                            <Table.Td ta='right'>{num(Math.round(p.unidades))}</Table.Td>
                            <Table.Td ta='right'>{money(p.margen)}</Table.Td>
                            <Table.Td ta='right'>{pct(p.margenPct)}</Table.Td>
                            <Table.Td ta='right'>{pct(p.participacion)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              </>
            )}
          </Tabs.Panel>

          {/* ---------- PEDIDOS (etapa 2) ---------- */}
          <Tabs.Panel value='pedidos' pt='md'>
            {!data.lineas ? (
              <Alert color='yellow' variant='light' title='Detalle de líneas no disponible'>
                No se pudo leer la vista de líneas de venta de SAP en este momento.
              </Alert>
            ) : (
              <Card shadow='sm' radius='md' withBorder p={0}>
                <Group justify='space-between' p='md' pb='xs'>
                  <Title order={3} fz={16}>Pedidos facturados (por orden de compra)</Title>
                  <Badge variant='light'>{num(data.lineas.kpis.pedidos)}</Badge>
                </Group>
                <Table.ScrollContainer minWidth={640} mah={520}>
                  <Table striped highlightOnHover stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Orden de compra</Table.Th>
                        <Table.Th>Cliente</Table.Th>
                        <Table.Th ta='right'>Venta neta</Table.Th>
                        <Table.Th ta='right'>Líneas</Table.Th>
                        <Table.Th ta='right'>Fecha</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.lineas.pedidos.map((p) => (
                        <Table.Tr key={p.ordenCompra}>
                          <Table.Td fw={500}>{p.ordenCompra}</Table.Td>
                          <Table.Td>{p.cliente}</Table.Td>
                          <Table.Td ta='right'>{money(p.venta)}</Table.Td>
                          <Table.Td ta='right'>{num(p.lineas)}</Table.Td>
                          <Table.Td ta='right'>{p.fecha ?? '—'}</Table.Td>
                        </Table.Tr>
                      ))}
                      {data.lineas.pedidos.length === 0 && (
                        <Table.Tr><Table.Td colSpan={5}><Text size='sm' c='dimmed' ta='center' py='md'>Sin pedidos con orden de compra en el periodo.</Text></Table.Td></Table.Tr>
                      )}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Card>
            )}
          </Tabs.Panel>

          {/* ---------- DETALLE DE VENTAS (etapa 2) ---------- */}
          <Tabs.Panel value='detalle' pt='md'>
            {!data.lineas ? (
              <Alert color='yellow' variant='light' title='Detalle de líneas no disponible'>
                No se pudo leer la vista de líneas de venta de SAP en este momento.
              </Alert>
            ) : (
              <Card shadow='sm' radius='md' withBorder p={0}>
                <Group justify='space-between' p='md' pb='xs'>
                  <Title order={3} fz={16}>Detalle de líneas</Title>
                  <Text size='xs' c='dimmed'>{num(data.lineas.kpis.totalLineas)} líneas · muestra {num(data.lineas.detalle.length)}</Text>
                </Group>
                <Table.ScrollContainer minWidth={900} mah={560}>
                  <Table striped highlightOnHover stickyHeader fz='xs'>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Fecha</Table.Th>
                        <Table.Th>Tipo</Table.Th>
                        <Table.Th>Doc.</Table.Th>
                        <Table.Th>Cliente</Table.Th>
                        <Table.Th>Producto</Table.Th>
                        <Table.Th>Línea terapéutica</Table.Th>
                        <Table.Th ta='right'>Cant.</Table.Th>
                        <Table.Th ta='right'>Valor</Table.Th>
                        <Table.Th>Vendedor</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.lineas.detalle.map((d, i) => (
                        <Table.Tr key={`${d.documento}-${i}`}>
                          <Table.Td>{d.fecha}</Table.Td>
                          <Table.Td>{d.tipo}</Table.Td>
                          <Table.Td>{d.documento ?? '—'}</Table.Td>
                          <Table.Td>{d.cliente}</Table.Td>
                          <Table.Td>{d.producto}</Table.Td>
                          <Table.Td>{d.lineaTerapeutica}</Table.Td>
                          <Table.Td ta='right'>{num(Math.round(d.cantidad))}</Table.Td>
                          <Table.Td ta='right'>{money(d.valor)}</Table.Td>
                          <Table.Td>{d.vendedor}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Card>
            )}
          </Tabs.Panel>
        </Tabs>
      )}

      {data && (
        <Text size='xs' c='dimmed'>
          Fuente: facturas de venta (Invoices) y notas crédito (CreditNotes) de SAP, en vivo. Venta neta = facturas −
          notas crédito, sin documentos cancelados. «Mismo lapso» = del día 1 al día del corte en ambos meses. El día en
          curso puede ser parcial. Cifras en pesos colombianos.
        </Text>
      )}
    </DashboardPageShell>
  );
}
