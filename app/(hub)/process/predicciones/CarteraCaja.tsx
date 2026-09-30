'use client';

import React from 'react';
import { Alert, Badge, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarStats,
  IconCash,
  IconChecklist,
  IconInfoCircle,
  IconTarget,
  IconUsers,
} from '@tabler/icons-react';
import { Bar } from 'react-chartjs-2';
import '../../../../lib/charts/register';
import {
  Accion,
  ComoLeer,
  KpiCard,
  ListaAlertas,
  SEMAFORO,
  Seccion,
  SemaforoPill,
  tonoClase,
  usePrediccionesChartTheme,
  type Semaforo,
  type TarjetaKpi,
} from './ui';

/**
 * Cartera y flujo de caja (solo Farmalógica por ahora). Pinta el campo
 * `cartera` del snapshot, que arma analytics/predictivo/cartera_farmalogica.py
 * con los textos ya redactados.
 */

export interface Cartera {
  generado: string;
  fuente: { pagos_hasta: string; bancos_hasta: string | null };
  resumen: string;
  tarjetas: TarjetaKpi[];
  cartera: { total: number; vencida: number; edades: { id: string; tramo: string; monto: number }[] };
  recaudo: { confiabilidad: string };
  semanas: {
    semana: number;
    etiqueta: string;
    entradas: number;
    otras_entradas?: number;
    salidas?: number;
    neto?: number;
    acumulado?: number;
  }[];
  flujo: { semaforo: Semaforo; frase: string; aviso: string } | null;
  top_riesgo: { cliente: string; monto_riesgo: number; frase: string; nota: string; grupo: boolean }[];
  mes_pasado: { semaforo: Semaforo; frase: string; detalle: string } | null;
  alertas: { prioridad: 'alta' | 'media' | 'baja'; titulo: string; accion: string }[];
  eps: { titulo: string; frase: string };
  como_leer: string[];
}

/** Color del aviso de flujo de caja según el semáforo (Alert de Mantine). */
const ALERTA_FLUJO: Record<Semaforo, string> = { verde: 'green', amarillo: 'yellow', rojo: 'red' };

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const millones = (v: number) => `$${fmt.format(v / 1e6)} M`;

