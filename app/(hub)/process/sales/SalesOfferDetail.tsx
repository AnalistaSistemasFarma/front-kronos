'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, ScrollArea, Table, Text } from '@mantine/core';
import { IconFileInvoice } from '@tabler/icons-react';
import { STATE_LABELS } from '../../../../lib/sales/states';
import SalesCreditPanel from './SalesCreditPanel';
import RelationMap, { type RelDoc } from './RelationMap';

/**
 * Bloque «Oferta de venta en SAP» dentro del detalle de la solicitud: datos del borrador,
 * líneas y el MAPA DE RELACIONES (cotización → borrador → pedido → entregas → facturas),
 * como el mapa de relaciones de SAP y la trazabilidad de SAPSEND. Solo lectura. No muestra
 * nada si la solicitud no es de ventas.
 */

interface Sale {
  companyId: number;
  docEntry: number;
  flowStatus: string;
  flowError: string | null;
  draft: Record<string, unknown> & { DocumentLines: Record<string, unknown>[] };
  relations: RelDoc[];
  warnings: string[];
  sapErrors?: { task: string; error: string }[];
}

const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);
const qty = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 }));
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const FLOW: Record<string, { label: string; color: string }> = {
  borrador: { label: 'En borrador (sin enviar)', color: 'gray' },
  pending: { label: 'En el flujo', color: 'yellow' },
  approved: { label: 'Pedido creado', color: 'green' },
  rejected: { label: 'Rechazada', color: 'orange' },
  publish_error: { label: 'Error al crear el pedido', color: 'red' },
  reject_error: { label: 'Error al aplicar el rechazo', color: 'red' },
  cancelled: { label: 'Cancelada', color: 'gray' },
};

export default function SalesOfferDetail({ requestId, onLoaded, mb }: { requestId: number | string | null | undefined; onLoaded?: (isSale: boolean) => void; mb?: string }) {
  const [sale, setSale] = useState<Sale | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    fetch(`/api/sales/by-request?requestId=${requestId}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'No se pudo consultar la oferta en SAP');
        setSale(d.sale ?? null);
        onLoaded?.(Boolean(d.sale));
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [requestId, reload]);

  if (error) return <Alert color='yellow' title='Oferta de venta en SAP' mb={mb}>{error}</Alert>;
  // Mientras carga no se muestra nada: la mayoría de las solicitudes no son de ventas.
  if (sale === undefined) return null;
  if (sale === null) return null;

  const d = sale.draft;
  const flow = FLOW[sale.flowStatus];

  return (
    <Card withBorder radius='md' p='md' mb={mb} shadow='sm'>
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
      {sale.flowStatus === 'borrador' && (
        <Alert color='gray' mb='sm' title='Oferta guardada en borrador'>
          <Text size='sm'>Todavía no ha entrado al flujo. Revise el cupo abajo y, cuando esté lista, envíela.</Text>
          <Group mt='xs' gap='xs'>
            <Button size='xs' loading={retrying}
              onClick={async () => {
                if (!window.confirm('¿Enviar la oferta a pedido en firme? Se revisa precio y cupo: si no requiere autorización se crea el pedido; si la requiere, pasa a Autorizaciones.')) return;
                setRetrying(true);
                try {
                  const r = await fetch('/api/sales/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: sale.companyId, docEntry: sale.docEntry, accion: 'enviar' }) });
                  const x = await r.json().catch(() => ({}));
                  if (!r.ok) window.alert(x.error || 'No se pudo enviar la oferta');
                } finally {
                  setRetrying(false);
                  setReload((n) => n + 1);
                }
              }}>
              Enviar a pedido en firme
            </Button>
            <Button size='xs' variant='light' component='a' href='/process/sales'>Editar en Mis ofertas en borrador</Button>
          </Group>
        </Alert>
      )}
      {sale.sapErrors && sale.sapErrors.length > 0 && (
        <Alert color='red' mb='sm' title='Una tarea en SAP quedó en error'>
          {sale.sapErrors.map((e) => (
            <Text key={e.task} size='sm'><b>{e.task}:</b> {e.error}</Text>
          ))}
          <Button mt='xs' size='xs' color='red' variant='light' loading={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await fetch('/api/sales/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) });
              } finally {
                setRetrying(false);
                setReload((n) => n + 1);
              }
            }}>
            Reintentar
          </Button>
        </Alert>
      )}

      <Group gap='xl' mb='md' wrap='wrap'>
        <div><Text size='xs' c='dimmed'>Cliente</Text><Text size='sm' fw={600}>{String(d.CardName ?? '')}</Text><Text size='xs'>{String(d.CardCode ?? '')}</Text></div>
        <div><Text size='xs' c='dimmed'>Punto de entrega</Text><Text size='sm'>{String(d.ShipToCode ?? '—')}</Text>{d.Address2 ? <Text size='xs' c='dimmed' style={{ whiteSpace: 'pre-line', maxWidth: 280 }}>{String(d.Address2)}</Text> : null}</div>
        <div><Text size='xs' c='dimmed'>OC del cliente</Text><Text size='sm'>{String(d.NumAtCard ?? '—')}</Text></div>
        <div><Text size='xs' c='dimmed'>Fecha / entrega</Text><Text size='sm'>{day(d.DocDate)} · {day(d.DocDueDate)}</Text></div>
        <div><Text size='xs' c='dimmed'>Total</Text><Text size='sm' fw={700}>{money(d.DocTotal)}</Text><Text size='xs' c='dimmed'>IVA {money(d.VatSum)}</Text></div>
      </Group>

      {/* Decisión de cartera: cupo, % de extracupo y cartera por edades del cliente. */}
      {requestId ? <div style={{ marginBottom: 16 }}><SalesCreditPanel requestId={requestId} /></div> : null}

      <RelationMap relations={sale.relations} warnings={sale.warnings} />

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
