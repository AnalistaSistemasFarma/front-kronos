'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconHierarchy2, IconPaperclip } from '@tabler/icons-react';
import { stateColor, stateLabel } from '../../../../lib/purchases/fields';
import AttachmentsPanel from './AttachmentsPanel';
import TracePanel from './TracePanel';

/**
 * Vista interna de la solicitud de compra con el MISMO diseño que SAPSEND
 * (ModalViewPurchaseRequest.jsx): botones Anexos y Estado, titulo con numero,
 * estado y creador, bloque de fechas, tabla de lineas, comentarios y motivo de
 * cancelacion. Se muestra dentro del detalle de la solicitud en «Mis solicitudes»
 * cuando esa solicitud autoriza un borrador de compra. Solo lectura.
 */

interface Purchase {
  companyId: number;
  docEntry: number;
  firmDocEntry: number | null;
  firmDocNum: number | null;
  draft: Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] };
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const money = (v: unknown) => {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? '' : n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
};
const txt = (v: unknown) => (v == null ? '' : String(v));

/** Columnas de la tabla de lineas, en el orden de SAPSEND. */
const LINE_COLUMNS: { label: string; render: (l: Record<string, unknown>, i: number) => React.ReactNode; align?: 'right' }[] = [
  { label: 'Línea', render: (_l, i) => i + 1 },
  { label: 'Artículo', render: (l) => txt(l.ItemCode) },
  { label: 'Descripción', render: (l) => txt(l.ItemDescription) },
  { label: 'Proveedor', render: (l) => txt(l.U_NombreProveedor ?? l.LineVendor) },
  { label: 'Fecha', render: (l) => day(l.RequiredDate) },
  { label: 'Cantidad', render: (l) => money(l.Quantity), align: 'right' },
  { label: 'Precio', render: (l) => `${money(l.UnitPrice ?? l.Price)} ${txt(l.Currency)}`.trim(), align: 'right' },
  { label: 'Descuento', render: (l) => `${money(l.DiscountPercent ?? 0)}%`, align: 'right' },
  { label: 'IVA', render: (l) => txt(l.TaxCode) },
  { label: 'Total línea', render: (l) => money(l.LineTotal), align: 'right' },
  { label: 'Norma R', render: (l) => txt(l.CostingCode) },
  { label: 'Bodega', render: (l) => txt(l.WarehouseCode) },
  { label: 'Proyecto', render: (l) => txt(l.ProjectCode) },
  { label: 'Destino', render: (l) => txt(l.U_Dest_compra) },
  { label: 'Código', render: (l) => txt(l.AccountCode) },
  { label: 'Versión', render: (l) => txt(l.U_version) },
  { label: 'U de medida', render: (l) => txt(l.U_HBT_UndMedida) },
];

export default function PurchaseRequestDetail({ requestId }: { requestId: string | number | null }) {
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'anexos' | 'estado' | null>(null);

  useEffect(() => {
    if (!requestId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/purchases/by-request?requestId=${requestId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar la solicitud de compra');
        if (!cancelled) setPurchase(d.purchase ?? null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error}</Alert>;
  if (!purchase) return null; // no es una solicitud de compra

  const d = purchase.draft;
  const lines = d.DocumentLines ?? [];
  const numero = purchase.firmDocNum ?? purchase.firmDocEntry;
  const titulo = numero ? `Solicitud de compra ${numero}` : `Solicitud de compra · Borrador #${purchase.docEntry}`;
  const motivo = txt(d.U_Motivo_Can_Solicitud);

  const dates: [string, unknown][] = [
    ['FECHA DE CONTABILIZACIÓN', d.DocDate],
    ['FECHA DE ENTREGA', d.DocDueDate],
    ['FECHA DE DOCUMENTO', d.TaxDate],
    ['FECHA REQUERIDA', d.RequriedDate],
  ];

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Button
          size="xs"
          color="indigo"
          variant={panel === 'anexos' ? 'filled' : 'light'}
          leftSection={<IconPaperclip size={14} />}
          onClick={() => setPanel((p) => (p === 'anexos' ? null : 'anexos'))}
        >
          Anexos
        </Button>
        <Button
          size="xs"
          color="indigo"
          variant={panel === 'estado' ? 'filled' : 'light'}
          rightSection={<IconHierarchy2 size={14} />}
          onClick={() => setPanel((p) => (p === 'estado' ? null : 'estado'))}
        >
          Estado
        </Button>
      </Group>

      {panel === 'anexos' && (
        <AttachmentsPanel companyId={purchase.companyId} docEntry={purchase.docEntry} canUpload={false} />
      )}
      {panel === 'estado' && <TracePanel companyId={purchase.companyId} docEntry={purchase.docEntry} />}

      <div>
        <Title order={2}>{titulo}</Title>
        <Group gap={6} mt={4}>
          <Box w={8} h={8} style={{ borderRadius: 8 }} bg={`${stateColor(d.U_SEND_State)}.6`} />
          <Text size="sm" fw={500}>
            {stateLabel(d.U_SEND_State)}
          </Text>
        </Group>
        <Text size="sm">Creada por {txt(d.U_SEND_UserName)}</Text>
      </div>

      <Box py="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        {dates.map(([label, value]) => (
          <Group key={label} gap="md" wrap="nowrap">
            <Text size="sm" fw={600} w={210}>
              {label}:
            </Text>
            <Text size="sm">{day(value)}</Text>
          </Group>
        ))}
      </Box>

      <Table.ScrollContainer minWidth={1500}>
        <Table striped verticalSpacing="xs" fz="xs">
          <Table.Thead>
            <Table.Tr>
              {LINE_COLUMNS.map((c) => (
                <Table.Th key={c.label} style={{ textTransform: 'uppercase', textAlign: c.align ?? 'left' }}>
                  {c.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l, i) => (
              <Table.Tr key={i}>
                {LINE_COLUMNS.map((c) => (
                  <Table.Td key={c.label} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render(l, i)}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="flex-end" gap="xl">
        <Text size="sm">
          <b>TOTAL COP:</b> {money(d.DocTotal)}
        </Text>
        {d.DocTotalSys != null && (
          <Text size="sm">
            <b>TOTAL USD:</b> {money(d.DocTotalSys)}
          </Text>
        )}
      </Group>

      <div>
        <Text fw={700} size="sm">
          COMENTARIOS:
        </Text>
        <Text size="sm">{txt(d.Comments)}</Text>
      </div>
      <div>
        <Text fw={700} size="sm">
          MOTIVOS DE CANCELACIÓN:
        </Text>
        <Text size="sm">{motivo}</Text>
      </div>
    </Stack>
  );
}