export default function CarteraCaja({ data }: { data: Cartera }) {
  const chartTheme = usePrediccionesChartTheme();
  const { series } = chartTheme;
  const hayFlujo = data.semanas.some((s) => s.salidas != null);
  const chartData = {
    labels: data.semanas.map((s) => s.etiqueta),
    datasets: [
      { label: 'Recaudo esperado', data: data.semanas.map((s) => s.entradas), backgroundColor: series.recaudo, stack: 'e' },
      ...(hayFlujo
        ? [
            {
              label: 'Otras entradas típicas',
              data: data.semanas.map((s) => s.otras_entradas ?? 0),
              backgroundColor: series.otrasEntradas,
              stack: 'e',
            },
            { label: 'Salidas típicas', data: data.semanas.map((s) => -(s.salidas ?? 0)), backgroundColor: series.salidas, stack: 's' },
          ]
        : []),
    ],
  };

  const mesPasado = data.mes_pasado;

  return (
    <Stack gap="lg" className="pb-6">
      <Card p="lg" radius="md" withBorder>
        <Title order={3} className="pred-hero__title">
          Cartera y caja
        </Title>
        <Text size="md" mt={8} fw={500} maw={880}>
          {data.resumen}
        </Text>
        <Text size="xs" c="dimmed" mt={8}>
          Actualizado el {data.generado} · pagos en SAP hasta {data.fuente.pagos_hasta}
          {data.fuente.bancos_hasta ? ` · bancos hasta ${data.fuente.bancos_hasta}` : ''} · piloto
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 5 }} spacing="md">
        {data.tarjetas.map((t) => (
          <KpiCard key={t.id} t={t} />
        ))}
      </SimpleGrid>

      {mesPasado && (
        <Seccion
          titulo="¿Cómo le fue al pronóstico de recaudo el mes pasado?"
          icono={<IconTarget size={20} />}
          extra={<SemaforoPill semaforo={mesPasado.semaforo} />}
          className={`pred-accent ${tonoClase(SEMAFORO[mesPasado.semaforo].tono)}`}
        >
          <Text size="md" fw={500}>
            {mesPasado.frase}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {mesPasado.detalle}
          </Text>
        </Seccion>
      )}

      <Seccion titulo="Flujo de caja: próximas 13 semanas" icono={<IconCash size={20} />}>
        {data.flujo ? (
          <Alert
            color={ALERTA_FLUJO[data.flujo.semaforo]}
            variant="light"
            radius="md"
            icon={<IconAlertTriangle size={18} />}
            title={<SemaforoPill semaforo={data.flujo.semaforo} />}
          >
            {data.flujo.frase}
          </Alert>
        ) : (
          <Text size="sm" c="dimmed">
            No hay datos de bancos suficientes: se muestra solo el recaudo esperado.
          </Text>
        )}
        <div style={{ height: chartTheme.compacto ? 260 : 300 }} className="pred-chart mt-3">
          <Bar
            data={chartData}
            options={chartTheme.tematizar<'bar'>({
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: chartTheme.compacto ? 10 : 16 } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${millones(Math.abs(Number(ctx.parsed.y)))}` } },
              },
              scales: {
                x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: chartTheme.compacto ? 7 : 13 } },
                y: { stacked: true, ticks: { callback: (v) => millones(Number(v)) } },
              },
            })}
          />
        </div>
        {hayFlujo && (
          <Table.ScrollContainer minWidth={520} mt="sm">
            <Table striped highlightOnHover fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Semana</Table.Th>
                  <Table.Th ta="right">Entradas</Table.Th>
                  <Table.Th ta="right">Salidas</Table.Th>
                  <Table.Th ta="right">Diferencia</Table.Th>
                  <Table.Th ta="right">Acumulado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.semanas.map((s) => {
                  const negativo = (s.acumulado ?? 0) < 0;
                  return (
                    <Table.Tr key={s.semana}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{s.etiqueta}</Table.Td>
                      <Table.Td ta="right">{millones(s.entradas + (s.otras_entradas ?? 0))}</Table.Td>
                      <Table.Td ta="right">{millones(s.salidas ?? 0)}</Table.Td>
                      <Table.Td ta="right">{millones(s.neto ?? 0)}</Table.Td>
                      <Table.Td ta="right" fw={600} className={negativo ? 'pred-text--danger' : undefined}>
                        {millones(s.acumulado ?? 0)}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data.flujo && (
          <Text size="xs" c="dimmed" mt="xs">
            {data.flujo.aviso}
          </Text>
        )}
      </Seccion>

      <Seccion titulo="Cartera en riesgo: con quién gestionar el cobro primero" icono={<IconUsers size={20} />}>
        <Stack gap="md">
          {data.top_riesgo.map((c, i) => (
            <div key={i}>
              <Group gap="xs" wrap="wrap">
                <Text size="sm" fw={600}>
                  {i + 1}. {c.cliente}
                </Text>
                <Badge color="red" variant="light" size="sm">
                  {millones(c.monto_riesgo)} en riesgo
                </Badge>
                {c.grupo && (
                  <Badge color="grape" variant="light" size="sm">
                    Empresa del grupo
                  </Badge>
                )}
              </Group>
              <div style={{ marginTop: 2 }}>
                <Accion>{c.frase}</Accion>
              </div>
              <Text size="xs" c="dimmed">
                {c.nota}
              </Text>
            </div>
          ))}
        </Stack>
      </Seccion>

      <Seccion titulo="Antigüedad de la cartera" icono={<IconCalendarStats size={20} />}>
        <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="xs">
          {data.cartera.edades.map((e) => (
            <div key={e.id} className="pred-tramo">
              <Text size="xs" c="dimmed">
                {e.tramo}
              </Text>
              <Text size="sm" fw={600}>
                {millones(e.monto)}
              </Text>
            </div>
          ))}
        </SimpleGrid>
      </Seccion>

      {data.alertas.length > 0 && (
        <Seccion titulo="Qué hacer ahora" icono={<IconChecklist size={20} />}>
          <ListaAlertas alertas={data.alertas} />
        </Seccion>
      )}

      <Alert color="gray" variant="light" radius="md" icon={<IconInfoCircle size={18} />} title={data.eps.titulo}>
        {data.eps.frase}
      </Alert>

      <ComoLeer items={data.como_leer} />
    </Stack>
  );
}
