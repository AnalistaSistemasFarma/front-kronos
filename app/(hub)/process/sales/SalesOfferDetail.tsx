'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Card, Group, Loader, ScrollArea, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconArrowRight, IconFileInvoice, IconFileText, IconHierarchy2, IconPencil, IconReceipt, IconTruckDelivery } from '@tabler/icons-react';
import { STATE_LABELS } from '../../../../lib/sales/states';

/**
 * Bloque «Oferta de venta en SAP» dentro del detalle de la solicitud: datos del borrador,
 * líneas y el MAPA DE RELACIONES (cotización → borrador → pedido → entregas → facturas),
 * como el mapa de relaciones de SAP y la trazabilidad de SAPSEND. Solo lectura. No muestra
 * nada si la solicitud no es de ventas.
 */

type Kind = 'quotation' | 'draft' | 'order' | 'delivery' | 'invoice';
interface RelDoc { kind: Kind; docEntry: number; docNum: number | null; docDate: string | null; total: number | null; status: string | null; sendState?: string | null }
interface Sale {
  companyId: number;
  docEntry: number;
  flowStatus: string;
  flowError: string | null;
  draft: Record<string, unknown> & { DocumentLines: Record<string, unknown>[] };
  relations: RelDoc[];
  warnings: string[];
}

const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);
const qty = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 }));
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const KIND: Record<Kind, { label: string; icon: React.ReactNode; color: string }> = {
  quotation: { label: 'Cotización', icon: <IconFileText size={16} />, color: 'gray' },
  draft: { label: 'Borrador de pedido', icon: <IconPencil size={16} />, color: 'yellow' },
  order: { label: 'Pedido de venta', icon: <IconFileInvoice size={16} />, color: 'blue' },
  delivery: { label: 'Entrega', icon: <IconTruckDelivery size={16} />, color: 'teal' },
  invoice: { label: 'Factura', icon: <IconReceipt size={16} />, color: 'green' },
};
const FLOW: Record<string, { label: string; color: string }> = {
  pending: { label: 'En el flujo', color: 'yellow' },
  approved: { label: 'Pedido creado', color: 'green' },
  rejected: { label: 'Rechazada', color: 'orange' },
  publish_error: { label: 'Error al crear el pedido', color: 'red' },
  reject_error: { label: 'Error al aplicar el rechazo', color: 'red' },
  cancelled: { label: 'Cancelada', color: 'gray' },
};

function DocCard({ d }: { d: RelDoc }) {
  const k = KIND[d.kind];
  const send = d.sendState ? (STATE_LABELS as Record<string, string>)[d.sendState] ?? d.sendState : null;
  return (
    <Card withBorder radius='md' p='sm' miw={190}>
      <Group gap={6} mb={4} wrap='nowrap'>
        <ThemeIcon size='sm' variant='light' color={k.color}>{k.icon}</ThemeIcon>
        <Text size='sm' fw={600}>{k.label}</Text>
      </Group>
      <Text size='lg' fw={700}>#{d.docNum ?? d.docEntry}</Text>
      <Text size='xs' c='dimmed'>{d.docDate ?? ''} · {money(d.total)}</Text>
      <Group gap={4} mt={4}>
        {d.status && <Badge size='xs' variant='light' color={d.status === 'Abierto' ? 'blue' : d.status === 'Cancelado' ? 'red' : 'gray'}>{d.status}</Badge>}
        {send && <Badge size='xs' variant='outline'>{send}</Badge>}
      </Group>
    </Card>
  );
}

