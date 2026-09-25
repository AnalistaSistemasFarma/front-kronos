'use client';

import React from 'react';
import { Alert, Badge, Card, Group, List, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconBulb, IconInfoCircle } from '@tabler/icons-react';
import { Bar } from 'react-chartjs-2';
import '../../../../lib/charts/register';

/**
 * Cartera y flujo de caja (solo Farmalógica por ahora). Pinta el campo
 * `cartera` del snapshot, que arma analytics/predictivo/cartera_farmalogica.py
 * con los textos ya redactados.
 */

type Semaforo = 'verde' | 'amarillo' | 'rojo';

interface Tarjeta {
  id: string;
  titulo: string;
  valor: string;
  detalle: string;
  semaforo: Semaforo;
  frase: string;
}

export interface Cartera {
  generado: string;
  fuente: { pagos_hasta: string; bancos_hasta: string | null };
  resumen: string;
  tarjetas: Tarjeta[];
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

const SEMAFORO: Record<Semaforo, { color: string; emoji: string; texto: string }> = {
  verde: { color: 'green', emoji: '🟢', texto: 'Bien' },
  amarillo: { color: 'yellow', emoji: '🟡', texto: 'Revisar' },
  rojo: { color: 'red', emoji: '🔴', texto: 'Actuar' },
};

const PRIORIDAD = {
  alta: { color: 'red', texto: 'Urgente' },
  media: { color: 'yellow', texto: 'Pronto' },
  baja: { color: 'gray', texto: 'Informativo' },
} as const;

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const millones = (v: number) => `$${fmt.format(v / 1e6)} M`;

export default function CarteraCaja({ data }: { data: Cartera }) {
  const hayFlujo = data.semanas.some((s) => s.salidas != null);
  const chartData = {
    labels: data.semanas.map((s) => s.etiqueta),
    datasets: [
      { label: 'Recaudo esperado', data: data.semanas.map((s) => s.entradas), backgroundColor: '#1c7ed6', stack: 'e' },
      ...(hayFlujo
        ? [
            {
              label: 'Otras entradas típicas',
              data: data.semanas.map((s) => s.otras_entradas ?? 0),
              backgroundColor: '#74c0fc',
              stack: 'e',
            },
            { label: 'Salidas típicas', data: data.semanas.map((s) => -(s.salidas ?? 0)), backgroundColor: '#fa5252', stack: 's' },
          ]
        : []),
    ],
  };

  return (
    <Stack gap="lg" className="pb-6">
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Title order={3}>Cartera y caja</Title>
        <Text size="lg" mt={6} fw={500}>
          {data.resumen}
        </Text>
        <Text size="xs" c="dimmed" mt={6}>
          Actualizado el {data.generado} · pagos en SAP hasta {data.fuente.pagos_hasta}
          {data.fuente.bancos_hasta ? ` · bancos hasta ${data.fuente.bancos_hasta}` : ''} · piloto
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 5 }} spacing="md">
        {data.tarjetas.map((t) => {
          const s = SEMAFORO[t.semaforo];
          return (
            <Card key={t.id} withBorder radius="md" p="md" style={{ borderLeft: `6px solid var(--mantine-color-${s.color}-6)` }}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text size="sm" c="dimmed" fw={600}>
                  {t.titulo}
                </Text>
                <Badge color={s.color} variant="light" size="sm">
                  {s.emoji} {s.texto}
                </Badge>
              </Group>
              <Text fz={24} fw={700} mt={4}>
                {t.valor}
              </Text>
              <Text size="sm">{t.frase}</Text>
              <Text size="xs" c="dimmed" mt={4}>
                {t.detalle}
              </Text>
            </Card>
          );
        })}
      </SimpleGrid>

      {data.mes_pasado && (
        <Card
          withBorder
          radius="md"
          p="md"
          style={{ borderLeft: `6px solid var(--mantine-color-${SEMAFORO[data.mes_pasado.semaforo].color}-6)` }}
        >
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Title order={4}>¿Cómo le fue al pronóstico de recaudo el mes pasado?</Title>
            <Badge color={SEMAFORO[data.mes_pasado.semaforo].color} variant="light" size="sm">
              {SEMAFORO[data.mes_pasado.semaforo].emoji} {SEMAFORO[data.mes_pasado.semaforo].texto}
            </Badge>
          </Group>
          <Text size="md" mt={6} fw={500}>
            {data.mes_pasado.frase}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {data.mes_pasado.detalle}
          </Text>
        </Card>
      )}

