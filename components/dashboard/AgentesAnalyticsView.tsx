'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Card,
  Flex,
  Grid,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  Badge,
} from '@mantine/core';
import { IconAlertCircle, IconChartLine, IconMessage, IconRobot, IconUsers } from '@tabler/icons-react';
import { buildAreaLineChart, buildHorizontalMultiColorBarChart } from '../../lib/charts/builders';
import {
  getDashboardDateRange,
  getPeriodRangeLabel,
  type DashboardDateFilter,
} from '../../lib/dashboard/dateRange';
import { ChartContainer } from './ChartContainer';
import DashboardDateToolbar, { DashboardPeriodHint } from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import { useChartViewport } from './useChartViewport';
import { useProjectColors } from './useProjectColors';
import { useDashboardChartPalette } from './useDashboardChartPalette';
import { getDashboardCardPadding, resolveChartHeight } from '../../lib/dashboard/responsive';

interface AgenteCatalogo {
  idAgent: number;
  code: string;
  displayName: string;
}

interface RankingUsuario {
  id: string;
  nombre: string;
  email: string | null;
  mensajes: number;
  conversaciones: number;
  agentesDistintos: number;
}

interface RankingAgente {
  idAgent: number;
  code: string;
  displayName: string;
  mensajes: number;
  conversaciones: number;
  usuariosDistintos: number;
  totalTokens: number;
  turnos: number;
}

interface AgentesResponse {
  agentes: AgenteCatalogo[];
  resumen: {
    totalMensajes: number;
    usuariosActivos: number;
    totalConversaciones: number;
    agenteTop: { displayName: string; mensajes: number } | null;
  };
  rankingUsuarios: RankingUsuario[];
  rankingAgentes: RankingAgente[];
  tendencia: { fecha: string; mensajes: number }[];
}

const ALL_AGENTS_VALUE = '__todos__';

const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

