'use client';

import React, { useState } from 'react';
import ExcelJS from 'exceljs';
import { Modal, Select, Button, Group, Stack, Alert, Text, FileButton, Table, ScrollArea } from '@mantine/core';
import { IconDownload, IconUpload, IconCircleCheck, IconAlertTriangle, IconEye } from '@tabler/icons-react';
import { TEMPLATE_COLUMNS, DATE_FIELDS } from '../../../../lib/health-records/fields';

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
  dryRun?: boolean;
  summary: { total: number; creados: number; duplicados: number; fallidos: number };
  ok: { row: number; registro: string; docNum: number }[];
  duplicated: { row: number; registro: string; reason: string }[];
  failed: { row: number; registro: string; error: string }[];
}

const HEADER_TO_FIELD = new Map(TEMPLATE_COLUMNS.map((c) => [c.header, c.field]));

function cellToString(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text).trim();
  }
  let s = String(value).trim();
  if (DATE_FIELDS.includes(field) && s) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) s = d.toISOString().slice(0, 10);
  }
  return s;
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
    const ws = wb.addWorksheet('Registros Sanitarios');
    ws.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-cargue-masivo-registros-sanitarios.xlsx';
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
          const val = cellToString(cell.value, field);
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

  const upload = async (dryRun = false) => {
    if (!companyId) return setError('Seleccione una empresa');
    if (rows.length === 0) return setError('Cargue un archivo con datos');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health-records/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), rows, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Fallo el cargue');
        return;
      }
      // OJO: NO llamar onLoaded() aqui. Dispara el loading de la pagina padre,
      // que reemplaza toda la vista por un spinner y DESMONTA este modal,
      // perdiendo el reporte (el usuario veia "se cerro / no salio nada").
      // La lista se refresca al cerrar el modal (ver close()).
      setReport(data);
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
    onLoaded();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="Cargue masivo de registros sanitarios" size="lg">
      <Stack gap="sm">
        {error && <Alert color="red" title="Error" icon={<IconAlertTriangle size={18} />}>{error}</Alert>}

        {report && (
          <>
            <Alert
              color={report.summary.fallidos > 0 ? 'red' : report.summary.creados > 0 ? 'green' : 'blue'}
              title={report.dryRun ? 'Simulación (no se creó nada)' : 'Resultado del cargue'}
              icon={report.summary.fallidos > 0 ? <IconAlertTriangle size={18} /> : <IconCircleCheck size={18} />}
              withCloseButton
              onClose={() => setReport(null)}
            >
              <Text size="sm">
                {report.dryRun ? 'Se crearían' : 'Creados'}: <b>{report.summary.creados}</b> ·{' '}
                Duplicados/omitidos: <b>{report.summary.duplicados}</b> ·{' '}
                Con error: <b>{report.summary.fallidos}</b> (de {report.summary.total})
              </Text>
            </Alert>

            {report.failed.length > 0 && (
              <div>
                <Text size="sm" fw={600} c="red" mb={4}>
                  Filas con error ({report.failed.length})
                </Text>
                <ScrollArea.Autosize mah={220}>
                  <Table striped withTableBorder withColumnBorders stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={60}>Fila</Table.Th>
                        <Table.Th>Registro Sanitario</Table.Th>
                        <Table.Th>Error</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {report.failed.map((f) => (
                        <Table.Tr key={`f-${f.row}`}>
                          <Table.Td>{f.row}</Table.Td>
                          <Table.Td>{f.registro || '-'}</Table.Td>
                          <Table.Td>{f.error}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </div>
            )}

            {report.duplicated.length > 0 && (
              <div>
                <Text size="sm" fw={600} c="yellow.8" mb={4}>
                  Omitidos por duplicado ({report.duplicated.length})
                </Text>
                <ScrollArea.Autosize mah={180}>
                  <Table striped withTableBorder withColumnBorders stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={60}>Fila</Table.Th>
                        <Table.Th>Registro Sanitario</Table.Th>
                        <Table.Th>Motivo</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {report.duplicated.map((d) => (
                        <Table.Tr key={`d-${d.row}`}>
                          <Table.Td>{d.row}</Table.Td>
                          <Table.Td>{d.registro || '-'}</Table.Td>
                          <Table.Td>{d.reason}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </div>
            )}
          </>
        )}

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

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={close} disabled={loading}>Cerrar</Button>
          <Button
            variant="light"
            leftSection={<IconEye size={16} />}
            onClick={() => upload(true)}
            loading={loading}
            disabled={rows.length === 0}
          >
            Simular
          </Button>
          <Button onClick={() => upload(false)} loading={loading} disabled={rows.length === 0}>
            Cargar {rows.length > 0 ? `(${rows.length})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
