'use client';

import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Card, Group, Loader, ScrollArea, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useSgcFetch } from '../useSgcFetch';
import BiomedHojaVida from './BiomedHojaVida';
import type { CronogramaItem } from '../../../lib/biomedica/hojaVida';

/**
 * CRONOGRAMA DE MANTENIMIENTO (Ingeniería biomédica, 2026-11-26; reunión de Nicolás Rivera con Juan Mora: «un cuadrito
 * con las fechas en que toca hacerle mantenimiento a cada equipo»): próximo preventivo de cada equipo con periodicidad,
 * por mes o en lista, con los vencidos primero. Clic en un equipo abre su hoja de vida.
 */
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const fecha = (s: string) => s.split('-').reverse().join('/');

export default function BiomedCronograma({ idCompany }: { idCompany: number }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [modo, setModo] = useState<'mes' | 'lista'>('mes');
  const [abierto, setAbierto] = useState<number | null>(null);
  const r = useSgcFetch<{ items: CronogramaItem[] }>(`/api/biomedica/inventario/cronograma?company=${idCompany}&year=${year}`);
  const items = r.data?.items ?? [];
  const vencidos = items.filter((i) => i.vencido);
  const porMes = useMemo(() => {
    const m = new Map<number, CronogramaItem[]>();
    for (const it of items) if (!it.vencido && it.proximo.startsWith(String(year))) m.set(Number(it.proximo.slice(5, 7)), [...(m.get(Number(it.proximo.slice(5, 7))) ?? []), it]);
    return m;
  }, [items, year]);

  const Equipo = ({ it }: { it: CronogramaItem }) => (
    <Text size='xs' style={{ cursor: 'pointer' }} onClick={() => setAbierto(it.id)}>
      <b>{fecha(it.proximo).slice(0, 5)}</b> · {it.equipo} · {it.serie}
      {it.cliente ? ` · ${it.cliente}` : ''}
    </Text>
  );

  return (
    <Stack gap='sm' data-testid='biomed-cronograma'>
      <Group justify='space-between'>
        <Group gap='xs'>
          <ActionIcon variant='default' aria-label='Año anterior' onClick={() => setYear((y) => y - 1)}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={700}>{year}</Text>
          <ActionIcon variant='default' aria-label='Año siguiente' onClick={() => setYear((y) => y + 1)}>
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        <SegmentedControl size='xs' value={modo} onChange={(v) => setModo(v as typeof modo)} data={[{ value: 'mes', label: 'Por mes' }, { value: 'lista', label: 'Lista' }]} />
      </Group>
      {r.error && <Alert color='orange'>{r.error}</Alert>}
      {!r.data && !r.error && <Loader />}
      {r.data && items.length === 0 && (
        <Alert color='blue' variant='light'>
          Ningún equipo tiene periodicidad de mantenimiento. Escríbala en la hoja de vida de cada equipo («Mantenimiento preventivo cada (meses)»).
        </Alert>
      )}
      {vencidos.length > 0 && (
        <Alert color='red' variant='light' title={`${vencidos.length} equipo(s) con el preventivo vencido`}>
          <Stack gap={2}>
            {vencidos.slice(0, 50).map((it) => (
              <Equipo key={it.id} it={it} />
            ))}
          </Stack>
        </Alert>
      )}
      {r.data && modo === 'mes' && items.length > 0 && (
        <ScrollArea>
          <Group align='flex-start' wrap='nowrap' gap='xs' miw={1400}>
            {MESES.map((m, i) => (
              <Card key={m} withBorder radius='md' p='xs' w={230}>
                <Group justify='space-between' mb={4}>
                  <Text fw={600} size='sm'>
                    {m}
                  </Text>
                  <Badge variant='light'>{porMes.get(i + 1)?.length ?? 0}</Badge>
                </Group>
                <Stack gap={2}>
                  {(porMes.get(i + 1) ?? []).map((it) => (
                    <Equipo key={it.id} it={it} />
                  ))}
                </Stack>
              </Card>
            ))}
          </Group>
        </ScrollArea>
      )}
      {r.data && modo === 'lista' && items.length > 0 && (
        <Table striped fz='sm' verticalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Próximo</Table.Th>
              <Table.Th>Equipo</Table.Th>
              <Table.Th>Serie</Table.Th>
              <Table.Th>Modelo</Table.Th>
              <Table.Th>Cliente</Table.Th>
              <Table.Th>Cada</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((it) => (
              <Table.Tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => setAbierto(it.id)}>
                <Table.Td>
                  <Badge color={it.vencido ? 'red' : 'blue'} variant='light'>
                    {fecha(it.proximo)}
                  </Badge>
                </Table.Td>
                <Table.Td>{it.equipo}</Table.Td>
                <Table.Td>{it.serie}</Table.Td>
                <Table.Td>{it.modelo ?? '—'}</Table.Td>
                <Table.Td>{it.cliente ?? '—'}</Table.Td>
                <Table.Td>{it.periodicidadMeses} mes(es)</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {abierto !== null && <BiomedHojaVida idCompany={idCompany} idEquipo={abierto} onClose={() => setAbierto(null)} onChanged={() => r.reload()} />}
    </Stack>
  );
}
