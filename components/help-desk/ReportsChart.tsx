'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Alert, Skeleton, Group, ActionIcon, Box } from '@mantine/core';
import { ChartContainer } from '../dashboard/ChartContainer';
import { buildSimpleLineChart } from '../../lib/charts/builders';
import { IconAlertCircle, IconRefresh, IconChartLine } from '@tabler/icons-react';

interface TimeSeriesData {
  date: string;
  count: number;
}

interface ReportsChartProps {
  className?: string;
}

export const ReportsChart: React.FC<ReportsChartProps> = ({ className = '' }) => {
  const [data, setData] = useState<TimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <Card shadow='sm' p='lg' radius='md' withBorder className={`bg-white ${className}`}>
        <Group justify='space-between' mb='md'>
          <Group>
            <IconChartLine size={24} className='text-blue-600' />
            <div>
              <Title order={3} className='text-gray-900'>
                Reportes de Casos - Últimos 30 Días
              </Title>
              <Text size='sm' color='gray.6'>
                Tendencia de casos nuevos creados diariamente
              </Text>
            </div>
          </Group>
        </Group>

        <Box mt='md'>
          <Skeleton height={300} radius='md' />
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Card shadow='sm' p='lg' radius='md' withBorder className={`bg-white ${className}`}>
        <Group justify='space-between' mb='md'>
          <Group>
            <IconChartLine size={24} className='text-blue-600' />
            <div>
              <Title order={3} className='text-gray-900'>
                Reportes de Casos - Últimos 30 Días
              </Title>
              <Text size='sm' color='gray.6'>
                Tendencia de casos nuevos creados diariamente
              </Text>
            </div>
          </Group>
          <ActionIcon
            variant='light'
            color='blue'
            onClick={fetchData}
            loading={loading}
            aria-label='Reintentar cargar datos'
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </Group>

        <Alert
          icon={<IconAlertCircle size={20} />}
          title='Error al cargar los datos'
          color='red'
          variant='light'
        >
          {error}
        </Alert>
      </Card>
    );
  }

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder className={`bg-white ${className}`}>
      <Group justify='space-between' mb='md'>
        <Group>
          <IconChartLine size={24} className='text-blue-600' />
          <div>
            <Title order={3} className='text-gray-900'>
              Reportes de Casos - Últimos 30 Días
            </Title>
            <Text size='sm' color='gray.6'>
              Tendencia de casos nuevos creados diariamente
            </Text>
          </div>
        </Group>
        <ActionIcon
          variant='light'
          color='blue'
          onClick={fetchData}
          loading={loading}
          aria-label='Actualizar datos'
        >
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>

      <Box mt='md'>
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
      </Box>

      <Group justify='center' mt='md'>
        <Text size='xs' color='gray.5'>
          Datos actualizados en tiempo real • Últimos 30 días
        </Text>
      </Group>
    </Card>
  );
};
