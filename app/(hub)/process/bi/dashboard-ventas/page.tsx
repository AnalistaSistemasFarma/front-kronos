'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert, Anchor, Breadcrumbs, Card, Group, Loader, SimpleGrid, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconChartBar, IconChevronRight, IconTrendingUp, IconTrendingDown } from '@tabler/icons-react';
import type { ChartData, ChartOptions } from 'chart.js';
import { ChartBox } from '../../../../../components/charts/ChartBox';

/**
 * BI · Dashboard de venta diaria: trazabilidad gerencial del mes actual contra el
 * mismo lapso del mes anterior, en vivo desde SAP (facturas de venta). Consume
 * /api/sales/daily-dashboard, que agrega por día del lado del servidor.
 * Solo lectura; usa el acceso «Ventas · Ofertas» por empresa.
 */

type Company = { idCompany: number; companyName: string; canRead: boolean; ready: boolean };

interface DiaPunto {
  dia: number;
  fechaActual: string;
  fechaAnterior: string | null;
  actual: number;
  anterior: number | null;
}

interface DashboardData {
  corte: string;
  actual: { desde: string; hasta: string; total: number };
  anterior: { desde: string; hasta: string; total: number };
  dias: DiaPunto[];
  kpis: {
    totalActual: number;
    totalAnterior: number;
    variacion: number | null;
    diferencia: number;
    promedioDiarioActual: number;
    diasConVenta: number;
  };
}

const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);
const moneyShort = (v: number) => {
  const millones = v / 1_000_000;
  if (Math.abs(millones) >= 1000) return `$ ${(millones / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MM`;
  return `$ ${millones.toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
};
const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`);

const hoy = () => new Date().toISOString().slice(0, 10);

export default function DashboardVentasPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [corte, setCorte] = useState(hoy());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sales/access')
      .then((r) => r.json())
      .then((d) => {
        const list = ((d.companies ?? []) as Company[]).filter((c) => c.canRead && c.ready);
        setCompanies(list);
        if (list[0]) setCompanyId(String(list[0].idCompany));
      })
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId, corte });
      const r = await fetch(`/api/sales/daily-dashboard?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo cargar el dashboard');
      setData(d as DashboardData);
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

  const chartData = useMemo<ChartData<'bar'> | null>(() => {
    if (!data) return null;
    return {
      labels: data.dias.map((d) => `Día ${d.dia}`),
      datasets: [
        {
          label: 'Mes actual',
          data: data.dias.map((d) => d.actual),
          backgroundColor: '#005ea8',
          borderRadius: 4,
        },
        {
          label: 'Mes anterior',
          data: data.dias.map((d) => d.anterior ?? 0),
          backgroundColor: '#946fef',
          borderRadius: 4,
        },
      ],
    };
  }, [data]);

  const chartOptions: ChartOptions<'bar'> = { plugins: { legend: { position: 'top' } } };

  const variacionPositiva = (data?.kpis.variacion ?? 0) >= 0;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm'>
            <Anchor component={Link} href='/process'>Procesos</Anchor>
            <Text>Dashboard de venta diaria</Text>
          </Breadcrumbs>
          <Title order={1} fz={{ base: 24, sm: 30 }} className='font-bold mb-1 flex items-center gap-3'>
            <IconChartBar size={28} style={{ color: 'var(--mantine-primary-color-filled)' }} />
            Dashboard gerencial de venta diaria
          </Title>
          <Text c='dimmed' mb='md'>
            Trazabilidad de la venta diaria del mes en curso contra el mismo lapso del mes anterior, en vivo desde SAP.
          </Text>
          <Group align='flex-end' gap='md'>
            {companies && companies.length > 1 && (
              <Group gap='xs'>
                <Text size='sm' c='dimmed'>Empresa:</Text>
                <select
                  value={companyId ?? ''}
                  onChange={(e) => setCompanyId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--mantine-color-gray-4)' }}
                >
                  {companies.map((c) => (
                    <option key={c.idCompany} value={String(c.idCompany)}>{c.companyName}</option>
                  ))}
                </select>
              </Group>
            )}
            <TextInput
              label='Corte'
              type='date'
              value={corte}
              max={hoy()}
              onChange={(e) => setCorte(e.currentTarget.value)}
            />
          </Group>
        </Card>

        {error && <Alert color='red' mb='md' title='No se pudo cargar'>{error}</Alert>}

        {companies && companies.length === 0 && (
          <Alert color='yellow' mb='md' title='Sin acceso'>
            No tiene acceso a «Ventas · Ofertas» en ninguna empresa con Service Layer configurado.
          </Alert>
        )}

        {loading && (
          <Group justify='center' py='xl'><Loader /></Group>
        )}

        {!loading && data && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb='md'>
              <Card shadow='sm' radius='md' withBorder p='lg'>
                <Text size='xs' tt='uppercase' c='dimmed' fw={700}>Venta mes actual ({data.actual.desde.slice(5)} a {data.actual.hasta.slice(5)})</Text>
                <Text fz={28} fw={800} style={{ color: '#005ea8' }}>{moneyShort(data.kpis.totalActual)}</Text>
                <Text size='xs' c='dimmed'>{money(data.kpis.totalActual)}</Text>
              </Card>
              <Card shadow='sm' radius='md' withBorder p='lg'>
                <Text size='xs' tt='uppercase' c='dimmed' fw={700}>Venta mes anterior ({data.anterior.desde.slice(5)} a {data.anterior.hasta.slice(5)})</Text>
                <Text fz={28} fw={800} style={{ color: '#946fef' }}>{moneyShort(data.kpis.totalAnterior)}</Text>
                <Text size='xs' c='dimmed'>{money(data.kpis.totalAnterior)}</Text>
              </Card>
              <Card shadow='sm' radius='md' withBorder p='lg'>
                <Text size='xs' tt='uppercase' c='dimmed' fw={700}>Variación</Text>
                <Group gap={6} align='center'>
                  {variacionPositiva ? <IconTrendingUp size={24} color='#1f8a5b' /> : <IconTrendingDown size={24} color='#c0392b' />}
                  <Text fz={28} fw={800} style={{ color: variacionPositiva ? '#1f8a5b' : '#c0392b' }}>{pct(data.kpis.variacion)}</Text>
                </Group>
                <Text size='xs' c='dimmed'>{data.kpis.diferencia >= 0 ? '▲' : '▼'} {money(Math.abs(data.kpis.diferencia))}</Text>
              </Card>
              <Card shadow='sm' radius='md' withBorder p='lg'>
                <Text size='xs' tt='uppercase' c='dimmed' fw={700}>Promedio diario (mes actual)</Text>
                <Text fz={28} fw={800} style={{ color: '#005ea8' }}>{moneyShort(data.kpis.promedioDiarioActual)}</Text>
                <Text size='xs' c='dimmed'>{data.kpis.diasConVenta} día(s) con facturación</Text>
              </Card>
            </SimpleGrid>

            <Card shadow='sm' radius='md' withBorder p='lg' mb='md'>
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
                          <Table.Td ta='right' style={{ color: v == null ? undefined : v >= 0 ? '#1f8a5b' : '#c0392b' }}>{pct(v)}</Table.Td>
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

            <Text size='xs' c='dimmed' mt='sm'>
              Fuente: facturas de venta (Invoices) de SAP, valor del documento (DocTotal), sin documentos cancelados. «Mismo lapso» = del día 1 al día del corte en ambos meses. El día en curso puede ser parcial.
            </Text>
          </>
        )}
      </div>
    </div>
  );
}