      <Card withBorder radius="md" p="md">
        <Title order={4}>Flujo de caja: próximas 13 semanas</Title>
        {data.flujo ? (
          <Alert
            color={SEMAFORO[data.flujo.semaforo].color}
            variant="light"
            radius="md"
            mt="xs"
            icon={<IconAlertTriangle size={18} />}
          >
            {SEMAFORO[data.flujo.semaforo].emoji} {data.flujo.frase}
          </Alert>
        ) : (
          <Text size="sm" c="dimmed">
            No hay datos de bancos suficientes: se muestra solo el recaudo esperado.
          </Text>
        )}
        <div style={{ height: 300 }} className="mt-3">
          <Bar
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${millones(Math.abs(Number(ctx.parsed.y)))}` } },
              },
              scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => millones(Number(v)) } } },
            }}
          />
        </div>
        {hayFlujo && (
          <Table.ScrollContainer minWidth={520} mt="sm">
            <Table striped fz="xs">
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
                {data.semanas.map((s) => (
                  <Table.Tr key={s.semana}>
                    <Table.Td>{s.etiqueta}</Table.Td>
                    <Table.Td ta="right">{millones(s.entradas + (s.otras_entradas ?? 0))}</Table.Td>
                    <Table.Td ta="right">{millones(s.salidas ?? 0)}</Table.Td>
                    <Table.Td ta="right">{millones(s.neto ?? 0)}</Table.Td>
                    <Table.Td ta="right" c={(s.acumulado ?? 0) < 0 ? 'red' : undefined} fw={600}>
                      {(s.acumulado ?? 0) < 0 ? '🔴 ' : ''}
                      {millones(s.acumulado ?? 0)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data.flujo && (
          <Text size="xs" c="dimmed" mt="xs">
            {data.flujo.aviso}
          </Text>
        )}
      </Card>

      <Card withBorder radius="md" p="md">
        <Title order={4} mb="sm">
          Cartera en riesgo: con quién gestionar el cobro primero
        </Title>
        <Stack gap="xs">
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
              <Text size="sm">👉 {c.frase}</Text>
              <Text size="xs" c="dimmed">
                {c.nota}
              </Text>
            </div>
          ))}
        </Stack>
      </Card>

      <Card withBorder radius="md" p="md">
        <Title order={4} mb="sm">
          Antigüedad de la cartera
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="xs">
          {data.cartera.edades.map((e) => (
            <div key={e.id}>
              <Text size="xs" c="dimmed">
                {e.tramo}
              </Text>
              <Text size="sm" fw={600}>
                {millones(e.monto)}
              </Text>
            </div>
          ))}
        </SimpleGrid>
      </Card>

      {data.alertas.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Title order={4} mb="sm">
            Qué hacer ahora
          </Title>
          <Stack gap="sm">
            {data.alertas.map((a, i) => {
              const p = PRIORIDAD[a.prioridad];
              return (
                <Alert
                  key={i}
                  color={p.color}
                  variant="light"
                  radius="md"
                  title={
                    <Group gap="xs">
                      <Badge color={p.color} size="sm">
                        {p.texto}
                      </Badge>
                      <Text size="sm" fw={600} component="span">
                        {a.titulo}
                      </Text>
                    </Group>
                  }
                >
                  <Text size="sm">👉 {a.accion}</Text>
                </Alert>
              );
            })}
          </Stack>
        </Card>
      )}

      <Alert color="gray" variant="light" radius="md" icon={<IconInfoCircle size={18} />} title={data.eps.titulo}>
        {data.eps.frase}
      </Alert>

      <Card withBorder radius="md" p="md">
        <Group gap="xs" mb="xs">
          <IconBulb size={20} />
          <Title order={4}>¿Cómo leer esto?</Title>
        </Group>
        <List size="sm" spacing={4}>
          {data.como_leer.map((t, i) => (
            <List.Item key={i}>{t}</List.Item>
          ))}
        </List>
      </Card>
    </Stack>
  );
}
