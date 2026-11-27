'use client';

import { useMemo, useRef, useState } from 'react';
import type ExcelJS from 'exceljs';
import { ActionIcon, Alert, Badge, Button, Group, NumberInput, Pagination, ScrollArea, Stack, Table, Text, Textarea } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet, IconPlus, IconRefresh, IconSend, IconTrash } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SapLookupInput from '../../purchases/SapLookupInput';
import { pctChange } from '../../../../../lib/prices/rules';

/**
 * "Price list update" inside "Nueva solicitud": customer, items and new price (typed or from Excel). Shows the
 * current SAP price and the change. On create, the request goes to approval and, once approved, a SAP task writes
 * the prices to the customer's list (or as a special price when its list is shared).
 */
type Ctx = { cardCode: string; cardName: string; priceListNum: number | null; priceListName: string | null; customersOnList: number; mode: 'list' | 'special' };
type Cur = { itemCode: string; itemName: string | null; exists: boolean; salesItem: boolean; current: number | null; currency: string | null; special: boolean };
type Line = { itemCode: string; itemName?: string; newPrice?: number | string };

const PAGE = 50;
const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);
const HEADERS = ['Codigo articulo', 'Precio nuevo'];

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  return v;
}

export default function PriceListForm({ companyId, onDone }: { companyId: string; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [cardCode, setCardCode] = useState('');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [lines, setLines] = useState<Line[]>([{ itemCode: '' }]);
  const [cur, setCur] = useState<Record<string, Cur>>({});
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCustomer = async (code: string) => {
    setCtx(null);
    if (!code) return;
    const r = await fetch(`/api/prices/context?companyId=${companyId}&cardCode=${encodeURIComponent(code)}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || 'No se pudo leer el cliente en SAP');
    setCtx(d.context);
  };

  /** Current SAP price of the items in the table (in one request). */
  const refresh = async (ls: Line[] = lines) => {
    const codes = [...new Set(ls.map((l) => l.itemCode.trim()).filter(Boolean))];
    if (!cardCode || !codes.length) return;
    setLoading(true);
    try {
      const r = await fetch('/api/prices/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: Number(companyId), cardCode, itemCodes: codes }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudieron leer los precios en SAP');
      setCtx(d.context);
      setCur((prev) => ({ ...prev, ...Object.fromEntries((d.prices as Cur[]).map((p) => [p.itemCode, p])) }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.itemCode.trim());
  const pages = Math.max(1, Math.ceil(lines.length / PAGE));
  const pg = Math.min(page, pages);
  const start = (pg - 1) * PAGE;
  const goingUp = useMemo(() => filled.filter((l) => { const c = cur[l.itemCode]?.current; return c != null && Number(l.newPrice) > c; }).length, [filled, cur]);

  const downloadTemplate = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Precios');
    ws.addRow(HEADERS);
    ws.addRow(['10223', 104000]);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 22; });
    const url = URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-actualizacion-precios.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importExcel = async (file: File | null) => {
    if (!file) return;
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('El archivo no tiene hojas.');
      const heads: string[] = [];
      ws.getRow(1).eachCell((c, col) => { heads[col] = String(cellValue(c.value) ?? '').toLowerCase(); });
      const colCode = heads.findIndex((h) => h && /c[oó]digo|art[ií]culo|itemcode|referencia/.test(h));
      const colPrice = heads.findIndex((h) => h && /precio/.test(h));
      if (colCode < 1 || colPrice < 1) throw new Error('Use la plantilla: columnas «Codigo articulo» y «Precio nuevo».');
      const added: Line[] = [];
      for (let r = 2; r <= ws.rowCount && added.length < 300; r++) {
        const row = ws.getRow(r);
        const code = String(cellValue(row.getCell(colCode).value) ?? '').trim();
        const price = cellValue(row.getCell(colPrice).value);
        if (code) added.push({ itemCode: code, newPrice: typeof price === 'number' ? price : String(price ?? '') });
      }
      const merged = [...lines.filter((l) => l.itemCode.trim()), ...added];
      setLines(merged.length ? merged : [{ itemCode: '' }]);
      setPage(1);
      toast.success(`${added.length} artículo(s) cargados desde Excel.`);
      await refresh(merged);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!cardCode) return toast.error('Elija el cliente.');
    if (!filled.length) return toast.error('Agregue al menos un artículo.');
    const missingPrice = filled.filter((l) => !(Number(l.newPrice) > 0)).map((l) => l.itemCode);
    if (missingPrice.length) return toast.error(`Falta el precio nuevo en: ${missingPrice.slice(0, 8).join(', ')}`);
    setSaving(true);
    try {
      const r = await fetch('/api/prices/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), cardCode, comment, lines: filled.map((l) => ({ itemCode: l.itemCode.trim(), newPrice: Number(l.newPrice) })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo crear la solicitud');
      onDone({ ok: true, message: `Solicitud #${d.idRequest} creada: ${filled.length} precio(s) para ${ctx?.cardName ?? cardCode}. Va a autorización; al aprobarse se actualizan en SAP.` });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <SapLookupInput label={<>Cliente <Text span c="red">*</Text></>} companyId={companyId} endpoint="/api/sales/lookup" kind="customer" value={cardCode}
        onChange={(v) => { setCardCode(v); setCtx(null); }} onSelect={(o) => { setCardCode(o.value); loadCustomer(o.value); }} ariaLabel="Cliente" />
      {ctx && (
        <Alert color={ctx.mode === 'list' ? 'blue' : 'violet'} variant="light">
          <Text size="sm"><b>{ctx.cardName}</b> · lista de precios <b>{ctx.priceListName ?? ctx.priceListNum ?? 'sin lista'}</b></Text>
          <Text size="sm">
            {ctx.mode === 'list'
              ? 'Es la lista propia del cliente: al autorizar, se actualiza el precio en esa lista.'
              : 'Esa lista la comparten otros clientes (o no aplica): al autorizar, se crea un PRECIO ESPECIAL solo para este cliente; la lista no se toca.'}
          </Text>
        </Alert>
      )}
      <Group justify="space-between" wrap="wrap">
        <Text fw={600} size="sm">Artículos · {filled.length}{goingUp ? ` · ${goingUp} suben de precio` : ''}</Text>
        <Group gap="xs">
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={loading} disabled={!cardCode} onClick={() => refresh()}>Ver precio actual</Button>
          <Button size="xs" variant="subtle" leftSection={<IconFileSpreadsheet size={14} />} disabled={!cardCode} onClick={() => fileRef.current?.click()}>Cargar desde Excel</Button>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconDownload size={14} />} onClick={downloadTemplate}>Plantilla</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => importExcel(e.currentTarget.files?.[0] ?? null)} />
        </Group>
      </Group>
      <ScrollArea type="auto">
        <Table withTableBorder verticalSpacing={4} style={{ minWidth: 820 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 40 }}>#</Table.Th><Table.Th style={{ minWidth: 200 }}>Artículo</Table.Th><Table.Th>Descripción</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Precio actual</Table.Th><Table.Th style={{ minWidth: 150 }}>Precio nuevo</Table.Th><Table.Th style={{ textAlign: 'right' }}>Variación</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.slice(start, start + PAGE).map((l, j) => {
              const i = start + j;
              const c = cur[l.itemCode];
              const v = pctChange(c?.current, Number(l.newPrice));
              return (
                <Table.Tr key={i}>
                  <Table.Td><Text size="xs">{i + 1}</Text></Table.Td>
                  <Table.Td>
                    <SapLookupInput size="xs" companyId={companyId} endpoint="/api/sales/lookup" kind="item" value={l.itemCode}
                      onChange={(val) => setLine(i, { itemCode: val })} onSelect={(o) => { setLine(i, { itemCode: o.value, itemName: o.fill?.ItemDescription }); }} ariaLabel={`Artículo ${i + 1}`} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{c?.itemName ?? l.itemName ?? ''}</Text>
                    {c && !c.exists && <Text size="xs" c="red">No existe en SAP</Text>}
                    {c && c.exists && !c.salesItem && <Text size="xs" c="red">No es de venta</Text>}
                    {c?.special && <Badge size="xs" variant="light">precio especial vigente</Badge>}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{money(c?.current)}</Text></Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" min={0} allowNegative={false} thousandSeparator="." decimalSeparator="," value={l.newPrice ?? ''} onChange={(val) => setLine(i, { newPrice: val })} aria-label={`Precio nuevo ${i + 1}`} />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {v == null ? '—' : <Text size="sm" fw={600} c={v > 0 ? 'orange' : v < 0 ? 'teal' : undefined}>{v > 0 ? '+' : ''}{v} %</Text>}
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, k) => k !== i))} aria-label={`Quitar ${i + 1}`}><IconTrash size={16} /></ActionIcon>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {pages > 1 && <Group justify="center"><Pagination size="sm" total={pages} value={pg} onChange={setPage} /></Group>}
      <Group>
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => { setLines((p) => [...p, { itemCode: '' }]); setPage(Math.ceil((lines.length + 1) / PAGE)); }}>Agregar artículo</Button>
      </Group>
      <Textarea label="Comentario / soporte de la negociación" description="Por ejemplo: «Renegociado con Viviana el 27-nov; precio vigente para el cliente»." autosize minRows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button leftSection={<IconSend size={16} />} loading={saving} disabled={!cardCode || !filled.length} onClick={submit}>Enviar a autorización</Button>
      </Group>
    </Stack>
  );
}
