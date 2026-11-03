'use client';

import React, { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, NumberInput, ScrollArea, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SapLookupInput from '../purchases/SapLookupInput';
import { sapErrorText } from '../../../../lib/purchases/sapErrorHint';

/**
 * Oferta de venta DENTRO de «Crear Nueva Solicitud» (Mis solicitudes), debajo del
 * proceso, igual que la solicitud de compra. Al enviar, el servidor crea la oferta en
 * SAP (cotización + borrador, como SAPSEND), abre la solicitud con el flujo «Oferta de
 * venta» y el flujo decide: pedido directo o autorizaciones (precio / cupo).
 */

interface Props {
  companyId: string;
  subject: string;
  onDone: (result: { ok: boolean; message: string }) => void;
}

interface Line {
  ItemCode?: string;
  ItemDescription?: string;
  Quantity?: number | string;
  UnitPrice?: number | string;
  ListPrice?: number | null;
  WarehouseCode?: string;
  TaxCode?: string;
}

type Readiness = 'loading' | 'ready' | 'no-write' | 'no-sap';

const notifySapError = (msg: string) => toast.error(sapErrorText(msg), { duration: 12000, style: { whiteSpace: 'pre-line', maxWidth: 520 } });
const empty = (v: unknown) => v == null || String(v).trim() === '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export default function SalesInlineForm({ companyId, subject, onDone }: Props) {
  const [readiness, setReadiness] = useState<Readiness>('loading');
  const [cardCode, setCardCode] = useState('');
  const [cardName, setCardName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [numAtCard, setNumAtCard] = useState('');
  const [comments, setComments] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<{ field: string; error: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setReadiness('loading');
    fetch('/api/sales/access')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const c = (d.companies ?? []).find((x: { idCompany: number }) => String(x.idCompany) === companyId);
        if (!c?.canWrite) setReadiness('no-write');
        else if (!c.ready) setReadiness('no-sap');
        else setReadiness('ready');
      })
      .catch(() => !cancelled && setReadiness('no-write'));
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.error;
  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Precio de lista del cliente para el artículo elegido: se propone como precio de venta. */
  const loadPrice = async (i: number, itemCode: string) => {
    if (!cardCode || !itemCode) return;
    try {
      const r = await fetch(`/api/sales/price?companyId=${companyId}&cardCode=${encodeURIComponent(cardCode)}&itemCode=${encodeURIComponent(itemCode)}`);
      const d = await r.json();
      if (r.ok) setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ListPrice: d.price ?? null, UnitPrice: l.UnitPrice ?? d.price ?? '' } : l)));
    } catch {
      /* el precio se puede digitar */
    }
  };

  const total = lines.reduce((a, l) => a + Number(l.Quantity || 0) * Number(l.UnitPrice || 0), 0);

  const submit = async () => {
    setTried(true);
    setErrors([]);
    const missing: string[] = [];
    if (!cardCode) missing.push('Cliente');
    if (!dueDate) missing.push('Fecha de entrega');
    lines.forEach((l, i) => {
      if (empty(l.ItemCode)) missing.push(`Línea ${i + 1} · Artículo`);
      if (!(Number(l.Quantity) > 0)) missing.push(`Línea ${i + 1} · Cantidad`);
      if (empty(l.UnitPrice)) missing.push(`Línea ${i + 1} · Precio`);
      if (empty(l.WarehouseCode)) missing.push(`Línea ${i + 1} · Bodega`);
    });
    if (missing.length) {
      toast.error(`Complete los campos obligatorios: ${missing.join(' · ')}.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/sales/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          subject,
          header: { CardCode: cardCode, DocDueDate: dueDate, NumAtCard: numAtCard, Comments: comments || subject },
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notifySapError(String(data.error || 'No se pudo crear la oferta de venta'));
        setErrors(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      onDone({ ok: true, message: `Oferta de venta #${data.docEntry} creada. El flujo revisa precio y cupo y la envía a autorización si hace falta.` });
    } catch {
      toast.error('Error de red al crear la oferta de venta');
    } finally {
      setSaving(false);
    }
  };

  if (readiness === 'loading') return <Loader size="sm" />;
  if (readiness === 'no-write') {
    return (
      <Alert color="yellow" title="Oferta de venta">
        No tiene permiso para crear ofertas de venta en esta empresa («Ventas · Gestionar ofertas»).
      </Alert>
    );
  }
  if (readiness === 'no-sap') {
    return (
      <Alert color="yellow" title="Oferta de venta">
        Esta empresa no tiene conexión a SAP configurada; no se pueden crear ofertas de venta.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Group grow align="flex-start">
        <SapLookupInput
          label={<>Cliente <Text span c="red">*</Text></>}
          companyId={companyId}
          endpoint="/api/sales/lookup"
          kind="customer"
          value={cardCode}
          onChange={(v) => {
            setCardCode(v);
            setCardName('');
          }}
          onSelect={(o) => {
            setCardCode(o.value);
            setCardName(o.fill?.CardName ?? '');
          }}
          error={errorFor('CardCode') ?? (tried && !cardCode ? 'Obligatorio' : undefined)}
          ariaLabel="Cliente"
        />
        <TextInput
          label={<>Fecha de entrega <Text span c="red">*</Text></>}
          type="date"
          min={today()}
          value={dueDate}
          onChange={(e) => setDueDate(e.currentTarget.value)}
          error={errorFor('DocDueDate') ?? (tried && !dueDate ? 'Obligatorio' : undefined)}
        />
        <TextInput label="Orden de compra del cliente" value={numAtCard} maxLength={100} onChange={(e) => setNumAtCard(e.currentTarget.value)} />
      </Group>
      {cardName && (
        <Text size="sm" c="dimmed">
          {cardName}
        </Text>
      )}
      <Textarea label="Comentarios" description="Si lo deja vacío se usa el asunto." autosize minRows={2} maxLength={254} value={comments} onChange={(e) => setComments(e.currentTarget.value)} />

      <div>
        <Text fw={600} size="sm" mb={4}>
          Artículos
        </Text>
        <ScrollArea type="auto" offsetScrollbars>
          <Table withTableBorder withColumnBorders verticalSpacing={4} horizontalSpacing={6} style={{ minWidth: 1100 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 36 }}>#</Table.Th>
                <Table.Th style={{ minWidth: 220 }}>Artículo <Text span c="red">*</Text></Table.Th>
                <Table.Th style={{ minWidth: 220 }}>Descripción</Table.Th>
                <Table.Th style={{ minWidth: 110 }}>Cantidad <Text span c="red">*</Text></Table.Th>
                <Table.Th style={{ minWidth: 140 }}>Precio de lista</Table.Th>
                <Table.Th style={{ minWidth: 140 }}>Precio <Text span c="red">*</Text></Table.Th>
                <Table.Th style={{ minWidth: 150 }}>Bodega <Text span c="red">*</Text></Table.Th>
                <Table.Th style={{ minWidth: 130 }}>IVA</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Text size="xs" fw={600}>{i + 1}</Text>
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <SapLookupInput
                      size="xs"
                      companyId={companyId}
                      endpoint="/api/sales/lookup"
                      kind="item"
                      value={String(l.ItemCode ?? '')}
                      onChange={(v) => setLine(i, { ItemCode: v })}
                      onSelect={(o) => {
                        setLine(i, { ItemCode: o.value, ItemDescription: o.fill?.ItemDescription, ...(o.fill?.WarehouseCode ? { WarehouseCode: o.fill.WarehouseCode } : {}), UnitPrice: undefined });
                        loadPrice(i, o.value);
                      }}
                      error={errorFor(`DocumentLines[${i}].ItemCode`) ?? (tried && empty(l.ItemCode) ? 'Obligatorio' : undefined)}
                      ariaLabel={`Artículo línea ${i + 1}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{l.ItemDescription ?? ''}</Text>
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <NumberInput size="xs" min={0} allowNegative={false} thousandSeparator="." decimalSeparator="," value={l.Quantity ?? ''} onChange={(v) => setLine(i, { Quantity: v })}
                      error={errorFor(`DocumentLines[${i}].Quantity`) ?? (tried && !(Number(l.Quantity) > 0) ? 'Obligatorio' : undefined)} aria-label={`Cantidad línea ${i + 1}`} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{l.ListPrice != null ? Number(l.ListPrice).toLocaleString('es-CO') : cardCode ? '—' : 'Elija el cliente'}</Text>
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <NumberInput size="xs" min={0} allowNegative={false} thousandSeparator="." decimalSeparator="," value={l.UnitPrice ?? ''} onChange={(v) => setLine(i, { UnitPrice: v })}
                      error={errorFor(`DocumentLines[${i}].UnitPrice`) ?? (tried && empty(l.UnitPrice) ? 'Obligatorio' : undefined)} aria-label={`Precio línea ${i + 1}`} />
                    {l.ListPrice != null && l.UnitPrice !== '' && l.UnitPrice != null && Number(l.UnitPrice) !== Number(l.ListPrice) && (
                      <Text size="xs" c="orange">Distinto a la lista: puede requerir autorización de precio</Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <SapLookupInput size="xs" companyId={companyId} endpoint="/api/sales/lookup" kind="warehouse" value={String(l.WarehouseCode ?? '')}
                      onChange={(v) => setLine(i, { WarehouseCode: v })} onSelect={(o) => setLine(i, { WarehouseCode: o.value })}
                      error={errorFor(`DocumentLines[${i}].WarehouseCode`) ?? (tried && empty(l.WarehouseCode) ? 'Obligatorio' : undefined)} ariaLabel={`Bodega línea ${i + 1}`} />
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <SapLookupInput size="xs" companyId={companyId} endpoint="/api/sales/lookup" kind="tax" value={String(l.TaxCode ?? '')}
                      onChange={(v) => setLine(i, { TaxCode: v })} onSelect={(o) => setLine(i, { TaxCode: o.value })} ariaLabel={`IVA línea ${i + 1}`} />
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <ActionIcon variant="subtle" color="red" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, j) => j !== i))} aria-label={`Quitar línea ${i + 1}`}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" mt="sm">
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setLines((p) => [...p, {}])}>
            Agregar artículo
          </Button>
          <Text fw={600}>Total antes de impuestos: {total.toLocaleString('es-CO')}</Text>
        </Group>
      </div>

      <Group justify="flex-end" style={{ position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--mantine-color-body)', paddingTop: 8, paddingBottom: 8, borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Button leftSection={<IconSend size={16} />} onClick={submit} loading={saving} disabled={!subject.trim() && !comments.trim()}>
          Crear oferta y enviar
        </Button>
      </Group>
    </Stack>
  );
}
