'use client';

import React, { useEffect, useRef, useState } from 'react';
import type ExcelJS from 'exceljs';
import { ActionIcon, Alert, Button, Group, Loader, NumberInput, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import { LINE_HEADERS, MAX_IMPORT_LINES, rowsToLines } from '../../../../lib/sales/linesImport';
import toast from 'react-hot-toast';
import SapLookupInput from '../purchases/SapLookupInput';
import SalesSearchModal, { type SearchKind } from './SalesSearchModal';
import SalesPdfImport, { type PdfOffer } from './SalesPdfImport';
import { sapErrorText } from '../../../../lib/purchases/sapErrorHint';

/**
 * Oferta de venta DENTRO de «Crear Nueva Solicitud» (Mis solicitudes), debajo del
 * proceso, igual que la solicitud de compra. Al enviar, el servidor crea la oferta en
 * SAP (cotización + borrador, como SAPSEND), abre la solicitud con el flujo «Oferta de
 * venta» y el flujo decide: pedido directo o autorizaciones (precio / cupo).
 */

interface Props {
  companyId: string;
  /** Ya no se usa: el asunto se arma solo (se conserva por compatibilidad). */
  subject?: string;
  onDone: (result: { ok: boolean; message: string }) => void;
  /** Editar una oferta guardada en borrador (DocEntry del borrador): misma ventana, ya llena. */
  editDocEntry?: number;
  /** Opción con la que arranca el formulario (el proceso «Pedido directo de venta» llega con 'directo'). */
  initialModo?: 'enviar' | 'borrador' | 'directo';
}

interface Line {
  ItemCode?: string;
  ItemDescription?: string;
  Quantity?: number | string;
  UnitPrice?: number | string;
  ListPrice?: number | null;
  WarehouseCode?: string;
  TaxCode?: string;
  /** Línea de la cotización a la que está enlazada (solo al editar un borrador). */
  BaseLine?: number | null;
  /** Nota de la IA al montar la oferta desde el PDF (p. ej. «Revisar: emparejado por descripción»). */
  aiNote?: string | null;
}

type Readiness = 'loading' | 'ready' | 'no-write' | 'no-sap';
/** Qué hace el botón al crear: enviar al flujo, guardar en borrador o pedido directo (si la empresa lo tiene). */
type Modo = 'enviar' | 'borrador' | 'directo';
type CompanyOptions = { pedidoDirecto: boolean; descripcionEditable: boolean; exigeOc: boolean };

/** Valor de celda de ExcelJS -> valor plano. */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  return v;
}

