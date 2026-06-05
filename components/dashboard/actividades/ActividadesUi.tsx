'use client';

import type { ComponentType, ReactNode } from 'react';
import {
  Badge,
  Box,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import type { CardProps } from '@mantine/core';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { resolveChartHeight, getDashboardCardPadding } from '../../../lib/dashboard/responsive';
import {
  darkKpiGradients,
  kpiGradientIndex,
  statusKpiGradients,
  type StatusKpiGradientKey,
} from '../../../lib/theme/tokens';
import { useTheme } from '../../providers';
import { ChartContainer } from '../ChartContainer';
import { useChartViewport } from '../useChartViewport';

type IconComponent = ComponentType<{ size?: number; color?: string; stroke?: number }>;

export function DataRefreshOverlay() {
  return (
    <Box
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'inherit',
        background: 'color-mix(in srgb, var(--app-surface, #fff) 72%, transparent)',
        backdropFilter: 'blur(1px)',
      }}
    >
      <Loader size='sm' color='blue' />
    </Box>
  );
}

export function ActividadesSection({
  priority,
  title,
  description,
  children,
}: {
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const priorityColor =
    priority === 1
      ? 'blue'
      : priority === 2
        ? 'cyan'
        : priority === 3
          ? 'grape'
          : priority === 4
            ? 'gray'
            : priority === 5
              ? 'indigo'
              : 'dimmed';

  const priorityLabel =
    priority === 1
      ? 'Lo esencial'
      : priority === 2
        ? 'Estado actual'
        : priority === 3
          ? 'Desempeño'
          : priority === 4
            ? 'Demanda'
            : priority === 5
              ? 'Evolución'
              : 'Detalle operativo';

  return (
    <Stack gap='md' style={{ minWidth: 0 }}>
      <Paper p={{ base: 'xs', sm: 'sm' }} radius='md' withBorder>
        <Group gap='sm' wrap='wrap' align='flex-start'>
          <Badge variant='light' color={priorityColor} size='sm' style={{ flexShrink: 0 }}>
            {priorityLabel}
          </Badge>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Title order={4} style={{ fontSize: 'clamp(1rem, 3vw, 1.15rem)' }}>
              {title}
            </Title>
            <Text size='sm' c='dimmed'>
              {description}
            </Text>
          </Stack>
        </Group>
      </Paper>
      {children}
    </Stack>
  );
}

export function MetricInsightCard<T extends ChartType = ChartType>({
  label,
  value,
  hint,
  sharePercent,
  color,
  icon: Icon,
  loading,
  refreshing,
  chartTitle,
  chartDescription,
  chartType,
  chartData,
  chartOptions,
  emptyMessage = 'Sin datos en este periodo',
  variant = 'surface',
  compact = false,
  statusKind,
  gradientSeed,
}: {
  label: string;
  value: string;
  hint: string;
  sharePercent?: number;
  color: string;
  icon: IconComponent;
  loading?: boolean;
  refreshing?: boolean;
  chartTitle: string;
  chartDescription: string;
  chartType: T;
  chartData?: ChartData<T>;
  chartOptions?: ChartOptions<T>;
  emptyMessage?: string;
  /** surface = fondo del tema; gradient = tarjeta con degradé (Tickets / encargado) */
  variant?: 'surface' | 'gradient';
  compact?: boolean;
  statusKind?: StatusKpiGradientKey;
  gradientSeed?: string;
}) {
  const viewport = useChartViewport();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const useGradient = variant === 'gradient';
  const gradient =
    useGradient && isDark && statusKind
      ? statusKpiGradients[statusKind]
      : useGradient && isDark && gradientSeed
        ? darkKpiGradients[kpiGradientIndex(gradientSeed)]
        : undefined;
  const onGradient = Boolean(gradient);
  const chartHeight = resolveChartHeight(compact ? 'kpiCompact' : 'kpi', viewport);
  const cardPadding: CardProps['padding'] = compact
    ? ({ base: 'xs', sm: 'sm' } as unknown as CardProps['padding'])
    : getDashboardCardPadding();

  const hasChart =
    chartData?.datasets?.some((ds) => {
      const data = ds.data as number[];
      return data.some((n) => n > 0);
    }) ?? false;

  if (loading) {
    return (
      <Card shadow='sm' padding={cardPadding} radius='md' withBorder h='100%'>
        <Skeleton height={14} width='55%' mb='sm' />
        <Skeleton height={compact ? 28 : 40} width='35%' mb='md' />
        <Skeleton height={chartHeight} radius='md' />
      </Card>
    );
  }

  const valueColor = onGradient ? '#fff' : color;

  return (
    <Card
      shadow={onGradient ? undefined : 'sm'}
      padding={cardPadding}
      radius='md'
      withBorder={!onGradient}
      h='100%'
      className={
        onGradient ? 'dashboard-kpi-gradient' : compact ? 'dashboard-chart-card' : undefined
      }
      style={{
        minWidth: 0,
        position: 'relative',
        ...(onGradient
          ? {
              background: gradient,
              border: 'none',
              boxShadow: 'var(--app-card-shadow)',
            }
          : {}),
      }}
    >
      {refreshing ? <DataRefreshOverlay /> : null}
      <Group justify='space-between' mb={compact ? 4 : 'xs'} wrap='nowrap'>
        <Text
          size='xs'
          tt='uppercase'
          fw={600}
          c={onGradient ? undefined : 'dimmed'}
          style={onGradient ? { color: 'rgba(255,255,255,0.9)' } : undefined}
        >
          {label}
        </Text>
        <ThemeIcon
          size={compact ? 'md' : 'lg'}
          radius='md'
          variant={onGradient ? 'white' : 'light'}
          style={
            onGradient
              ? { color: '#fff', background: 'rgba(255,255,255,0.22)' }
              : { color }
          }
        >
          <Icon size={compact ? 16 : 18} />
        </ThemeIcon>
      </Group>
      <Title
        order={compact ? 3 : 2}
        style={{
          color: valueColor,
          lineHeight: 1.1,
          fontSize: compact ? 'clamp(1.2rem, 4vw, 1.45rem)' : 'clamp(1.5rem, 5vw, 2rem)',
        }}
      >
        {value}
      </Title>
      {sharePercent !== undefined && (
        <Progress
          value={Math.min(100, Math.max(0, sharePercent))}
          size={compact ? 'xs' : 'sm'}
          mt={compact ? 'sm' : 'md'}
          mb='xs'
          styles={{
            section: { backgroundColor: onGradient ? 'rgba(255,255,255,0.92)' : color },
            root: onGradient
              ? { backgroundColor: 'rgba(255,255,255,0.25)' }
              : { backgroundColor: 'var(--app-border-subtle)' },
          }}
        />
      )}
      <Text
        size='xs'
        mb={compact ? 'sm' : 'md'}
        c={onGradient ? undefined : 'dimmed'}
        style={onGradient ? { color: 'rgba(255,255,255,0.82)' } : undefined}
      >
        {hint}
      </Text>

      <Divider mb={compact ? 'xs' : 'sm'} color={onGradient ? 'rgba(255,255,255,0.25)' : undefined} />

      {onGradient ? (
        <Paper
          p='sm'
          radius='md'
          style={{
            background: 'rgba(0,0,0,0.22)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Text size='sm' fw={600} mb={2} c='white'>
            {chartTitle}
          </Text>
          <Text size='xs' mb='sm' style={{ color: 'rgba(255,255,255,0.75)' }}>
            {chartDescription}
          </Text>
          {hasChart && chartData && chartOptions ? (
            <ChartContainer<T>
              type={chartType}
              data={chartData}
              options={chartOptions}
              height={chartHeight}
            />
          ) : (
            <Flex
              h={chartHeight}
              align='center'
              justify='center'
              style={{ borderRadius: 8, background: 'rgba(255,255,255,0.06)' }}
            >
              <Text size='xs' ta='center' px='md' style={{ color: 'rgba(255,255,255,0.7)' }}>
                {emptyMessage}
              </Text>
            </Flex>
          )}
        </Paper>
      ) : (
        <>
          <Text size={compact ? 'xs' : 'sm'} fw={600} mb={2}>
            {chartTitle}
          </Text>
          <Text size='xs' c='dimmed' mb={compact ? 'xs' : 'sm'}>
            {chartDescription}
          </Text>
          {hasChart && chartData && chartOptions ? (
            <ChartContainer<T>
              type={chartType}
              data={chartData}
              options={chartOptions}
              height={chartHeight}
            />
          ) : (
            <Flex
              h={chartHeight}
              align='center'
              justify='center'
              style={{
                borderRadius: 8,
                background: 'var(--app-surface-raised)',
              }}
            >
              <Text size='xs' c='dimmed' ta='center' px='md'>
                {emptyMessage}
              </Text>
            </Flex>
          )}
        </>
      )}
    </Card>
  );
}

/** Tarjeta de conteo por estado (gradiente llamativo en oscuro, como KPIs de Tickets). */
export function StatusMetricGradientCard({
  label,
  value,
  icon: Icon,
  kind,
  accentColor,
}: {
  label: string;
  value: number;
  icon: IconComponent;
  kind: StatusKpiGradientKey;
  accentColor: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const gradient = statusKpiGradients[kind];

  return (
    <Paper
      p='sm'
      radius='md'
      className={isDark ? 'dashboard-kpi-gradient' : undefined}
      style={
        isDark
          ? {
              background: gradient,
              border: 'none',
              boxShadow: 'var(--app-card-shadow)',
            }
          : {
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}55`,
            }
      }
    >
      <Group gap='xs' mb={4} wrap='nowrap'>
        <ThemeIcon
          size='sm'
          radius='md'
          variant={isDark ? 'white' : 'light'}
          style={
            isDark
              ? { color: '#fff', background: 'rgba(255,255,255,0.22)' }
              : { color: accentColor, background: `${accentColor}22` }
          }
        >
          <Icon size={14} />
        </ThemeIcon>
        <Text
          size='xs'
          fw={600}
          tt='uppercase'
          style={isDark ? { color: 'rgba(255,255,255,0.9)' } : { color: accentColor }}
        >
          {label}
        </Text>
      </Group>
      <Text
        fw={800}
        size='xl'
        style={{ color: isDark ? '#fff' : accentColor, lineHeight: 1.1 }}
      >
        {value}
      </Text>
    </Paper>
  );
}

export function KpiStatCard({
  label,
  value,
  hint,
  sharePercent,
  color,
  icon: Icon,
  loading,
  refreshing,
}: {
  label: string;
  value: string;
  hint: string;
  sharePercent?: number;
  color: string;
  icon: IconComponent;
  loading?: boolean;
  refreshing?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const gradient = isDark ? darkKpiGradients[kpiGradientIndex(label)] : undefined;
  const onGradient = Boolean(gradient);

  if (loading) {
    return (
      <Card shadow='sm' padding='lg' radius='md' withBorder>
        <Skeleton height={14} width='60%' mb='sm' />
        <Skeleton height={36} width='40%' mb='md' />
        <Skeleton height={8} radius='xl' />
      </Card>
    );
  }

  return (
    <Card
      shadow={onGradient ? undefined : 'sm'}
      padding='lg'
      radius='md'
      withBorder={!onGradient}
      className={onGradient ? 'dashboard-kpi-gradient' : undefined}
      style={{
        position: 'relative',
        ...(onGradient
          ? {
              background: gradient,
              border: 'none',
              boxShadow: 'var(--app-card-shadow)',
            }
          : undefined),
      }}
    >
      {refreshing ? <DataRefreshOverlay /> : null}
      <Group justify='space-between' mb='xs' wrap='nowrap'>
        <Text
          size='xs'
          tt='uppercase'
          fw={600}
          c={onGradient ? undefined : 'dimmed'}
          style={onGradient ? { color: 'rgba(255,255,255,0.88)' } : undefined}
        >
          {label}
        </Text>
        <ThemeIcon
          size='lg'
          radius='md'
          variant={onGradient ? 'white' : 'light'}
          style={
            onGradient
              ? { color: '#fff', background: 'rgba(255,255,255,0.2)' }
              : { color }
          }
        >
          <Icon size={18} />
        </ThemeIcon>
      </Group>
      <Title
        order={2}
        style={{ color: onGradient ? '#fff' : color, lineHeight: 1.1 }}
      >
        {value}
      </Title>
      {sharePercent !== undefined && (
        <Progress
          value={Math.min(100, Math.max(0, sharePercent))}
          size='sm'
          mt='md'
          mb='xs'
          styles={{
            section: { backgroundColor: onGradient ? 'rgba(255,255,255,0.92)' : color },
            root: onGradient ? { backgroundColor: 'rgba(255,255,255,0.25)' } : undefined,
          }}
          aria-label={`${label}: ${sharePercent.toFixed(0)}% del total`}
        />
      )}
      <Text
        size='xs'
        c={onGradient ? undefined : 'dimmed'}
        style={onGradient ? { color: 'rgba(255,255,255,0.82)' } : undefined}
      >
        {hint}
      </Text>
    </Card>
  );
}

export function ChartCard({
  title,
  description,
  children,
  height = '100%',
  refreshing,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  height?: string | number;
  refreshing?: boolean;
}) {
  return (
    <Card
      className='dashboard-chart-card'
      shadow='sm'
      padding={getDashboardCardPadding()}
      radius='md'
      withBorder
      h={height}
      style={{ minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
    >
      {refreshing ? <DataRefreshOverlay /> : null}
      <Title order={5} mb={description ? 4 : 'md'} style={{ flexShrink: 0 }}>
        {title}
      </Title>
      {description && (
        <Text size='xs' c='dimmed' mb='md' style={{ flexShrink: 0 }}>
          {description}
        </Text>
      )}
      <Box className='dashboard-chart-slot' style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {children}
      </Box>
    </Card>
  );
}

export type StatusInsightItem = {
  key: string;
  label: string;
  count: number;
  percent: number;
  color: string;
};

export function StatusInsightPanel({
  items,
  total,
  loading,
}: {
  items: StatusInsightItem[];
  total: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card shadow='sm' padding='lg' radius='md' withBorder h='100%'>
        <Skeleton height={20} width='70%' mb='lg' />
        <Stack gap='md'>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={48} radius='md' />
          ))}
        </Stack>
      </Card>
    );
  }

  const topPending = items.find((i) => i.label.toLowerCase().includes('pendiente'));
  const topDone = items.find((i) => i.label.toLowerCase().includes('complet'));

  return (
    <Card shadow='sm' padding='lg' radius='md' withBorder h='100%'>
      <Title order={5} mb={4}>
        Lectura rápida
      </Title>
      <Text size='xs' c='dimmed' mb='lg'>
        Proporción de cada estado sobre {total} tareas del periodo
      </Text>
      <Stack gap='md'>
        {items.length === 0 ? (
          <Text size='sm' c='dimmed' ta='center' py='xl'>
            Sin tareas en este periodo
          </Text>
        ) : (
          items.map((item) => (
            <div key={item.key}>
              <Group justify='space-between' mb={4}>
                <Text size='sm' fw={500}>
                  {item.label}
                </Text>
                <Text size='sm' fw={700} style={{ color: item.color }}>
                  {item.count} · {item.percent.toFixed(1)}%
                </Text>
              </Group>
              <Progress
                value={item.percent}
                size='md'
                radius='xl'
                styles={{ section: { backgroundColor: item.color } }}
              />
            </div>
          ))
        )}
      </Stack>
      {total > 0 && topPending && topDone && topPending.percent > topDone.percent && (
        <Paper mt='lg' p='sm' radius='md' bg='orange.0' withBorder>
          <Text size='xs' c='orange.9'>
            Hay más tareas pendientes que completadas. Conviene revisar asignaciones y plazos.
          </Text>
        </Paper>
      )}
    </Card>
  );
}

export function RankedListCard({
  title,
  description,
  items,
  formatValue,
  emptyMessage,
}: {
  title: string;
  description: string;
  items: { name: string; value: number }[];
  formatValue: (n: number) => string;
  emptyMessage: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ChartCard title={title} description={description}>
      {items.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='xl'>
          {emptyMessage}
        </Text>
      ) : (
        <Stack gap='sm'>
          {items.map((item, index) => (
            <Paper key={item.name} p='sm' withBorder radius='md'>
              <Group justify='space-between' mb={6} wrap='nowrap'>
                <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                  <Badge variant='filled' color='blue' size='sm' circle>
                    {index + 1}
                  </Badge>
                  <Text size='sm' fw={500} truncate='end'>
                    {item.name}
                  </Text>
                </Group>
                <Badge variant='light'>{formatValue(item.value)}</Badge>
              </Group>
              <Progress value={(item.value / max) * 100} size='sm' radius='xl' color='blue' />
            </Paper>
          ))}
        </Stack>
      )}
    </ChartCard>
  );
}
