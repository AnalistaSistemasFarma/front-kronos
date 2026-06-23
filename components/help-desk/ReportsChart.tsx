'use client';

import { useState, useEffect, type ReactNode } from 'react';
import {
  Card,
  Title,
  Text,
  Alert,
  Skeleton,
  Group,
  ActionIcon,
  Box,
  Collapse,
  Badge,
} from '@mantine/core';
import { ChartContainer } from '../dashboard/ChartContainer';
import { buildSimpleLineChart } from '../../lib/charts/builders';
import {
  IconAlertCircle,
  IconRefresh,
  IconChartLine,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

interface TimeSeriesData {
  date: string;
  count: number;
}

interface ReportsChartProps {
  className?: string;
}

function ReportsChartHeader({
  expanded,
  onToggle,
  onRefresh,
  loading,
  totalCases,
}: {
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  loading: boolean;
  totalCases?: number;
}) {
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
        <IconChartLine size={24} className='text-blue-600' style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <Group gap='xs' wrap='nowrap'>
            <Title order={3} className='text-gray-900'>
              Reportes de Casos - Últimos 30 Días
            </Title>
            {!expanded && totalCases !== undefined && (
              <Badge variant='light' color='blue' size='sm'>
                {totalCases} casos
              </Badge>
            )}
          </Group>
          <Text size='sm' color='gray.6' lineClamp={expanded ? undefined : 1}>
            Tendencia de casos nuevos creados diariamente
          </Text>
        </div>
      </Group>
      <Group gap='xs' wrap='nowrap' style={{ flexShrink: 0 }}>
        <ActionIcon
          variant='light'
          color='blue'
          onClick={onRefresh}
          loading={loading}
          aria-label='Actualizar datos'
        >
          <IconRefresh size={16} />
        </ActionIcon>
        <ActionIcon
          variant='light'
          color='blue'
          onClick={onToggle}
          aria-label={expanded ? 'Ocultar gráfico' : 'Mostrar gráfico'}
          aria-expanded={expanded}
        >
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </ActionIcon>
      </Group>
    </Group>
  );
}

export const ReportsChart: React.FC<ReportsChartProps> = ({ className = '' }) => {
  const [data, setData] = useState<TimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/help-desk/view_cases_dashboard');
      if (!response.ok) {
        throw new Error('Error al cargar los datos del gráfico');
      }

      const result = await response.json();
      setData(result.timeSeriesData || []);
    } catch (err) {
      console.error('Error fetching chart data:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', {
      month: 'short',
      day: 'numeric',
    });
  };

  const linePoints = data.map((item) => ({
    label: formatDate(item.date),
    value: item.count,
  }));

  const lineChart =
    linePoints.length > 0
      ? buildSimpleLineChart(linePoints, '#2563eb', 'Casos nuevos')
      : null;

  const totalCases = data.reduce((sum, item) => sum + item.count, 0);

  const renderBody = (content: ReactNode) => (
    <Collapse in={expanded}>
      <Box mt='md'>{content}</Box>
    </Collapse>
  );

  if (loading) {
    return (
      <Card shadow='sm' p='lg' radius='md' withBorder className={className}>
        <ReportsChartHeader
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          onRefresh={fetchData}
          loading={loading}
        />
        {renderBody(<Skeleton height={300} radius='md' />)}
      </Card>
    );
  }

  if (error) {
    return (
      <Card shadow='sm' p='lg' radius='md' withBorder className={className}>
        <ReportsChartHeader
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          onRefresh={fetchData}
          loading={loading}
        />
        {renderBody(
          <Alert
            icon={<IconAlertCircle size={20} />}
            title='Error al cargar los datos'
            color='red'
            variant='light'
          >
            {error}
          </Alert>
        )}
      </Card>
    );
  }

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder className={className}>
      <ReportsChartHeader
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        onRefresh={fetchData}
        loading={loading}
        totalCases={totalCases}
      />

      {renderBody(
        <>
          {lineChart ? (
            <ChartContainer
              type='line'
              data={lineChart.data}
              options={lineChart.options}
              height={300}
            />
          ) : (
            <Text size='sm' c='dimmed' ta='center' py='xl'>
              No hay datos para mostrar
            </Text>
          )}

          <Group justify='center' mt='md'>
            <Text size='xs' color='gray.5'>
              Datos actualizados en tiempo real • Últimos 30 días
            </Text>
          </Group>
        </>
      )}
    </Card>
  );
};