const notifySapError = (msg: string) => toast.error(sapErrorText(msg), { duration: 12000, style: { whiteSpace: 'pre-line', maxWidth: 520 } });
const empty = (v: unknown) => v == null || String(v).trim() === '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export default function SalesInlineForm({ companyId, onDone, editDocEntry, initialModo }: Props) {
  const editing = Boolean(editDocEntry);
  const [loadingDraft, setLoadingDraft] = useState(editing);
  const [readiness, setReadiness] = useState<Readiness>('loading');
  const [cardCode, setCardCode] = useState('');
  const [cardName, setCardName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [numAtCard, setNumAtCard] = useState('');
  const [comments, setComments] = useState('');
  const [pickRemark, setPickRemark] = useState('');
  const [opts, setOpts] = useState<CompanyOptions>({ pedidoDirecto: false, descripcionEditable: false, exigeOc: true });
  const [importing, setImporting] = useState(false);
  /** Avisos de la oferta montada desde el PDF (lo que no se pudo y lo que hay que revisar). */
  const [pdfAvisos, setPdfAvisos] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Puntos de entrega (direcciones de envío del cliente), como ModalLogistic de SAPSEND. */
  const [addresses, setAddresses] = useState<{ AddressName: string; Street: string; Block: string; City: string; County: string; Country: string; isDefault: boolean }[]>([]);
  const [shipTo, setShipTo] = useState('');
  const [payTo, setPayTo] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [saving, setSaving] = useState(false);
  /** Al crear: enviar a autorización, guardar en borrador (como SAPSEND) o pedido directo (si la empresa lo permite). */
  const [modo, setModo] = useState<Modo>(initialModo ?? 'enviar');
  const enviar = modo !== 'borrador';
  /** Búsqueda ampliada abierta («*» + Enter o lupa): tipo, línea y texto. */
  const [search, setSearch] = useState<{ kind: SearchKind; line?: number; q?: string; itemCode?: string; cardCode?: string } | null>(null);
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
        if (c?.options) setOpts(c.options);
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

  /** Al elegir el cliente: sus puntos de entrega y la dirección de facturación por defecto. */
  const loadCustomer = async (code: string, preferShipTo?: string) => {
    setAddresses([]);
    setShipTo('');
    setPayTo('');
    if (!code) return;
    try {
      const r = await fetch(`/api/sales/search?companyId=${companyId}&kind=customer_detail&cardCode=${encodeURIComponent(code)}`);
      const d = await r.json();
      if (!r.ok) return;
      const rows = (d.rows ?? []) as typeof addresses & { BilltoDefault?: string }[];
      setAddresses(rows);
      const def = rows.find((a) => a.isDefault) ?? (rows.length === 1 ? rows[0] : undefined);
      if (preferShipTo && rows.some((a) => a.AddressName === preferShipTo)) setShipTo(preferShipTo);
      else if (def) setShipTo(def.AddressName);
      setPayTo(String((rows[0] as { BilltoDefault?: string } | undefined)?.BilltoDefault ?? ''));
    } catch {
      /* el usuario puede seguir; SAP usa la dirección por defecto */
    }
  };
  // Editar: cargar el borrador guardado.
  useEffect(() => {
    if (!editDocEntry || readiness !== 'ready') return;
    let cancelled = false;
    setLoadingDraft(true);
    fetch(`/api/sales/drafts?companyId=${companyId}&docEntry=${editDocEntry}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'No se pudo abrir el borrador');
        const x = d.draft;
        setCardCode(String(x.cardCode ?? ''));
        setCardName(String(x.cardName ?? ''));
        setDueDate(String(x.dueDate ?? ''));
        setNumAtCard(String(x.numAtCard ?? ''));
        setPickRemark(String(x.pickRemark ?? ''));
        setComments(String(x.comments ?? ''));
        setLines((x.lines ?? []).length ? x.lines : [{}]);
        loadCustomer(String(x.cardCode ?? ''), String(x.shipTo ?? '')).then(() => x.payTo && setPayTo(String(x.payTo)));
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => !cancelled && setLoadingDraft(false));
    return () => {
      cancelled = true;
    };
  }, [editDocEntry, readiness, companyId]);

  const selectedAddress = addresses.find((a) => a.AddressName === shipTo);
  /** Asunto automático: «OV - NOMBRE DEL CLIENTE - NIT - OC del cliente» (sin OC, la primera línea). */
  const autoSubject = ['OV', cardName, cardCode, numAtCard.trim() ? `OC ${numAtCard.trim()}` : lines[0]?.ItemDescription ?? lines[0]?.ItemCode ?? ''].map((x) => String(x ?? '').trim()).filter(Boolean).join(' - ');

  /** Plantilla de líneas para el cargue desde Excel. */
  const downloadTemplate = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lineas');
    ws.addRow([...LINE_HEADERS]);
    ws.addRow(['10223', 10, '', '', '']);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => {
      col.width = 22;
    });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-lineas-oferta-venta.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Lee el Excel, valida las líneas contra SAP y las agrega a la oferta (precio de lista siempre de SAP). */
  const importExcel = async (file: File | null) => {
    if (!file) return;
    if (!cardCode) {
      toast.error('Elija primero el cliente: el precio de lista depende de él.');
      return;
    }
    setImporting(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('El archivo no tiene hojas.');
      const heads: string[] = [];
      ws.getRow(1).eachCell((cell, col) => {
        heads[col] = String(cellValue(cell.value) ?? '').trim();
      });
      const raw: { row: number; values: Record<string, unknown> }[] = [];
      for (let r = 2; r <= ws.rowCount && raw.length < MAX_IMPORT_LINES; r++) {
        const values: Record<string, unknown> = {};
        ws.getRow(r).eachCell((cell, col) => {
          if (heads[col]) values[heads[col]] = cellValue(cell.value);
        });
        raw.push({ row: r, values });
      }
      const parsed = rowsToLines(raw);
      if (!parsed.lines.length) throw new Error(parsed.errors[0]?.error ?? 'El archivo no tiene líneas. Use la plantilla.');
      const res = await fetch('/api/sales/lines-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), cardCode, lines: parsed.lines }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudieron validar las líneas en SAP');
      const errs = [...parsed.errors, ...(d.errors ?? [])] as { row: number; error: string }[];
      const ok = (d.lines ?? []) as Line[];
      if (ok.length) setLines((prev) => [...prev.filter((l) => !empty(l.ItemCode)), ...ok]);
      if (errs.length) {
        toast.error(`${ok.length} línea(s) cargada(s); ${errs.length} con error:\n${errs.slice(0, 8).map((e) => `Fila ${e.row}: ${e.error}`).join('\n')}${errs.length > 8 ? '\n…' : ''}`, { duration: 15000, style: { whiteSpace: 'pre-line', maxWidth: 560 } });
      } else toast.success(`${ok.length} línea(s) cargada(s) desde Excel.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const total = lines.reduce((a, l) => a + Number(l.Quantity || 0) * Number(l.UnitPrice || 0), 0);

  const submit = async () => {
    setTried(true);
    setErrors([]);
    const missing: string[] = [];
    if (!cardCode) missing.push('Cliente');
    if (!dueDate) missing.push('Fecha de entrega');
    if (opts.exigeOc && !numAtCard.trim()) missing.push('Orden de compra del cliente');
    if (addresses.length > 0 && !shipTo) missing.push('Punto de entrega');
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
      const res = await fetch(editing ? '/api/sales/drafts' : '/api/sales/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { accion: 'actualizar', docEntry: editDocEntry } : {}),
          companyId: Number(companyId),
          subject: autoSubject,
          header: { CardCode: cardCode, DocDueDate: dueDate, NumAtCard: numAtCard, Comments: comments || autoSubject, PickRemark: pickRemark || undefined, ShipToCode: shipTo || undefined, PayToCode: payTo || undefined },
          lines,
          modo,
          enviar,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notifySapError(String(data.error || 'No se pudo crear la oferta de venta'));
        setErrors(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      if (editing) {
        onDone({ ok: true, message: `Borrador #${editDocEntry} actualizado en SAP (cotización y borrador).` });
        return;
      }
      onDone({
        ok: true,
        message: data.saved
          ? `Oferta de venta #${data.docEntry} guardada en borrador: solicitud #${data.idRequest ?? '—'}. Ábrala en Mis solicitudes para editarla o enviarla a pedido.`
          : modo === 'directo'
            ? `Oferta #${data.docEntry} enviada a pedido directo: solicitud #${data.idRequest}. El pedido se crea en SAP sin autorizaciones.`
            : `Oferta de venta #${data.docEntry} creada. El flujo revisa precio y cupo y la envía a autorización si hace falta.`,
      });
    } catch {
      toast.error('Error de red al crear la oferta de venta');
    } finally {
      setSaving(false);
    }
  };

  if (readiness === 'loading' || (readiness === 'ready' && loadingDraft)) return <Loader size="sm" />;
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

  /** Oferta montada desde el PDF con la IA del navegador: llena cliente, punto de entrega, OC, fecha y líneas. */
  const loadFromPdf = (r: PdfOffer) => {
    if (!editing) {
      setCardCode(r.customer.CardCode);
      setCardName(r.customer.CardName);
      loadCustomer(r.customer.CardCode);
    }
    // Se suman a las filas que ya tenga la oferta (las vacías se descartan).
    setLines((prev) => [...prev.filter((l) => !empty(l.ItemCode)), ...(r.lines as Line[])]);
    if (r.numeroOrdenCompra) setNumAtCard(r.numeroOrdenCompra);
    if (r.fechaEntrega && r.fechaEntrega >= today()) setDueDate(r.fechaEntrega);
    const revisar = (r.lines as Line[]).filter((l) => String(l.aiNote ?? '').startsWith('Revisar')).length;
    setPdfAvisos([
      `Oferta montada desde el PDF: ${r.customer.CardName} · ${r.lines.length} línea(s)${r.leidas && r.leidas !== r.lines.length ? ` de ${r.leidas} leídas en el PDF` : ''}${r.numeroOrdenCompra ? ` · OC ${r.numeroOrdenCompra}` : ''}.`,
      ...(revisar ? [`${revisar} línea(s) marcadas «Revisar»: la IA eligió el artículo por la descripción y hay otros parecidos.`] : []),
      ...(!r.fechaEntrega || r.fechaEntrega < today() ? ['El PDF no trae una fecha de entrega válida: indíquela.'] : []),
      ...r.avisos,
    ]);
    toast.success(`${r.lines.length} línea(s) agregada(s) desde el PDF. Revise la oferta y créela.`);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="sm" c="dimmed">¿Tiene la orden de compra del cliente en PDF? La IA de su navegador la lee y monta la oferta.</Text>
        <SalesPdfImport companyId={companyId} cardCode={editing ? cardCode : undefined} onLoaded={loadFromPdf} />
      </Group>
      {pdfAvisos && (
        <Alert color="violet" variant="light" withCloseButton onClose={() => setPdfAvisos(null)} title="Revise antes de crear">
          {pdfAvisos.map((a, i) => <Text key={i} size="sm">{a}</Text>)}
        </Alert>
      )}
      <Group grow align="flex-start">
        {editing ? (
          <TextInput label="Cliente" value={`${cardCode} · ${cardName}`} readOnly description="En un borrador no se cambia el cliente (como en SAPSEND)." />
        ) : (
        <SapLookupInput
          label={<>Cliente <Text span c="red">*</Text></>}
          companyId={companyId}
          endpoint="/api/sales/lookup"
          kind="customer"
          value={cardCode}
          onChange={(v) => {
            setCardCode(v);
            setCardName('');
            setAddresses([]);
            setShipTo('');
          }}
          onSelect={(o) => {
            setCardCode(o.value);
            setCardName(o.fill?.CardName ?? '');
            loadCustomer(o.value);
          }}
          error={errorFor('CardCode') ?? (tried && !cardCode ? 'Obligatorio' : undefined)}
          ariaLabel="Cliente"
          onExpand={(q) => setSearch({ kind: 'customer', q })}
        />
        )}
        <TextInput
          label={<>Fecha de entrega <Text span c="red">*</Text></>}
          type="date"
          min={today()}
          value={dueDate}
          onChange={(e) => setDueDate(e.currentTarget.value)}
          error={errorFor('DocDueDate') ?? (tried && !dueDate ? 'Obligatorio' : undefined)}
        />
        <TextInput label={<>Orden de compra del cliente {opts.exigeOc && <Text span c="red">*</Text>}</>} description="Referencia del cliente: va en el asunto." value={numAtCard} maxLength={100}
          onChange={(e) => setNumAtCard(e.currentTarget.value)} error={errorFor('NumAtCard') ?? (tried && opts.exigeOc && !numAtCard.trim() ? 'Obligatorio' : undefined)} />
      </Group>
      {cardName && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {cardName}
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={() => setSearch({ kind: 'recent_orders', cardCode })}>
            Pedidos recientes
          </Button>
        </Group>
      )}
      {cardCode && cardName && (
        <Group grow align="flex-start">
          <Select
            label={<>Punto de entrega {addresses.length > 0 && <Text span c="red">*</Text>}</>}
            placeholder={addresses.length ? 'Elija el punto de entrega' : 'El cliente no tiene direcciones de envío en SAP'}
            data={addresses.map((a) => ({ value: a.AddressName, label: `${a.AddressName}${a.City ? ` · ${a.City}` : ''}${a.isDefault ? ' (por defecto)' : ''}` }))}
            value={shipTo || null}
            onChange={(v) => setShipTo(v ?? '')}
            disabled={!addresses.length}
            searchable
            comboboxProps={{ withinPortal: true, zIndex: 1100 }}
            error={tried && addresses.length > 0 && !shipTo ? 'Obligatorio' : undefined}
          />
          <div>
            <Text size="xs" c="dimmed">Dirección de entrega</Text>
            <Text size="sm">{selectedAddress ? [selectedAddress.Street, selectedAddress.Block, selectedAddress.City, selectedAddress.County, selectedAddress.Country].filter(Boolean).join(' · ') : '—'}</Text>
          </div>
        </Group>
      )}
      {autoSubject !== 'OV' && (
        <Text size="sm">
          <Text span c="dimmed">Asunto de la solicitud: </Text>
          {autoSubject}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        Consejo: escriba «*» y Enter (o use la lupa) en cliente, artículo o bodega para abrir la búsqueda ampliada, como en SAP.
      </Text>
      <Group grow align="flex-start">
        <Textarea label="Comentarios" description="Si lo deja vacío se usa el asunto automático." autosize minRows={2} maxLength={254} value={comments} onChange={(e) => setComments(e.currentTarget.value)} />
        <Textarea label="Observaciones de empaque" description="Indicaciones para bodega y despacho (como SAPSEND)." autosize minRows={2} maxLength={254} value={pickRemark} onChange={(e) => setPickRemark(e.currentTarget.value)} />
      </Group>

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
                      onExpand={(q) => setSearch({ kind: 'item', line: i, q, cardCode: cardCode || undefined })}
                    />
                  </Table.Td>
                  <Table.Td>
                    {opts.descripcionEditable && l.ItemCode ? (
                      <TextInput size="xs" value={l.ItemDescription ?? ''} maxLength={200} onChange={(e) => setLine(i, { ItemDescription: e.currentTarget.value })}
                        aria-label={`Descripción línea ${i + 1}`} description="Editable: así queda en la oferta y el pedido" />
                    ) : (
                      <Text size="xs">{l.ItemDescription ?? ''}</Text>
                    )}
                    {l.aiNote && <Text size="xs" c={String(l.aiNote).startsWith('Revisar') ? 'orange' : 'violet'}>✨ {l.aiNote}</Text>}
                    {l.ItemCode && l.ItemDescription && (
                      <Group gap={4}>
                        <Button size="compact-xs" variant="subtle" onClick={() => setSearch({ kind: 'warehouse_stock', line: i, itemCode: l.ItemCode })}>
                          Stock por bodega
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => setSearch({ kind: 'batches', line: i, itemCode: l.ItemCode })}>
                          Lotes
                        </Button>
                      </Group>
                    )}
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
                      error={errorFor(`DocumentLines[${i}].WarehouseCode`) ?? (tried && empty(l.WarehouseCode) ? 'Obligatorio' : undefined)} ariaLabel={`Bodega línea ${i + 1}`}
                      onExpand={() => (l.ItemCode ? setSearch({ kind: 'warehouse_stock', line: i, itemCode: l.ItemCode }) : toast.error('Elija primero el artículo para ver su stock por bodega.'))} />
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    {/* Solo lectura: el IVA viene parametrizado en SAP (artículo / socio de negocio). */}
                    <Text size="xs" c={l.TaxCode ? undefined : 'dimmed'} pt={6}>{l.TaxCode || 'Lo asigna SAP'}</Text>
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
          <Group gap="xs">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setLines((p) => [...p, {}])}>
              Agregar artículo
            </Button>
            <Button variant="subtle" leftSection={<IconFileSpreadsheet size={16} />} loading={importing} onClick={() => (cardCode ? fileRef.current?.click() : toast.error('Elija primero el cliente.'))}>
              Cargar líneas desde Excel
            </Button>
            <Button variant="subtle" color="gray" leftSection={<IconDownload size={16} />} onClick={downloadTemplate}>
              Plantilla
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => importExcel(e.currentTarget.files?.[0] ?? null)} />
          </Group>
          <Text fw={600}>Total antes de impuestos: {total.toLocaleString('es-CO')}</Text>
        </Group>
      </div>

      <Group justify="flex-end" style={{ position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--mantine-color-body)', paddingTop: 8, paddingBottom: 8, borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {editing ? (
          <Button leftSection={<IconSend size={16} />} onClick={submit} loading={saving} disabled={!cardCode}>
            Guardar cambios del borrador
          </Button>
        ) : (
          <>
        <Stack gap={2} mr="md">
          <SegmentedControl
            size="xs"
            value={modo}
            onChange={(v) => setModo(v as Modo)}
            data={[
              { value: 'enviar', label: 'Enviar a autorización' },
              { value: 'borrador', label: 'Guardar borrador' },
              ...(opts.pedidoDirecto ? [{ value: 'directo', label: 'Pedido directo' }] : []),
            ]}
          />
          <Text size="xs" c="dimmed">
            {modo === 'enviar' ? 'Entra al flujo: revisa precio y cupo y pide las autorizaciones' : modo === 'borrador' ? 'Queda en SAP en estado borrador, como en SAPSEND' : 'Crea el pedido en SAP sin autorizaciones'}
          </Text>
        </Stack>
        <Button leftSection={<IconSend size={16} />} onClick={submit} loading={saving} disabled={!cardCode} color={modo === 'borrador' ? 'gray' : undefined}>
          {modo === 'enviar' ? 'Crear oferta y enviar' : modo === 'borrador' ? 'Guardar borrador' : 'Crear pedido directo'}
        </Button>
          </>
        )}
      </Group>
      {search && (
        <SalesSearchModal
          opened
          onClose={() => setSearch(null)}
          companyId={companyId}
          kind={search.kind}
          initialQuery={search.q ?? ''}
          itemCode={search.itemCode}
          cardCode={search.cardCode}
          onSelect={(r) => {
            if (search.kind === 'customer') {
              setCardCode(String(r.CardCode));
              setCardName(String(r.CardName ?? ''));
              loadCustomer(String(r.CardCode));
            } else if (search.kind === 'item' && search.line != null) {
              const i = search.line;
              setLine(i, { ItemCode: String(r.ItemCode), ItemDescription: String(r.ItemName ?? ''), ...(r.DefaultWarehouse ? { WarehouseCode: String(r.DefaultWarehouse) } : {}), UnitPrice: undefined });
              loadPrice(i, String(r.ItemCode));
            } else if (search.kind === 'warehouse_stock' && search.line != null) {
              setLine(search.line, { WarehouseCode: String(r.WarehouseCode) });
            }
          }}
        />
      )}
    </Stack>
  );
}
