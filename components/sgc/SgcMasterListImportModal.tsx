'use client';

import React, { useState } from 'react';
import { Modal, Button, Group, Stack, Alert, Text, FileButton, Table, ScrollArea } from '@mantine/core';
import { IconDownload, IconUpload, IconCircleCheck, IconAlertTriangle, IconEye } from '@tabler/icons-react';
import { masterListFieldLabel, type SgcMasterListRawRow } from '../../lib/sgc/masterListImport';
import { SGC_MASTER_LIST_TEMPLATE_NAME, buildMasterListTemplate, readMasterListWorkbook, type SgcTemplateCatalogs } from '../../lib/sgc/masterListWorkbook';
import { sgcSend } from './useSgcFetch';

/**
 * «Cargar listado maestro (Excel)» — Sprint 8. COPIA CONGELADA del cargue
 * masivo de SynerLink (Registros sanitarios, app/(hub)/process/health-records/
 * BulkModal.tsx): mismo modal, mismos botones («Descargar plantilla», «Subir
 * archivo», «Simular», «Cargar») y mismo reporte por filas. Diferencias
 * propias del SGC: la empresa sale del selector del módulo (no hay selector
 * en el modal) y «Simular» muestra la VISTA PREVIA con los errores y las
 * advertencias por fila antes de confirmar.
 */

interface Props {
  opened: boolean;
  onClose: () => void;
  idCompany: number;
  catalogs: SgcTemplateCatalogs;
  onLoaded: () => void;
}
interface Item {
  rowNumber: number;
  code: string;
  title: string;
  status: 'ok' | 'error';
  errors: string[];
  warnings: string[];
}
interface Report {
  dryRun?: boolean;
  items: Item[];
  summary: { total: number; ok: number; errors: number; warnings: number };
  rowsSha256: string;
}

