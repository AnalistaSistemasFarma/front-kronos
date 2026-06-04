'use client';

import type { ComponentType, ReactNode } from 'react';
import {
  Badge,
  Card,
  Divider,
  Flex,
  Group,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { resolveChartHeight, getDashboardCardPadding } from '../../../lib/dashboard/responsive';
import { ChartContainer } from '../ChartContainer';
import { useChartViewport } from '../useChartViewport';

type IconComponent = ComponentType<{ size?: number; color?: string; stroke?: number }>;

export function ActividadesSection({
  priority,
  title,
  description,
  children,
}: {
  priority: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const priorityColor =
    priority === 1 ? 'blue' : priority === 2 ? 'cyan' : priority === 3 ? 'grape' : 'gray';

  return (
    <Stack gap='md' style={{ minWidth: 0 }}>
      <Paper p={{ base: 'xs', sm: 'sm' }} radius='md' withBorder bg='gray.0'>
        <Group gap='sm' wrap='wrap' align='flex-start'>
          <Badge variant='light' color={priorityColor} size='sm' style={{ flexShrink: 0 }}>
            {priority === 1
              ? 'Lo esencial'
              : priority === 2
                ? 'Estado actual'
                : priority === 3
                  ? 'Evolución'
                  : 'Detalle operativo'}
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

export function MetricInsightCard({
  label,
  value,
  hint,
  sharePercent,
  color,
  icon: Icon,
  loading,
  chartTitle,
  chartDescription,
  chartType,
  chartData,
  chartOptions,
  emptyMessage = 'Sin datos en este periodo',
}: {
  label: string;
  value: string;
  hint: string;
  sharePercent?: number;
  color: string;
  icon: IconComponent;
  loading?: boolean;
  chartTitle: string;
  chartDescription: string;
  chartType: ChartType;
  chartData?: ChartData<ChartType>;
  chartOptions?: ChartOptions<ChartType>;
  emptyMessage?: string;
}) {
  const viewport = useChartViewport();
  const chartHeight = resolveChartHeight('kpi', viewport);

  const hasChart =
    chartData?.datasets?.some((ds) => {
      const data = ds.data as number[];
      return data.some((n) => n > 0);
    }) ?? false;

  if (loading) {
    return (
      <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
        <Skeleton height={14} width='55%' mb='sm' />
        <Skeleton height={40} width='35%' mb='md' />
        <Skeleton height={chartHeight} radius='md' />
      </Card>
    );
  }

  return (
    <Card
      shadow='sm'
      padding={getDashboardCardPadding()}
      radius='md'
      withBorder
      h='100%'
      style={{ minWidth: 0 }}
    >
      <Group justify='space-between' mb='xs' wrap='nowrap'>
        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
          {label}
        </Text>
        <ThemeIcon size='lg' radius='md' variant='light' style={{ color }}>
          <Icon size={18} />
        </ThemeIcon>
      </Group>
      <Title order={2} style={{ color, lineHeight: 1.1, fontSize: 'clamp(1.5rem, 5vw, 2rem)' }}>
        {value}
      </Title>
      {sharePercent !== undefined && (
        <Progress
          value={Math.min(100, Math.max(0, sharePercent))}
          size='sm'
          mt='md'
          mb='xs'
          styles={{ section: { backgroundColor: color } }}
        />
      )}
      <Text size='xs' c='dimmed' mb='md'>
        {hint}
      </Text>

      <Divider mb='sm' />
      <Text size='sm' fw={600} mb={2}>
        {chartTitle}
      </Text>
      <Text size='xs' c='dimmed' mb='sm'>
        {chartDescription}
      </Text>

      {hasChart && chartData && chartOptions ? (
        <ChartContainer
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
          bg='gray.0'
          style={{ borderRadius: 8 }}
        >
          <Text size='xs' c='dimmed' ta='center' px='md'>
            {emptyMessage}
          </Text>
        </Flex>
      )}
    </Card>
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
}: {
  label: string;
  value: string;
  hint: string;
  sharePercent?: number;
  color: string;
  icon: IconComponent;
  loading?: boolean;
}) {
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
    <Card shadow='sm' padding='lg' radius='md' withBorder>
      <Group justify='space-between' mb='xs' wrap='nowrap'>
        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
          {label}
        </Text>
        <ThemeIcon size='lg' radius='md' variant='light' style={{ color }}>
          <Icon size={18} />
        </ThemeIcon>
      </Group>
      <Title order={2} style={{ color, lineHeight: 1.1 }}>
        {value}
      </Title>
      {sharePercent !== undefined && (
        <Progress
          value={Math.min(100, Math.max(0, sharePercent))}
          size='sm'
          mt='md'
          mb='xs'
          styles={{ section: { backgroundColor: color } }}
          aria-label={`${label}: ${sharePercent.toFixed(0)}% del total`}
        />
      )}
      <Text size='xs' c='dimmed'>
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
}: {
  title: string;
  description?: string;
  children: ReactNode;
  height?: string | number;
}) {
  return (
    <Card
      shadow='sm'
      padding={getDashboardCardPadding()}
      radius='md'
      withBorder
      h={height}
      style={{ minWidth: 0 }}
    >
      <Title order={5} mb={description ? 4 : 'md'}>
        {title}
      </Title>
      {description && (
        <Text size='xs' c='dimmed' mb='md'>
          {description}
        </Text>
      )}
      {children}
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
