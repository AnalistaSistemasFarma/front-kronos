'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import {
  IconBuildingStore,
  IconCalendar,
  IconCash,
  IconFileInvoice,
  IconHierarchy2,
  IconHistory,
  IconPaperclip,
  IconPencil,
  IconSend,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import PurchaseInlineForm from './PurchaseInlineForm';
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
  /** Estado del enlace con el flujo: draft (En Borrador), pending, approved, rejected, quoted… */
  authorizationStatus?: string;
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

/** Estado del flujo en SynerLink (el de SAP va aparte, en U_SEND_State). */
const FLOW: Record<string, { label: string; color: string }> = {
  draft: { label: 'En borrador', color: 'gray' },
  pending: { label: 'En autorización', color: 'yellow' },
  publishing: { label: 'Publicando en SAP', color: 'blue' },
  approved: { label: 'Aprobada', color: 'teal' },
  rejected: { label: 'No aprobada', color: 'red' },
  quoted: { label: 'En cotización', color: 'grape' },
  cancelled: { label: 'Anulada', color: 'gray' },
  publish_error: { label: 'Error al publicar', color: 'red' },
  reject_error: { label: 'Error al rechazar', color: 'red' },
};

function Label({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <Group gap={4} wrap="nowrap" c="dimmed">
      <Icon size={14} />
      <Text size="xs" c="dimmed">
        {children}
      </Text>
    </Group>
  );
}

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
  mb,
}: {
  requestId: string | number | null;
  /** Margen inferior (en el detalle de la solicitud va a todo el ancho, arriba). */
  mb?: string;
  /** Avisa si la solicitud es de compra (p. ej. para agrandar la ventana que la contiene). */
  onLoaded?: (isPurchase: boolean) => void;
}) {
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Los anexos se ven de entrada: es lo primero que revisa el autorizador.
  const [panel, setPanel] = useState<'anexos' | 'estado' | 'historial' | null>('anexos');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);

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
  }, [requestId, reload]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error}</Alert>;
  if (!purchase) return null; // no es una solicitud de compra

  const d = purchase.draft;
  const lines = d.DocumentLines ?? [];
  const numero = purchase.firmDocNum ?? purchase.firmDocEntry;
  const motivo = txt(d.U_Motivo_Can_Solicitud).trim();
  const flow = FLOW[purchase.authorizationStatus ?? ''];
  const isDraft = purchase.authorizationStatus === 'draft';
  const vendors = [...new Set(lines.map((l) => txt(l.U_NombreProveedor).trim()).filter(Boolean))];
  const columns = LINE_COLUMNS.filter(
    (c) => !c.optional || lines.some((l, i) => String(c.render(l, i) ?? '').trim() !== '')
  );

  const send = async () => {
    if (!window.confirm('¿Enviar la solicitud de compra a autorización del líder de área?')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/purchases/drafts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: purchase.companyId, docEntry: purchase.docEntry }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(x.error || 'No se pudo enviar a autorización');
      else toast.success('Solicitud enviada a autorización');
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
    }
  };

  const voidDraft = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/purchases/drafts/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: purchase.companyId, docEntry: purchase.docEntry, action: 'anular', reason: voidReason.trim() }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(x.error || 'No se pudo anular');
      else {
        toast.success('Solicitud anulada');
        setVoiding(false);
      }
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
    }
  };

  return (
    <Card withBorder radius="md" p="md" mb={mb} shadow="sm">
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap={8}>
          <IconFileInvoice size={20} />
          <Text fw={700}>
            Solicitud de compra en SAP · borrador #{purchase.docEntry}
            {numero ? ` · en firme N.º ${numero}` : ''}
          </Text>
        </Group>
        <Group gap={6}>
          <Badge variant="light" color={stateColor(d.U_SEND_State)} styles={{ root: { textTransform: 'none' } }}>
            {stateLabel(d.U_SEND_State)}
          </Badge>
          {flow && <Badge color={flow.color}>{flow.label}</Badge>}
        </Group>
      </Group>

      {isDraft && (
        <Alert color="gray" mb="sm" title="Solicitud en borrador">
          <Text size="sm">
            El borrador está en SAP en estado B, como en SAPSEND. Puede editarlo y, cuando esté listo, enviarlo a autorización
            del líder de área.
          </Text>
          <Group mt="xs" gap="xs">
            <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button size="xs" leftSection={<IconSend size={14} />} loading={busy} onClick={send}>
              Enviar a autorización
            </Button>
            <Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={14} />} onClick={() => setVoiding(true)}>
              Anular
            </Button>
          </Group>
        </Alert>
      )}
      {motivo ? (
        <Alert color="red" variant="light" mb="sm" title="Motivo de rechazo o anulación">
          {motivo}
        </Alert>
      ) : null}

      <Group gap="xl" mb="md" wrap="wrap">
        <div>
          <Label icon={IconUser}>Solicitante en SAP</Label>
          <Text size="sm" fw={600}>
            {txt(d.U_SEND_UserName) || '—'}
          </Text>
        </div>
        <div>
          <Label icon={IconBuildingStore}>Proveedor{vendors.length > 1 ? 'es' : ''}</Label>
          <Text size="sm">{vendors.length ? vendors.join(' · ') : '—'}</Text>
        </div>
        <div>
          <Label icon={IconCalendar}>Fecha / requerida</Label>
          <Text size="sm">
            {day(d.DocDate)} · {day(d.RequriedDate) || '—'}
          </Text>
        </div>
        <div>
          <Label icon={IconCash}>Total</Label>
          <Text size="sm" fw={700}>
            {money(d.DocTotal)} {txt(d.DocCurrency)}
          </Text>
          {d.DocTotalSys != null && (
            <Text size="xs" c="dimmed">
              USD {money(d.DocTotalSys)}
            </Text>
          )}
        </div>
      </Group>

      <Group gap="xs" mb="sm">
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
          Trazabilidad
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
      <Stack gap="sm" mb={panel ? 'md' : 0}>
        {panel === 'anexos' && (
          <AttachmentsPanel companyId={purchase.companyId} docEntry={purchase.docEntry} canUpload={false} requestId={requestId} />
        )}
        {panel === 'estado' && <TracePanel companyId={purchase.companyId} docEntry={purchase.docEntry} />}
        {panel === 'historial' && requestId != null && <ExecutionHistoryPanel requestId={requestId} />}
      </Stack>

      <Table.ScrollContainer minWidth={Math.max(600, columns.length * 95)}>
        <Table withTableBorder striped verticalSpacing={4} fz="xs">
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c.label} style={{ textAlign: c.align ?? 'left', whiteSpace: 'nowrap' }}>
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

      <Modal opened={editing} onClose={() => setEditing(false)} fullScreen title={<Text fw={700}>Editar solicitud de compra · borrador #{purchase.docEntry}</Text>}>
        {editing && (
          <PurchaseInlineForm
            companyId={String(purchase.companyId)}
            edit={{ docEntry: purchase.docEntry }}
            onDone={({ ok, message }) => {
              if (ok) toast.success(message);
              else toast.error(message);
              setEditing(false);
              setReload((n) => n + 1);
            }}
          />
        )}
      </Modal>
      <Modal opened={voiding} onClose={() => setVoiding(false)} title={<Text fw={700}>Anular solicitud de compra</Text>} centered>
        <Textarea
          label="Motivo"
          withAsterisk
          autosize
          minRows={2}
          maxLength={254}
          value={voidReason}
          onChange={(e) => setVoidReason(e.currentTarget.value)}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setVoiding(false)}>
            Cancelar
          </Button>
          <Button color="red" loading={busy} disabled={!voidReason.trim()} onClick={voidDraft}>
            Anular
          </Button>
        </Group>
      </Modal>
    </Card>
  );
}