export default function AgentesAnalyticsView() {
  const projectColors = useProjectColors();
  const { categoricalPalette } = useDashboardChartPalette();
  const chartViewport = useChartViewport();

  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>('month');
  const [selectedMonthDate, setSelectedMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [agentFilter, setAgentFilter] = useState<string>(ALL_AGENTS_VALUE);

  const [data, setData] = useState<AgentesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => getDashboardDateRange(dateFilter, selectedMonthDate),
    [dateFilter, selectedMonthDate]
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (range) {
        params.set('desde', range.startDate);
        params.set('hasta', range.endDate);
      }
      if (agentFilter !== ALL_AGENTS_VALUE) {
        params.set('agente', agentFilter);
      }
      const res = await fetch(`/api/dashboard/agentes?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Error ${res.status} consultando la analítica de agentes`);
      }
      const json = (await res.json()) as AgentesResponse;
      setData(json);
    } catch (err) {
      console.error('Error cargando analítica de agentes:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [range, agentFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const agentSelectData = useMemo(
    () => [
      { value: ALL_AGENTS_VALUE, label: 'Todos los agentes' },
      ...(data?.agentes.map((a) => ({ value: String(a.idAgent), label: a.displayName })) ?? []),
    ],
    [data?.agentes]
  );

  const tendenciaChart = useMemo(
    () =>
      buildAreaLineChart(
        (data?.tendencia ?? []).map((d) => ({
          label: new Date(`${d.fecha}T00:00:00`).toLocaleDateString('es-CO', {
            day: '2-digit',
            month: 'short',
          }),
          value: d.mensajes,
        })),
        projectColors.primary,
        { valueLabel: 'Mensajes' }
      ),
    [data?.tendencia, projectColors.primary]
  );

  const rankingUsuariosChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(
        (data?.rankingUsuarios ?? []).slice(0, 12).map((u, index) => ({
          label: u.nombre,
          value: u.mensajes,
          color: categoricalPalette[index % categoricalPalette.length],
        })),
        chartViewport.isMobile,
        { valueLabel: 'mensajes', datasetLabel: 'Mensajes por usuario', truncateLabels: true }
      ),
    [data?.rankingUsuarios, categoricalPalette, chartViewport.isMobile]
  );

  const rankingAgentesChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(
        (data?.rankingAgentes ?? []).slice(0, 12).map((a, index) => ({
          label: a.displayName,
          value: a.mensajes,
          color: categoricalPalette[index % categoricalPalette.length],
        })),
        chartViewport.isMobile,
        { valueLabel: 'mensajes', datasetLabel: 'Mensajes por agente', truncateLabels: true }
      ),
    [data?.rankingAgentes, categoricalPalette, chartViewport.isMobile]
  );

  const chartHeights = {
    standard: resolveChartHeight('standard', chartViewport),
    medium: resolveChartHeight('medium', chartViewport),
  };

  if (loading && !data) {
    return (
      <DashboardPageShell title='Agentes'>
        <Skeleton height={50} mb='xl' />
        <Skeleton height={200} />
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title='Agentes'
      description={
        <Stack gap={4}>
          <Text size='sm' c='dimmed' component='span' display='block'>
            Quién más usa a los agentes y cómo evoluciona ese uso en el tiempo
          </Text>
          {range ? (
            <DashboardPeriodHint
              dateFilter={dateFilter}
              selectedMonthDate={selectedMonthDate}
              appliedRange={getPeriodRangeLabel(dateFilter, selectedMonthDate)}
            />
          ) : null}
        </Stack>
      }
      toolbar={
        <DashboardDateToolbar
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          selectedMonthDate={selectedMonthDate}
          onSelectedMonthDateChange={setSelectedMonthDate}
          onRefresh={fetchData}
          loading={loading}
          showExport={false}
        />
      }
    >
      <Paper p={{ base: 'sm', sm: 'md' }} radius='md' withBorder>
        <Select
          label='Agente'
          description='Filtrar la analítica a un solo agente'
          leftSection={<IconRobot size={18} />}
          data={agentSelectData}
          value={agentFilter}
          onChange={(v) => setAgentFilter(v ?? ALL_AGENTS_VALUE)}
          allowDeselect={false}
          searchable={(data?.agentes.length ?? 0) > 4}
          nothingFoundMessage='Sin agentes'
        />
      </Paper>

      {error && (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, sm: 2, md: 4 }} spacing={{ base: 'sm', sm: 'md' }}>
        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Mensajes
            </Text>
            <IconMessage size={20} color={projectColors.primary} />
          </Group>
          <Title order={3} style={{ color: projectColors.primary }}>
            {formatNumber(data?.resumen.totalMensajes ?? 0)}
          </Title>
          <Text size='xs' c='dimmed'>
            Enviados por personas en el periodo
          </Text>
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Usuarios activos
            </Text>
            <IconUsers size={20} color={projectColors.teal} />
          </Group>
          <Title order={3} style={{ color: projectColors.teal }}>
            {formatNumber(data?.resumen.usuariosActivos ?? 0)}
          </Title>
          <Text size='xs' c='dimmed'>
            Personas distintas que escribieron
          </Text>
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Conversaciones
            </Text>
            <IconChartLine size={20} color={projectColors.purple} />
          </Group>
          <Title order={3} style={{ color: projectColors.purple }}>
            {formatNumber(data?.resumen.totalConversaciones ?? 0)}
          </Title>
          <Text size='xs' c='dimmed'>
            Con actividad en el periodo
          </Text>
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Agente más usado
            </Text>
            <IconRobot size={20} color={projectColors.success} />
          </Group>
          {data?.resumen.agenteTop ? (
            <>
              <Title order={4} lineClamp={2} style={{ color: projectColors.success }}>
                {data.resumen.agenteTop.displayName}
              </Title>
              <Text size='xs' c='dimmed'>
                {formatNumber(data.resumen.agenteTop.mensajes)} mensajes
              </Text>
            </>
          ) : (
            <Text size='sm' c='dimmed'>
              Sin actividad
            </Text>
          )}
        </Card>
      </SimpleGrid>

      <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
        <Title order={4} mb='xs'>
          Tendencia de uso
        </Title>
        <Text size='xs' c='dimmed' mb='md'>
          Mensajes de personas por día en el periodo seleccionado
        </Text>
        {loading ? (
          <Skeleton height={chartHeights.standard} />
        ) : (data?.tendencia ?? []).some((d) => d.mensajes > 0) ? (
          <ChartContainer
            type='line'
            data={tendenciaChart.data}
            options={tendenciaChart.options}
            height={chartHeights.standard}
          />
        ) : (
          <Flex h={chartHeights.standard} align='center' justify='center'>
            <Stack align='center' gap='sm'>
              <IconChartLine size={48} color={projectColors.primary} opacity={0.3} />
              <Text c='dimmed' size='sm'>
                Sin actividad en este periodo
              </Text>
            </Stack>
          </Flex>
        )}
      </Card>

      <Grid gutter='lg' align='stretch'>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
            <Title order={4} mb='xs'>
              Quién más los usa
            </Title>
            <Text size='xs' c='dimmed' mb='md'>
              Ranking de personas por cantidad de mensajes
            </Text>
            {loading ? (
              <Skeleton height={chartHeights.medium} />
            ) : (data?.rankingUsuarios.length ?? 0) > 0 ? (
              <ChartContainer
                type='bar'
                data={rankingUsuariosChart.data}
                options={rankingUsuariosChart.options}
                height={chartHeights.medium}
              />
            ) : (
              <Text c='dimmed' ta='center' py='xl'>
                Sin mensajes en el periodo
              </Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
            <Title order={4} mb='xs'>
              Ranking de agentes
            </Title>
            <Text size='xs' c='dimmed' mb='md'>
              Mensajes recibidos por cada agente
            </Text>
            {loading ? (
              <Skeleton height={chartHeights.medium} />
            ) : (data?.rankingAgentes.length ?? 0) > 0 ? (
              <ChartContainer
                type='bar'
                data={rankingAgentesChart.data}
                options={rankingAgentesChart.options}
                height={chartHeights.medium}
              />
            ) : (
              <Text c='dimmed' ta='center' py='xl'>
                Sin actividad en el periodo
              </Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
        <Title order={4} mb='md'>
          Detalle por agente
        </Title>
        {loading ? (
          <Skeleton height={120} />
        ) : (data?.rankingAgentes.length ?? 0) > 0 ? (
          <Stack gap='sm'>
            {data!.rankingAgentes.slice(0, 15).map((a) => (
              <Paper key={a.idAgent} p='sm' withBorder>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size='sm' fw={600} lineClamp={1}>
                      {a.displayName}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {a.usuariosDistintos} usuario{a.usuariosDistintos === 1 ? '' : 's'} ·{' '}
                      {a.conversaciones} conversacion{a.conversaciones === 1 ? '' : 'es'}
                      {a.totalTokens > 0 && ` · ${formatNumber(a.totalTokens)} tokens`}
                    </Text>
                  </div>
                  <Badge variant='light' color='blue'>
                    {formatNumber(a.mensajes)} mensajes
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text c='dimmed' ta='center' py='md'>
            No hay agentes con actividad en el periodo seleccionado
          </Text>
        )}
      </Card>

      <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
        <Title order={4} mb='md'>
          Quién más los usa · detalle
        </Title>
        {loading ? (
          <Skeleton height={120} />
        ) : (data?.rankingUsuarios.length ?? 0) > 0 ? (
          <Stack gap='sm'>
            {data!.rankingUsuarios.map((u, index) => (
              <Paper key={u.id} p='sm' withBorder>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                    <Badge variant='filled' color='blue' size='sm' circle>
                      {index + 1}
                    </Badge>
                    <div style={{ minWidth: 0 }}>
                      <Text size='sm' fw={600} lineClamp={1}>
                        {u.nombre}
                      </Text>
                      <Text size='xs' c='dimmed' lineClamp={1}>
                        {u.email ?? 'Sin correo'} · {u.agentesDistintos} agente
                        {u.agentesDistintos === 1 ? '' : 's'} · {u.conversaciones} conversacion
                        {u.conversaciones === 1 ? '' : 'es'}
                      </Text>
                    </div>
                  </Group>
                  <Badge variant='light' color='blue'>
                    {formatNumber(u.mensajes)} mensajes
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text c='dimmed' ta='center' py='md'>
            No hay usuarios con actividad en el periodo seleccionado
          </Text>
        )}
      </Card>
    </DashboardPageShell>
  );
}
