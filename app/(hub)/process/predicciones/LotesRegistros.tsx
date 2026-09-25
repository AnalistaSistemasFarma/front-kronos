'use client';

import React from 'react';
import { Badge, Card, Group, List, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

/**
 * Lotes y registros sanitarios (solo Farmalógica). Pinta el campo
 * `lotes_registros` del snapshot, que arma
 * analytics/predictivo/lotes_registros_farmalogica.py con los textos ya redactados.
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

interface ItemLista {
  nivel: Semaforo;
  frase: string;
  accion: string;
}

export interface LotesRegistrosData {
  resumen: string;
  tarjetas: Tarjeta[];
  lotes: { total_lotes: number; lista: (ItemLista & { codigo: string; lote: string })[] };
  registros: {
    sin_fecha: number;
    lista: (ItemLista & { registro: string })[];
  };
  como_leer: string[];
}

const SEMAFORO: Record<Semaforo, { color: string; emoji: string; texto: string }> = {
  verde: { color: 'green', emoji: '🟢', texto: 'Bien' },
  amarillo: { color: 'yellow', emoji: '🟡', texto: 'Revisar' },
  rojo: { color: 'red', emoji: '🔴', texto: 'Actuar' },
};

function ListaPriorizada({ items, vacio }: { items: (ItemLista & { key: string })[]; vacio: string }) {
  if (!items.length) {
    return (
      <Text size="sm" c="dimmed" mt="xs">
        {vacio}
      </Text>
    );
  }
  return (
    <Stack gap="xs" mt="xs">
      {items.map((it) => {
        const s = SEMAFORO[it.nivel];
        return (
          <Card key={it.key} withBorder radius="md" p="sm" style={{ borderLeft: `4px solid var(--mantine-color-${s.color}-6)` }}>
            <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
              <Text size="sm" fw={500}>
                {it.frase}
              </Text>
              <Badge color={s.color} variant="light" size="sm" style={{ flexShrink: 0 }}>
                {s.emoji} {s.texto}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              👉 {it.accion}
            </Text>
          </Card>
        );
      })}
    </Stack>
  );
}

export default function LotesRegistros({ data }: { data: LotesRegistrosData }) {
  return (
    <Stack gap="md">
      <Text size="md" fw={500}>
        {data.resumen}
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
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

      <Card withBorder radius="md" p="md">
        <Title order={4}>Lotes que podrían vencerse antes de venderse</Title>
        <Text size="xs" c="dimmed">
          Se revisaron {data.lotes.total_lotes} lotes con existencias en las bodegas de producto terminado aprobado.
        </Text>
        <ListaPriorizada
          items={data.lotes.lista.map((l) => ({ ...l, key: `${l.codigo}-${l.lote}` }))}
          vacio="Ningún lote en riesgo: todos alcanzan a venderse antes de su fecha de vencimiento."
        />
      </Card>

      <Card withBorder radius="md" p="md">
        <Title order={4}>Registros sanitarios por renovar</Title>
        <Text size="xs" c="dimmed">
          Productos con ventas en los últimos 12 meses cuyo registro vence en el próximo año o ya figura vencido, ordenados
          por lo que venden.
        </Text>
        <ListaPriorizada
          items={data.registros.lista.map((r) => ({ ...r, key: r.registro }))}
          vacio="Ningún registro sanitario de productos con ventas vence en los próximos 12 meses."
        />
      </Card>

      <Card withBorder radius="md" p="md">
        <Group gap="xs">
          <IconInfoCircle size={18} />
          <Title order={5}>Cómo leer esta sección</Title>
        </Group>
        <List size="sm" mt="xs" spacing={4}>
          {data.como_leer.map((c) => (
            <List.Item key={c}>{c}</List.Item>
          ))}
        </List>
      </Card>
    </Stack>
  );
}
