'use client';

import React from 'react';
import { Badge, Card, Group, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconArrowRight, IconFileInvoice, IconFileText, IconHierarchy2, IconPencil, IconReceipt, IconTruckDelivery } from '@tabler/icons-react';
import { STATE_LABELS } from '../../../../lib/sales/states';

/**
 * Mapa de relaciones de un documento de venta: cotización → borrador → pedido → entregas →
 * facturas (como el mapa de relaciones de SAP). Lo usan el bloque de la oferta en la
 * solicitud y el panel de pedidos de venta.
 */

export type Kind = 'quotation' | 'draft' | 'order' | 'delivery' | 'invoice';
export interface RelDoc { kind: Kind; docEntry: number; docNum: number | null; docDate: string | null; total: number | null; status: string | null; sendState?: string | null }

const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);
const KIND: Record<Kind, { label: string; icon: React.ReactNode; color: string }> = {
  quotation: { label: 'Cotización', icon: <IconFileText size={16} />, color: 'gray' },
  draft: { label: 'Borrador de pedido', icon: <IconPencil size={16} />, color: 'yellow' },
  order: { label: 'Pedido de venta', icon: <IconFileInvoice size={16} />, color: 'blue' },
  delivery: { label: 'Entrega', icon: <IconTruckDelivery size={16} />, color: 'teal' },
  invoice: { label: 'Factura', icon: <IconReceipt size={16} />, color: 'green' },
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

export default function RelationMap({ relations, warnings = [] }: { relations: RelDoc[]; warnings?: string[] }) {
  const byKind = (k: Kind) => relations.filter((x) => x.kind === k);
  const columns: Kind[] = ['quotation', 'draft', 'order', 'delivery', 'invoice'];
  return (
    <>
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
      {warnings.map((w) => <Text key={w} size='xs' c='orange' mb='xs'>{w}</Text>)}
    </>
  );
}