function download(buf: ArrayBuffer, name: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SgcMasterListImportModal({ opened, onClose, idCompany, catalogs, onLoaded }: Props) {
  const [rows, setRows] = useState<SgcMasterListRawRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [previewSha, setPreviewSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = async () => {
    download(await buildMasterListTemplate(catalogs), SGC_MASTER_LIST_TEMPLATE_NAME);
  };

  const readFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setReport(null);
    setPreviewSha(null);
    setFileName(file.name);
    try {
      const table = await readMasterListWorkbook(await file.arrayBuffer());
      if (table.missingColumns.length) {
        setRows([]);
        setError(`Faltan columnas obligatorias: ${table.missingColumns.map(masterListFieldLabel).join(', ')}. Use la plantilla.`);
        return;
      }
      setRows(table.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo. Use la plantilla.');
    }
  };

  const upload = async (dryRun = false) => {
    if (rows.length === 0) return setError('Cargue un archivo con datos');
    setLoading(true);
    setError(null);
    try {
      const data = await sgcSend<Report>('/api/sgc/master-list', 'POST', { company: idCompany, fileName, rows, confirm: !dryRun, expectedSha256: dryRun ? undefined : previewSha });
      // Igual que en SynerLink: NO se llama onLoaded() aquí (desmontaría el modal y se perdería el reporte);
      // la pantalla se refresca al cerrar el modal.
      setReport({ ...data, dryRun });
      if (dryRun) setPreviewSha(data.rowsSha256);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló la carga');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setRows([]);
    setFileName('');
    setReport(null);
    setPreviewSha(null);
    setError(null);
    onLoaded();
    onClose();
  };

  const failed = report?.items.filter((i) => i.status === 'error') ?? [];
  const warned = report?.items.filter((i) => i.status === 'ok' && i.warnings.length > 0) ?? [];

  return (
    <Modal opened={opened} onClose={close} title='Cargar listado maestro (Excel)' size='lg'>
      <Stack gap='sm' data-testid='sgc-listado-importar'>
        {error && (
          <Alert color='red' title='Error' icon={<IconAlertTriangle size={18} />} data-testid='sgc-listado-importar-error'>
            {error}
          </Alert>
        )}

        {report && (
          <>
            <Alert
              color={report.summary.errors > 0 ? 'red' : report.summary.ok > 0 ? 'green' : 'blue'}
              title={report.dryRun ? 'Vista previa (no se cargó nada)' : 'Resultado de la carga'}
              icon={report.summary.errors > 0 ? <IconAlertTriangle size={18} /> : <IconCircleCheck size={18} />}
              withCloseButton
              onClose={() => setReport(null)}
              data-testid='sgc-listado-importar-resumen'
            >
              <Text size='sm'>
                {report.dryRun ? 'Se cargarían' : 'Cargados como pendientes de archivo'}: <b>{report.summary.ok}</b> · Con error (no se cargan): <b>{report.summary.errors}</b>
                {report.summary.warnings ? (
                  <>
                    {' '}
                    · Advertencias: <b>{report.summary.warnings}</b>
                  </>
                ) : null}{' '}
                (de {report.summary.total})
              </Text>
            </Alert>

            {failed.length > 0 && (
              <div>
                <Text size='sm' fw={600} c='red' mb={4}>
                  Filas con error ({failed.length})
                </Text>
                <ScrollArea.Autosize mah={220}>
                  <Table striped withTableBorder withColumnBorders stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={60}>Fila</Table.Th>
                        <Table.Th>Código</Table.Th>
                        <Table.Th>Error</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {failed.map((f) => (
                        <Table.Tr key={`f-${f.rowNumber}`} data-testid='sgc-listado-fila-error'>
                          <Table.Td>{f.rowNumber}</Table.Td>
                          <Table.Td>{f.code || '-'}</Table.Td>
                          <Table.Td>{f.errors.join(' ')}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </div>
            )}

            {warned.length > 0 && (
              <div>
                <Text size='sm' fw={600} c='orange.7' mb={4}>
                  Advertencias — se cargan, pero conviene revisarlas ({warned.length})
                </Text>
                <ScrollArea.Autosize mah={180}>
                  <Table striped withTableBorder withColumnBorders stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={60}>Fila</Table.Th>
                        <Table.Th>Código</Table.Th>
                        <Table.Th>Advertencia</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {warned.map((w) => (
                        <Table.Tr key={`w-${w.rowNumber}`}>
                          <Table.Td>{w.rowNumber}</Table.Td>
                          <Table.Td>{w.code}</Table.Td>
                          <Table.Td>{w.warnings.join(' ')}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </div>
            )}
          </>
        )}

        <Group>
          <Button variant='light' leftSection={<IconDownload size={16} />} onClick={downloadTemplate} data-testid='sgc-listado-plantilla'>
            Descargar plantilla
          </Button>
          <FileButton onChange={readFile} accept='.xlsx'>
            {(props) => (
              <Button {...props} variant='default' leftSection={<IconUpload size={16} />} data-testid='sgc-listado-subir'>
                Subir archivo
              </Button>
            )}
          </FileButton>
        </Group>

        {fileName && (
          <Text size='sm'>
            Archivo: <b>{fileName}</b> — {rows.length} fila(s) con datos.
          </Text>
        )}

        <Group justify='flex-end' mt='sm'>
          <Button variant='default' onClick={close} disabled={loading}>
            Cerrar
          </Button>
          <Button variant='light' leftSection={<IconEye size={16} />} onClick={() => upload(true)} loading={loading} disabled={rows.length === 0} data-testid='sgc-listado-simular'>
            Simular
          </Button>
          <Button onClick={() => upload(false)} loading={loading} disabled={rows.length === 0 || !previewSha || report?.dryRun !== true || report.summary.ok === 0} data-testid='sgc-listado-cargar'>
            Cargar {report?.dryRun && report.summary.ok > 0 ? `(${report.summary.ok})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