export default function SalesOfferDetail({ requestId }: { requestId: number | string | null | undefined }) {
  const [sale, setSale] = useState<Sale | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    fetch(`/api/sales/by-request?requestId=${requestId}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'No se pudo consultar la oferta en SAP');
        setSale(d.sale ?? null);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (error) return <Alert color='yellow' title='Oferta de venta en SAP'>{error}</Alert>;
  if (sale === undefined) return requestId ? <Loader size='sm' /> : null;
  if (sale === null) return null;

  const d = sale.draft;
  const flow = FLOW[sale.flowStatus];
  const byKind = (k: Kind) => sale.relations.filter((x) => x.kind === k);
  const columns: Kind[] = ['quotation', 'draft', 'order', 'delivery', 'invoice'];

  return (
    <Card withBorder radius='md' p='md'>
      <Group justify='space-between' mb='sm' wrap='wrap'>
        <Group gap={8}>
          <IconFileInvoice size={20} />
          <Text fw={700}>Oferta de venta en SAP · borrador #{String(d.DocNum ?? sale.docEntry)}</Text>
        </Group>
        <Group gap={6}>
          {d.U_SEND_State != null && <Badge variant='light'>{(STATE_LABELS as Record<string, string>)[String(d.U_SEND_State)] ?? String(d.U_SEND_State)}</Badge>}
          {flow && <Badge color={flow.color}>{flow.label}</Badge>}
        </Group>
      </Group>
      {sale.flowError && <Alert color='red' mb='sm'>{sale.flowError}</Alert>}

      <Group gap='xl' mb='md' wrap='wrap'>
        <div><Text size='xs' c='dimmed'>Cliente</Text><Text size='sm' fw={600}>{String(d.CardName ?? '')}</Text><Text size='xs'>{String(d.CardCode ?? '')}</Text></div>
        <div><Text size='xs' c='dimmed'>Punto de entrega</Text><Text size='sm'>{String(d.ShipToCode ?? '—')}</Text>{d.Address2 ? <Text size='xs' c='dimmed' style={{ whiteSpace: 'pre-line', maxWidth: 280 }}>{String(d.Address2)}</Text> : null}</div>
        <div><Text size='xs' c='dimmed'>OC del cliente</Text><Text size='sm'>{String(d.NumAtCard ?? '—')}</Text></div>
        <div><Text size='xs' c='dimmed'>Fecha / entrega</Text><Text size='sm'>{day(d.DocDate)} · {day(d.DocDueDate)}</Text></div>
        <div><Text size='xs' c='dimmed'>Total</Text><Text size='sm' fw={700}>{money(d.DocTotal)}</Text><Text size='xs' c='dimmed'>IVA {money(d.VatSum)}</Text></div>
      </Group>

      <Group gap={6} mb='xs'>
        <IconHierarchy2 size={18} />
        <Text fw={600} size='sm'>Mapa de relaciones</Text>
      </Group>
      <ScrollArea type='auto' mb='md'>
        <Group align='flex-start' wrap='nowrap' gap='xs'>
          {columns.map((k, i) => {
            const items = byKind(k);
            return (
              <React.Fragment key={k}>
                {i > 0 && <IconArrowRight size={18} style={{ marginTop: 42, flexShrink: 0, opacity: items.length ? 1 : 0.3 }} />}
                <Stack gap='xs'>
                  {items.length ? items.map((x) => <DocCard key={`${k}-${x.docEntry}`} d={x} />) : (
                    <Card withBorder radius='md' p='sm' miw={160} style={{ borderStyle: 'dashed', opacity: 0.6 }}>
                      <Text size='sm' fw={600}>{KIND[k].label}</Text>
                      <Text size='xs' c='dimmed'>{k === 'quotation' ? 'Sin cotización (p. ej. Salesforce)' : 'Aún no existe'}</Text>
                    </Card>
                  )}
                </Stack>
              </React.Fragment>
            );
          })}
        </Group>
      </ScrollArea>
      {sale.warnings.map((w) => <Text key={w} size='xs' c='orange' mb='xs'>{w}</Text>)}

      <ScrollArea type='auto'>
        <Table withTableBorder striped verticalSpacing={4} style={{ minWidth: 760 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th><Table.Th>Artículo</Table.Th><Table.Th>Descripción</Table.Th><Table.Th>Bodega</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio lista</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Precio</Table.Th><Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.DocumentLines.map((l, i) => (
              <Table.Tr key={i}>
                <Table.Td>{i + 1}</Table.Td><Table.Td>{String(l.ItemCode ?? '')}</Table.Td><Table.Td>{String(l.ItemDescription ?? '')}</Table.Td>
                <Table.Td>{String(l.WarehouseCode ?? '')}</Table.Td><Table.Td style={{ textAlign: 'right' }}>{qty(l.Quantity)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{money(l.U_SEND_PriceLP)}</Table.Td><Table.Td style={{ textAlign: 'right' }}>{money(l.UnitPrice)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{money(l.LineTotal)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}
