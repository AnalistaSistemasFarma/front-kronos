'use client';

import React from 'react';
import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCertificate, IconPackages } from '@tabler/icons-react';
import {
  Accion,
  ComoLeer,
  KpiCard,
  SEMAFORO,
  Seccion,
  SemaforoPill,
  tonoClase,
  type Semaforo,
  type TarjetaKpi,
} from './ui';

/**
 * Lotes y registros sanitarios (solo Farmalógica). Pinta el campo
 * `lotes_registros` del snapshot, que arma
 * analytics/predictivo/lotes_registros_farmalogica.py con los textos ya redactados.
 */

interface ItemLista {
  nivel: Semaforo;
  frase: string;
  accion: string;
}

export interface LotesRegistrosData {
  resumen: string;
  tarjetas: TarjetaKpi[];
  lotes: { total_lotes: number; lista: (ItemLista & { codigo: string; lote: string })[] };
  registros: {
    sin_fecha: number;
    lista: (ItemLista & { registro: string })[];
  };
  como_leer: string[];
}

function ListaPriorizada({ items, vacio }: { items: (ItemLista & { key: string })[]; vacio: string }) {
  if (!items.length) {
    return (
      <Text size="sm" c="dimmed">
        {vacio}
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {items.map((it) => (
        <Card
          key={it.key}
          withBorder
          radius="md"
          p="sm"
          className={`pred-accent ${tonoClase(SEMAFORO[it.nivel].tono)}`}
        >
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text size="sm" fw={500} style={{ minWidth: 0 }}>
              {it.frase}
            </Text>
            <SemaforoPill semaforo={it.nivel} />
          </Group>
          <div style={{ marginTop: 4 }}>
            <Accion size="xs">{it.accion}</Accion>
          </div>
        </Card>
      ))}
    </Stack>
  );
}

export default function LotesRegistros({ data }: { data: LotesRegistrosData }) {
  return (
    <Stack gap="lg" className="pb-6">
      <Card p="lg" radius="md" withBorder>
        <Text size="md" fw={500} maw={880}>
          {data.resumen}
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {data.tarjetas.map((t) => (
          <KpiCard key={t.id} t={t} />
        ))}
      </SimpleGrid>

      <Seccion
        titulo="Lotes que podrían vencerse antes de venderse"
        subtitulo={`Se revisaron ${data.lotes.total_lotes} lotes con existencias en las bodegas de producto terminado aprobado.`}
        icono={<IconPackages size={20} />}
      >
        <ListaPriorizada
          items={data.lotes.lista.map((l) => ({ ...l, key: `${l.codigo}-${l.lote}` }))}
          vacio="Ningún lote en riesgo: todos alcanzan a venderse antes de su fecha de vencimiento."
        />
      </Seccion>

      <Seccion
        titulo="Registros sanitarios por renovar"
        subtitulo="Productos con ventas en los últimos 12 meses cuyo registro vence en el próximo año o ya figura vencido, ordenados por lo que venden."
        icono={<IconCertificate size={20} />}
      >
        <ListaPriorizada
          items={data.registros.lista.map((r) => ({ ...r, key: r.registro }))}
          vacio="Ningún registro sanitario de productos con ventas vence en los próximos 12 meses."
        />
      </Seccion>

      <ComoLeer titulo="Cómo leer esta sección" items={data.como_leer} />
    </Stack>
  );
}
