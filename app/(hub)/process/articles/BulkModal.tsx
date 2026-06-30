'use client';

import React, { useState } from 'react';
import ExcelJS from 'exceljs';
import { Modal, Select, Button, Group, Stack, Alert, Text, FileButton, Divider } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { TEMPLATE_COLUMNS } from '../../../../lib/articles/fields';

interface WritableCompany {
  idCompany: number;
  companyName: string;
}
interface Props {
  opened: boolean;
  onClose: () => void;
  companies: WritableCompany[];
  onLoaded: () => void;
}
interface BulkReport {
  summary: { total: number; creados: number; duplicados: number; fallidos: number };
  ok: { row: number; itemCode: string }[];
  duplicated: { row: number; itemCode: string; reason: string }[];
  failed: { row: number; itemCode: string; error: string }[];
}

const HEADER_TO_FIELD = new Map(TEMPLATE_COLUMNS.map((c) => [c.header, c.field]));

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text).trim();
  }
  return String(value).trim();
}

export default function BulkModal({ opened, onClose, companies, onLoaded }: Props) {
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0] ? String(companies[0].idCompany) : null
  );
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<BulkReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Articulos');
    ws.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-cargue-masivo-articulos.xlsx';
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
        setError('El archivo no tiene hojas');
        return;
      }
      const headerRow = ws.getRow(1);
      const colFields: (string | null)[] = [];
      headerRow.eachCell((cell, col) => {
        colFields[col] = HEADER_TO_FIELD.get(String(cell.value).trim()) ?? null;
      });

      const parsed: Record<string, string>[] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const obj: Record<string, string> = {};
        let hasData = false;
        row.eachCell((cell, col) => {
          const field = colFields[col];
          if (!field) return;
          const val = cellToString(cell.value);
          if (val) {
            obj[field] = val;
            hasData = true;
          }
        });
        if (hasData) parsed.push(obj);
      }
      setRows(parsed);
    } catch {
      setError('No se pudo leer el archivo. Use la plantilla.');
    }
  };

  const upload = async () => {
    if (!companyId) return setError('Seleccione una empresa');
    if (rows.length === 0) return setError('Cargue un archivo con datos');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/articles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Fallo el cargue');
        return;
      }
      setReport(data);
      onLoaded();
    } catch {
      setError('Error de red durante el cargue');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setRows([]);
    setFileName('');
    setReport(null);
    setError(null);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="Cargue masivo de articulos" size="lg">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}

        <Select
          label="Empresa"
          required
          data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
          value={companyId}
          onChange={setCompanyId}
          allowDeselect={false}
        />

        <Group>
          <Button variant="light" leftSection={<IconDownload size={16} />} onClick={downloadTemplate}>
            Descargar plantilla
          </Button>
          <FileButton onChange={readFile} accept=".xlsx">
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconUpload size={16} />}>
                Subir archivo
              </Button>
            )}
          </FileButton>
        </Group>

        {fileName && (
          <Text size="sm">
            Archivo: <b>{fileName}</b> — {rows.length} fila(s) con datos.
          </Text>
        )}

        {report && (
          <>
            <Divider label="Resultado" />
            <Text size="sm">
              Creados: <b>{report.summary.creados}</b> · Duplicados: <b>{report.summary.duplicados}</b> · Fallidos:{' '}
              <b>{report.summary.fallidos}</b> (de {report.summary.total})
            </Text>
            {report.duplicated.length > 0 && (
              <Alert color="yellow" title={`Omitidos por duplicado (${report.duplicated.length})`}>
                {report.duplicated.slice(0, 20).map((d) => `Fila ${d.row} (${d.itemCode}): ${d.reason}`).join(' · ')}
              </Alert>
            )}
            {report.failed.length > 0 && (
              <Alert color="red" title={`Fallidos (${report.failed.length})`}>
                {report.failed.slice(0, 20).map((f) => `Fila ${f.row} (${f.itemCode}): ${f.error}`).join(' · ')}
              </Alert>
            )}
          </>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={close} disabled={loading}>Cerrar</Button>
          <Button onClick={upload} loading={loading} disabled={rows.length === 0}>
            Cargar {rows.length > 0 ? `(${rows.length})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
