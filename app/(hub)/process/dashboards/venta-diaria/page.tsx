'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Card, Group, Loader, Select, SimpleGrid, Table, Text, TextInput, Title } from '@mantine/core';
import { IconCalendarStats, IconCash, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import type { ChartData, ChartOptions } from 'chart.js';
import { ChartBox } from '../../../../../components/charts/ChartBox';
import DashboardPageShell from '../../../../../components/dashboard/DashboardPageShell';
import { KpiStatCard } from '../../../../../components/dashboard/actividades/ActividadesUi';
import { useDashboardChartPalette } from '../../../../../components/dashboard/useDashboardChartPalette';
import { hoyBogota, type VentaDiariaResultado } from '../../../../../lib/dashboards/venta-diaria/calculo';
import type { EmpresaVentaDiaria } from '../../../../../lib/dashboards/venta-diaria/access';

/**
 * Dashboard gerencial de venta diaria: mes actual contra el mismo lapso del mes
 * anterior, en vivo desde SAP (facturas de venta). Consume
 * /api/dashboards/venta-diaria, que agrega por día en el servidor. Solo lectura.
 * Acceso: subproceso «Dashboard de venta diaria» asignado por empresa.
 */

const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);
const moneyShort = (v: number) => {
  const millones = v / 1_000_000;
  if (Math.abs(millones) >= 1000) return `$ ${(millones / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MM`;
  return `$ ${millones.toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
};
const pct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;

const COLOR_SUBE = 'var(--mantine-color-teal-6)';
const COLOR_BAJA = 'var(--mantine-color-red-6)';

export default function DashboardVentaDiariaPage() {
  const { palette, isDark } = useDashboardChartPalette();
  const [empresas, setEmpresas] = useState<EmpresaVentaDiaria[] | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [corte, setCorte] = useState(hoyBogota());
  const [data, setData] = useState<VentaDiariaResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboards/venta-diaria', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) {
          setSinAcceso(true);
          setEmpresas([]);
          return;
        }
        const d = await r.json().catch(() => ({}));
        const list = (d.empresas ?? []) as EmpresaVentaDiaria[];
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
      const r = await fetch(`/api/dashboards/venta-diaria?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo cargar el dashboard');
      setData(d as VentaDiariaResultado);
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

  const chartData = useMemo<ChartData<'bar'> | null>(() => {
    if (!data) return null;
    return {
      labels: data.dias.map((d) => `Día ${d.dia}`),
      datasets: [
        { label: 'Mes actual', data: data.dias.map((d) => d.actual), backgroundColor: colorActual, borderRadius: 4 },
        { label: 'Mes anterior', data: data.dias.map((d) => d.anterior ?? 0), backgroundColor: colorAnterior, borderRadius: 4 },
      ],
    };
  }, [data, colorActual, colorAnterior]);

  const chartOptions: ChartOptions<'bar'> = { plugins: { legend: { position: 'top' } } };
  const variacionPositiva = (data?.kpis.variacion ?? 0) >= 0;

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
      <TextInput
        label='Corte'
        type='date'
        value={corte}
        max={hoyBogota()}
        onChange={(e) => setCorte(e.currentTarget.value)}
      />
    </Group>
  );

  return (
    <DashboardPageShell
      title='Dashboard gerencial de venta diaria'
      description='Venta diaria del mes en curso contra el mismo lapso del mes anterior, en vivo desde SAP.'
      toolbar={empresas && empresas.length > 0 ? toolbar : undefined}
    >
      {empresas === null && (
        <Group justify='center' py='xl'><Loader /></Group>
      )}

      {sinAcceso && (
        <Alert color='yellow' title='Sin acceso'>
          No tiene acceso a este tablero. Solicite el permiso «Dashboard de venta diaria» al administrador.
        </Alert>
      )}

      {error && <Alert color='red' title='No se pudo cargar'>{error}</Alert>}

      {loading && !data && (
        <Group justify='center' py='xl'><Loader /></Group>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <KpiStatCard
              label={`Venta mes actual (${data.actual.desde.slice(5)} a ${data.actual.hasta.slice(5)})`}
              value={moneyShort(data.kpis.totalActual)}
              hint={money(data.kpis.totalActual)}
              color={colorActual}
              icon={IconCash}
              refreshing={loading}
            />
            <KpiStatCard
              label={`Venta mes anterior (${data.anterior.desde.slice(5)} a ${data.anterior.hasta.slice(5)})`}
              value={moneyShort(data.kpis.totalAnterior)}
              hint={money(data.kpis.totalAnterior)}
              color={colorAnterior}
              icon={IconCash}
              refreshing={loading}
            />
            <KpiStatCard
              label='Variación'
              value={pct(data.kpis.variacion)}
              hint={`${data.kpis.diferencia >= 0 ? '▲' : '▼'} ${money(Math.abs(data.kpis.diferencia))}`}
              color={variacionPositiva ? COLOR_SUBE : COLOR_BAJA}
              icon={variacionPositiva ? IconTrendingUp : IconTrendingDown}
              refreshing={loading}
            />
            <KpiStatCard
              label='Promedio diario (mes actual)'
              value={moneyShort(data.kpis.promedioDiarioActual)}
              hint={`${data.kpis.diasConVenta} día(s) con facturación`}
              color={colorActual}
              icon={IconCalendarStats}
              refreshing={loading}
            />
          </SimpleGrid>

          <Card shadow='sm' radius='md' withBorder p='lg'>
            <Title order={3} fz={16} mb='sm'>Venta diaria comparada (por día del mes)</Title>
            {chartData && (
              <ChartBox
                type='bar'
                data={chartData}
                height={320}
                entranceKey={`${companyId}-${corte}`}
                options={chartOptions}
              />
            )}
          </Card>

          <Card shadow='sm' radius='md' withBorder p={0}>
            <Table.ScrollContainer minWidth={560}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Día</Table.Th>
                    <Table.Th>Fecha actual</Table.Th>
                    <Table.Th ta='right'>Venta actual</Table.Th>
                    <Table.Th>Fecha anterior</Table.Th>
                    <Table.Th ta='right'>Venta anterior</Table.Th>
                    <Table.Th ta='right'>Variación</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.dias.map((d) => {
                    const v = d.anterior && d.anterior > 0 ? (d.actual - d.anterior) / d.anterior : null;
                    return (
                      <Table.Tr key={d.dia}>
                        <Table.Td fw={600}>Día {d.dia}</Table.Td>
                        <Table.Td>{d.fechaActual}</Table.Td>
                        <Table.Td ta='right'>{money(d.actual)}</Table.Td>
                        <Table.Td>{d.fechaAnterior ?? '—'}</Table.Td>
                        <Table.Td ta='right'>{money(d.anterior)}</Table.Td>
                        <Table.Td ta='right' style={{ color: v == null ? undefined : v >= 0 ? COLOR_SUBE : COLOR_BAJA }}>
                          {pct(v)}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr style={{ fontWeight: 800, background: 'var(--mantine-color-default-hover)' }}>
                    <Table.Td>Acumulado</Table.Td>
                    <Table.Td />
                    <Table.Td ta='right'>{money(data.kpis.totalActual)}</Table.Td>
                    <Table.Td />
                    <Table.Td ta='right'>{money(data.kpis.totalAnterior)}</Table.Td>
                    <Table.Td ta='right'>{pct(data.kpis.variacion)}</Table.Td>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          </Card>

          <Text size='xs' c='dimmed'>
            Fuente: facturas de venta (Invoices) de SAP, valor del documento (DocTotal), sin documentos cancelados.
            «Mismo lapso» = del día 1 al día del corte en ambos meses. El día en curso puede ser parcial.
          </Text>
        </>
      )}
    </DashboardPageShell>
  );
}
