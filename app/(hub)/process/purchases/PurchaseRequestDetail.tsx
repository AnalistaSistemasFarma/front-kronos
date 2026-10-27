'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Stack, Table, Text } from '@mantine/core';
import { IconHierarchy2, IconHistory, IconPaperclip } from '@tabler/icons-react';
import { stateColor, stateLabel } from '../../../../lib/purchases/fields';
import AttachmentsPanel from './AttachmentsPanel';
import TracePanel from './TracePanel';
import ExecutionHistoryPanel from './ExecutionHistoryPanel';

/**
 * Bloque «Solicitud de compra en SAP» dentro del detalle de la solicitud (Mis
 * solicitudes y Autorizaciones). Toma de SAPSEND (ModalViewPurchaseRequest.jsx)
 * solo lo que el detalle de SynerLink no muestra ya: número y estado en SAP,
 * fecha requerida, anexos, trazabilidad, historial, líneas, totales y motivo de
 * rechazo. El asunto, el solicitante y la descripción (comentarios) ya están en
 * el detalle general, así que no se repiten. Solo lectura.
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
const LINE_COLUMNS: {
  label: string;
  render: (l: Record<string, unknown>, i: number) => React.ReactNode;
  align?: 'right';
  /** Se oculta si ninguna línea trae el dato (proyecto, destino, versión… casi siempre vacíos). */
  optional?: boolean;
}[] = [
  { label: 'Línea', render: (_l, i) => i + 1 },
  { label: 'Artículo', render: (l) => txt(l.ItemCode) , optional: true },
  { label: 'Descripción', render: (l) => txt(l.ItemDescription) },
  { label: 'Proveedor', render: (l) => txt(l.U_NombreProveedor ?? l.LineVendor) },
  { label: 'Fecha', render: (l) => day(l.RequiredDate) },
  { label: 'Cantidad', render: (l) => money(l.Quantity), align: 'right' },
  { label: 'Precio', render: (l) => `${money(l.UnitPrice ?? l.Price)} ${txt(l.Currency)}`.trim(), align: 'right' },
  { label: 'Descuento', render: (l) => `${money(l.DiscountPercent ?? 0)}%`, align: 'right' , optional: true },
  { label: 'IVA', render: (l) => txt(l.TaxCode) },
  { label: 'Total línea', render: (l) => money(l.LineTotal), align: 'right' },
  { label: 'Norma R', render: (l) => txt(l.CostingCode) },
  { label: 'Bodega', render: (l) => txt(l.WarehouseCode) , optional: true },
  { label: 'Proyecto', render: (l) => txt(l.ProjectCode) , optional: true },
  { label: 'Destino', render: (l) => txt(l.U_Dest_compra) , optional: true },
  { label: 'Cuenta', render: (l) => txt(l.AccountCode) },
  { label: 'Versión', render: (l) => txt(l.U_version) , optional: true },
  { label: 'U de medida', render: (l) => txt(l.U_HBT_UndMedida) , optional: true },
];

export default function PurchaseRequestDetail({
  requestId,
  onLoaded,
}: {
  requestId: string | number | null;
  /** Avisa si la solicitud es de compra (p. ej. para agrandar la ventana que la contiene). */
  onLoaded?: (isPurchase: boolean) => void;
}) {
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Los anexos se ven de entrada: es lo primero que revisa el autorizador.
  const [panel, setPanel] = useState<'anexos' | 'estado' | 'historial' | null>('anexos');

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
        if (!cancelled) {
          setPurchase(d.purchase ?? null);
          onLoaded?.(Boolean(d.purchase));
        }
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
  const motivo = txt(d.U_Motivo_Can_Solicitud).trim();
  const columns = LINE_COLUMNS.filter(
    (c) => !c.optional || lines.some((l, i) => String(c.render(l, i) ?? '').trim() !== '')
  );

  return (
    <Stack gap="sm">
      <div>
        <Text size="sm" c="gray.6" fw={500}>
          Solicitud de compra en SAP
        </Text>
        <Group gap="xs" mt={4}>
          <Badge variant="light" color={stateColor(d.U_SEND_State)} styles={{ root: { textTransform: 'none' } }}>
            {stateLabel(d.U_SEND_State)}
          </Badge>
          <Text size="sm">Borrador #{purchase.docEntry}</Text>
          {numero ? <Text size="sm">· En firme N.º {numero}</Text> : null}
          {d.RequriedDate ? (
            <Text size="sm" c="dimmed">
              · Fecha requerida {day(d.RequriedDate)}
            </Text>
          ) : null}
        </Group>
      </div>

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
        <Button
          size="xs"
          color="indigo"
          variant={panel === 'historial' ? 'filled' : 'light'}
          leftSection={<IconHistory size={14} />}
          onClick={() => setPanel((p) => (p === 'historial' ? null : 'historial'))}
        >
          Historial
        </Button>
      </Group>

      {panel === 'anexos' && (
        <AttachmentsPanel companyId={purchase.companyId} docEntry={purchase.docEntry} canUpload={false} requestId={requestId} />
      )}
      {panel === 'estado' && <TracePanel companyId={purchase.companyId} docEntry={purchase.docEntry} />}
      {panel === 'historial' && requestId != null && <ExecutionHistoryPanel requestId={requestId} />}

      <Table.ScrollContainer minWidth={Math.max(600, columns.length * 95)}>
        <Table striped verticalSpacing="xs" fz="xs">
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c.label} style={{ textTransform: 'uppercase', textAlign: c.align ?? 'left' }}>
                  {c.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l, i) => (
              <Table.Tr key={i}>
                {columns.map((c) => (
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

      {motivo ? (
        <Alert color="red" variant="light" title="Motivo de rechazo o anulación">
          {motivo}
        </Alert>
      ) : null}
    </Stack>
  );
}
