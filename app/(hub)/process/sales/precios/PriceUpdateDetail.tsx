'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Group, ScrollArea, Table, Text } from '@mantine/core';
import { IconReceipt2 } from '@tabler/icons-react';
import { pctChange } from '../../../../../lib/prices/rules';

/** Bloque «Actualización de lista de precios» en el detalle de la solicitud y en Autorizaciones: antes → después. */
type Upd = {
  cardCode: string; cardName: string | null; priceListNum: number | null; priceListName: string | null; compartida: boolean; status: string; error: string | null; comentario: string | null;
  lines: { line_num: number; item_code: string; item_name: string | null; current_price: number | null; new_price: number; modo: string; status: string; error: string | null }[];
};
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'En autorización', color: 'yellow' }, applying: { label: 'Aplicando en SAP', color: 'blue' }, applied: { label: 'Aplicada en SAP', color: 'green' },
  partial: { label: 'Aplicada en parte', color: 'orange' }, error: { label: 'Error al aplicar', color: 'red' }, rejected: { label: 'Rechazada', color: 'gray' }, cancelled: { label: 'Cancelada', color: 'gray' },
};
const money = (v: number | null) => (v == null ? '—' : `$ ${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);

export default function PriceUpdateDetail({ requestId, onLoaded, mb }: { requestId: number | string | null | undefined; onLoaded?: (is: boolean) => void; mb?: string }) {
  const [u, setU] = useState<Upd | null>(null);
  useEffect(() => {
    if (!requestId) return;
    let off = false;
    fetch(`/api/prices/by-request?requestId=${requestId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { update: null }))
      .then((d) => { if (!off) { setU(d.update ?? null); onLoaded?.(Boolean(d.update)); } })
      .catch(() => undefined);
    return () => { off = true; };
  }, [requestId]);
  if (!u) return null;
  const st = STATUS[u.status] ?? { label: u.status, color: 'gray' };
  return (
    <Card withBorder radius="md" p="md" mb={mb} shadow="sm">
      <Group justify="space-between" mb="sm">
        <Group gap={8}><IconReceipt2 size={20} /><Text fw={700}>Actualización de precios · {u.cardName ?? u.cardCode}</Text></Group>
        <Badge color={st.color}>{st.label}</Badge>
      </Group>
      <Text size="sm" mb="xs">
        {u.compartida
          ? <>Lista <b>{u.priceListName ?? u.priceListNum}</b> compartida: se aplican como <b>precios especiales</b> solo para {u.cardCode}.</>
          : <>Se actualiza la lista propia del cliente: <b>{u.priceListName ?? u.priceListNum}</b>.</>}
      </Text>
      {u.comentario && <Text size="sm" c="dimmed" mb="xs">«{u.comentario}»</Text>}
      {u.error && <Alert color="red" mb="sm">{u.error}</Alert>}
      <ScrollArea.Autosize mah={420}>
        <Table striped withTableBorder verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr><Table.Th>Artículo</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio actual</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio nuevo</Table.Th><Table.Th style={{ textAlign: 'right' }}>Variación</Table.Th><Table.Th>En SAP</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {u.lines.map((l) => {
              const v = pctChange(l.current_price, l.new_price);
              return (
                <Table.Tr key={l.line_num}>
                  <Table.Td><Text size="sm">{l.item_code}</Text><Text size="xs" c="dimmed">{l.item_name}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{money(l.current_price)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><b>{money(l.new_price)}</b></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{v == null ? '—' : <Text size="sm" fw={600} c={v > 0 ? 'orange' : v < 0 ? 'teal' : undefined}>{v > 0 ? '+' : ''}{v} %</Text>}</Table.Td>
                  <Table.Td>{l.status === 'applied' ? <Badge size="xs" color="green">Aplicado</Badge> : l.status === 'error' ? <Text size="xs" c="red">{l.error}</Text> : <Badge size="xs" color="gray" variant="light">Pendiente</Badge>}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </Card>
  );
}
