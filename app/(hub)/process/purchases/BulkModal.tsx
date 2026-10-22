'use client';

import React, { useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import { Alert, Button, Checkbox, Divider, FileButton, Group, List, Modal, Select, Stack, Table, Text } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { BULK_HEADERS, BULK_MAX_GROUPS, groupBulkRows, type BulkRow } from '../../../../lib/purchases/bulk';
import type { WritableCompany } from './RequestFormModal';

/**
 * Carga masiva de solicitudes de compra desde Excel (misma plantilla de 17
 * columnas de SAPSEND). Un borrador por proveedor; opcionalmente cada uno se
 * envia a autorizar. Nunca aprueba en firme: eso lo decide el autorizador.
 */

interface GroupResult {
  cardCode: string;
  rows: number[];
  ok: boolean;
  docEntry?: number;
  sent?: boolean;
  error?: string;
  errors?: { field: string; error: string }[];
}

interface BulkReport {
  created: number;
  failed: number;
  results: GroupResult[];
  invalid: { row: number; reason: string }[];
  priceWarnings: { cardCode: string; itemCode: string; reason: string }[];
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
  companies: WritableCompany[];
}

/** Valor de celda de ExcelJS -> valor plano (fechas se conservan como Date). */
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

export default function BulkModal({ opened, onClose, onDone, companies }: Props) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [send, setSend] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BulkReport | null>(null);

  useEffect(() => {
    if (!opened) return;
    setCompanyId(companies.length === 1 ? String(companies[0].idCompany) : null);
    setRows([]);
    setFileName('');
    setError(null);
    setReport(null);
  }, [opened, companies]);

  const preview = rows.length > 0 ? groupBulkRows(rows) : null;

  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Solicitudes');
    ws.addRow([...BULK_HEADERS]);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => {
      col.width = 18;
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-cargue-masivo-solicitudes-compra.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setReport(null);
    setFileName(file.name);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) {
        setError('El archivo no tiene hojas.');
        return;
      }
      const known = new Set<string>(BULK_HEADERS);
      const colFields: (string | null)[] = [];
      ws.getRow(1).eachCell((cell, col) => {
        const h = String(cellValue(cell.value) ?? '').trim();
        colFields[col] = known.has(h) ? h : null;
      });
      if (!colFields.includes('CardCode') || !colFields.includes('ItemCode')) {
        setError('El archivo no tiene los encabezados de la plantilla (CardCode, ItemCode, ...). Use la plantilla.');
        setRows([]);
        return;
      }
      const parsed: BulkRow[] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const obj: Record<string, unknown> = {};
        let hasData = false;
        ws.getRow(r).eachCell((cell, col) => {
          const field = colFields[col];
          const val = cellValue(cell.value);
          if (!field || val === null || val === '') return;
          obj[field] = val;
          hasData = true;
        });
        if (hasData) parsed.push(obj as BulkRow);
      }
      setRows(parsed);
    } catch {
      setError('No se pudo leer el archivo. Use la plantilla en formato .xlsx.');
    }
  };

  const upload = async () => {
    if (!companyId) return setError('Seleccione la empresa.');
    if (rows.length === 0) return setError('Cargue un archivo con datos.');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/purchases/drafts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), rows, send }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo procesar la carga.');
        return;
      }
      setReport(data as BulkReport);
      onDone();
    } catch {
      setError('Error de red al procesar la carga.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Carga masiva de solicitudes de compra" size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Se crea un borrador por proveedor (CardCode). Obligatorios por fila: CardCode, ItemCode y Quantity. Si no trae
          precio, se toma de la lista de precios del proveedor. Maximo {BULK_MAX_GROUPS} proveedores por carga.
        </Text>

        {error && <Alert color="red">{error}</Alert>}

        <Group grow align="flex-end">
          <Select
            label="Empresa"
            data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
            value={companyId}
            onChange={setCompanyId}
            allowDeselect={false}
            required
          />
          <Button variant="light" leftSection={<IconDownload size={16} />} onClick={downloadTemplate}>
            Descargar plantilla
          </Button>
          <FileButton onChange={readFile} accept=".xlsx">
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconUpload size={16} />}>
                {fileName || 'Seleccionar Excel'}
              </Button>
            )}
          </FileButton>
        </Group>

        {preview && !report && (
          <Alert color={preview.groups.length > BULK_MAX_GROUPS ? 'red' : 'blue'} variant="light">
            {rows.length} fila(s) leidas: {preview.groups.length} borrador(es) por proveedor
            {preview.invalid.length > 0 ? `, ${preview.invalid.length} fila(s) se descartaran por datos faltantes` : ''}.
          </Alert>
        )}

        <Checkbox
          checked={send}
          onChange={(e) => setSend(e.currentTarget.checked)}
          label="Enviar cada borrador a autorizar al crearlo"
        />

        {report && (
          <>
            <Divider />
            <Alert color={report.failed === 0 ? 'green' : 'yellow'}>
              {report.created} borrador(es) creado(s), {report.failed} con error.
            </Alert>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Filas</Table.Th>
                  <Table.Th>Resultado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.results.map((r) => (
                  <Table.Tr key={r.cardCode}>
                    <Table.Td>{r.cardCode}</Table.Td>
                    <Table.Td>{r.rows.join(', ')}</Table.Td>
                    <Table.Td>
                      {r.ok ? `Borrador #${r.docEntry}${r.sent ? ' · enviado a autorizar' : ''}` : r.error}
                      {r.ok && r.error ? ` · ${r.error}` : ''}
                      {r.errors && r.errors.length > 0 && (
                        <List size="xs">
                          {r.errors.map((e) => (
                            <List.Item key={`${e.field}-${e.error}`}>
                              {e.field}: {e.error}
                            </List.Item>
                          ))}
                        </List>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {(report.invalid.length > 0 || report.priceWarnings.length > 0) && (
              <List size="sm">
                {report.invalid.map((i) => (
                  <List.Item key={`inv-${i.row}`}>
                    Fila {i.row}: {i.reason}
                  </List.Item>
                ))}
                {report.priceWarnings.map((w) => (
                  <List.Item key={`pw-${w.cardCode}-${w.itemCode}`}>
                    {w.cardCode} / {w.itemCode}: {w.reason}
                  </List.Item>
                ))}
              </List>
            )}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cerrar
          </Button>
          {!report && (
            <Button onClick={upload} loading={loading} disabled={!companyId || rows.length === 0}>
              Procesar carga
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
