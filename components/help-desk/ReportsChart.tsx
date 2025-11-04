'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Alert, Skeleton, Group, ActionIcon, Box } from '@mantine/core';
import { LineChart } from '@mantine/charts';
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

  const chartData = data.map((item) => ({
    date: formatDate(item.date),
    'Casos Nuevos': item.count,
  }));

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
        <LineChart
          h={300}
          data={chartData}
          dataKey='date'
          series={[
            {
              name: 'Casos Nuevos',
              color: 'blue.6',
            },
          ]}
          curveType='monotone'
          gridAxis='xy'
          withDots={false}
          withTooltip
          tooltipAnimationDuration={200}
          xAxisProps={{
            angle: -45,
            textAnchor: 'end',
            height: 60,
            interval: 'preserveStartEnd',
          }}
          yAxisProps={{
            domain: ['dataMin', 'dataMax'],
          }}
          tooltipProps={{
            content: ({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className='bg-white border border-gray-200 rounded-md shadow-lg p-3'>
                    <Text size='sm' fw={600} className='text-gray-900'>
                      {label}
                    </Text>
                    <Text size='sm' color='blue.6'>
                      Casos nuevos: {data['Casos Nuevos']}
                    </Text>
                  </div>
                );
              }
              return null;
            },
          }}
        />
      </Box>

      <Group justify='center' mt='md'>
        <Text size='xs' color='gray.5'>
          Datos actualizados en tiempo real • Últimos 30 días
        </Text>
      </Group>
    </Card>
  );
};
