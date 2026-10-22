'use client';

import React, { useMemo, useState } from 'react';
import { Modal, Button, Group, Stack, Alert, Text, FileButton, Table, ScrollArea, Progress, Badge } from '@mantine/core';
import { IconUpload, IconCircleCheck, IconAlertTriangle, IconEye, IconAdjustments } from '@tabler/icons-react';
import { sgcSend } from './useSgcFetch';
import SgcSheetSettingsModal, { bulkFileSheetSource } from './SgcSheetSettingsModal';
import { describeSheetSettings, type SgcSheetSettings } from '../../lib/sgc/sheetSettings';

/**
 * «Cargar archivos (PDF)» del listado maestro — Sprint 9. Misma pantalla del
 * cargue masivo de SynerLink (Registros sanitarios) que ya usa «Cargar
 * listado maestro (Excel)»: subir, «Simular» (con qué documento se empareja
 * cada archivo y si su nombre coincide con el del listado) y «Cargar». Los
 * archivos se suben de a uno, con su avance, y cada resultado queda en la
 * tabla y en el historial de la carga.
 *
 * 2026-10-21 (Calidad OLP): cada Excel que se va a cargar tiene «Ajustar y
 * previsualizar» (SgcSheetSettingsModal): se ve el PDF que saldría y se
 * ajusta su presentación antes de cargarlo; sin ajustes, el automático.
 */

interface Props {
  opened: boolean;
  onClose: () => void;
  idCompany: number;
  onLoaded: () => void;
}
interface Row {
  fileName: string;
  code: string | null;
  title?: string | null;
  status: string;
  warning: string | null;
  error: string | null;
}

export default function SgcBulkFilesModal({ opened, onClose, idCompany, onLoaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-10-21: ajustes de presentación por archivo Excel (nombre → ajustes); sin entrada = automático.
  const [sheetSettings, setSheetSettings] = useState<Record<string, SgcSheetSettings>>({});
  const [adjusting, setAdjusting] = useState<File | null>(null);
  // Se arma al abrir el ajuste de un archivo (con los ajustes que ya tenía); estable mientras la ventana sigue abierta.
  const adjustingSource = useMemo(() => (adjusting ? bulkFileSheetSource(idCompany, adjusting, sheetSettings[adjusting.name] ?? null) : null), [adjusting, idCompany]);

  const pick = (list: File[] | null) => {
    setError(null);
    setRows(null);
    setDone(0);
    setSheetSettings({});
    setFiles(list ?? []);
  };

  const simulate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sgcSend<{ files: Row[] }>('/api/sgc/master-list/files', 'POST', { company: idCompany, action: 'vista_previa', fileNames: files.map((f) => f.name) });
      setRows(res.files);
      setDryRun(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló la vista previa');
    } finally {
      setLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setDone(0);
    setDryRun(false);
    setRows([]);
    try {
      const { idBulkUpload } = await sgcSend<{ idBulkUpload: number }>('/api/sgc/master-list/files', 'POST', { company: idCompany, action: 'iniciar', filesTotal: files.length });
      const out: Row[] = [];
      for (const f of files) {
        const form = new FormData();
        form.set('company', String(idCompany));
        form.set('file', f);
        if (sheetSettings[f.name]) form.set('settings', JSON.stringify(sheetSettings[f.name]));
        const res = await fetch(`/api/sgc/master-list/files/${idBulkUpload}`, { method: 'POST', body: form });
        const body = (await res.json().catch(() => ({}))) as Row & { error?: string };
        out.push(res.ok ? body : { fileName: f.name, code: null, status: 'error', warning: null, error: body.error || `Error ${res.status}` });
        setDone(out.length);
        setRows([...out]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló la carga');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setFiles([]);
    setRows(null);
    setError(null);
    setDone(0);
    setSheetSettings({});
    onLoaded();
    onClose();
  };

  const ok = rows?.filter((r) => r.status === 'cargable' || r.status === 'cargado').length ?? 0;
  const bad = rows?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <Modal opened={opened} onClose={close} title='Cargar archivos (PDF, Word o Excel) del listado maestro' size='lg'>
      <Stack gap='sm' data-testid='sgc-archivos-importar'>
        {error && (
          <Alert color='red' title='Error' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}

        {rows && (
          <>
            <Alert
              color={bad > 0 ? 'red' : 'green'}
              title={dryRun ? 'Vista previa (no se cargó nada)' : 'Resultado de la carga'}
              icon={bad > 0 ? <IconAlertTriangle size={18} /> : <IconCircleCheck size={18} />}
              data-testid='sgc-archivos-resumen'
            >
              <Text size='sm'>
                {dryRun ? 'Se cargarían' : 'Cargados'}: <b>{ok}</b> · Con error: <b>{bad}</b> · Avisos de nombre: <b>{rows.filter((r) => r.warning).length}</b> (de {rows.length})
              </Text>
            </Alert>
            <ScrollArea.Autosize mah={300}>
              <Table striped withTableBorder withColumnBorders stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Archivo</Table.Th>
                    <Table.Th>Documento</Table.Th>
                    <Table.Th>Resultado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={`${r.fileName}-${i}`} data-testid='sgc-archivos-fila'>
                      <Table.Td>{r.fileName}</Table.Td>
                      <Table.Td>{r.code ?? '-'}</Table.Td>
                      <Table.Td>
                        <Badge color={r.status === 'error' ? 'red' : r.warning ? 'orange' : 'green'} variant='light' size='sm'>
                          {r.status === 'error' ? 'Error' : r.warning ? 'Revisar nombre' : dryRun ? 'Se carga' : 'Cargado'}
                        </Badge>{' '}
                        <Text span size='xs'>
                          {r.error ?? r.warning ?? ''}
                        </Text>
                        {dryRun && r.status === 'cargable' && /\.xlsx$/i.test(r.fileName) && (
                          <Group gap={6} mt={4} wrap='wrap'>
                            <Button
                              size='compact-xs'
                              variant='light'
                              leftSection={<IconAdjustments size={14} />}
                              onClick={() => setAdjusting(files.find((f) => f.name === r.fileName) ?? null)}
                              data-testid='sgc-archivos-ajustar'
                            >
                              Ajustar y previsualizar
                            </Button>
                            {sheetSettings[r.fileName] && (
                              <Badge color='blue' variant='light' size='sm' title={describeSheetSettings(sheetSettings[r.fileName])} data-testid='sgc-archivos-ajustes-propios'>
                                Ajustes propios
                              </Badge>
                            )}
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </>
        )}

        {loading && !dryRun && files.length > 0 && <Progress value={(done / files.length) * 100} animated />}

        <Group>
          {/* S16 (R33): también los originales en Word y Excel ya aprobados (se convierten a PDF para el visor y se conservan con su huella). */}
          <FileButton onChange={pick} accept='application/pdf,.pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' multiple>
            {(props) => (
              <Button {...props} variant='default' leftSection={<IconUpload size={16} />} data-testid='sgc-archivos-subir'>
                Subir archivos
              </Button>
            )}
          </FileButton>
        </Group>

        {files.length > 0 && (
          <Text size='sm'>
            Archivos: <b>{files.length}</b> seleccionados (PDF, Word o Excel). El nombre de cada archivo debe empezar con el código del documento (por ejemplo «OLP-GCC-02 Almacenamiento.pdf» o «OLP-GCC-02-FO01 Registro.xlsx»). Un Word o un Excel se convierte a PDF para el visor y el original se guarda con su huella. Después de «Simular», cada Excel tiene «Ajustar y previsualizar» para ver el PDF antes de cargarlo.
          </Text>
        )}

        <Group justify='flex-end' mt='sm'>
          <Button variant='default' onClick={close} disabled={loading}>
            Cerrar
          </Button>
          <Button variant='light' leftSection={<IconEye size={16} />} onClick={() => void simulate()} loading={loading && dryRun} disabled={files.length === 0} data-testid='sgc-archivos-simular'>
            Simular
          </Button>
          <Button onClick={() => void load()} loading={loading && !dryRun} disabled={files.length === 0 || !rows || !dryRun || ok === 0} data-testid='sgc-archivos-cargar'>
            Cargar {rows && dryRun && ok > 0 ? `(${files.length})` : ''}
          </Button>
        </Group>
      </Stack>
      <SgcSheetSettingsModal
        opened={Boolean(adjusting)}
        name={adjusting?.name ?? ''}
        source={adjustingSource}
        onClose={() => setAdjusting(null)}
        onApply={(s) =>
          setSheetSettings((prev) => {
            if (!adjusting) return prev;
            const next = { ...prev };
            if (s) next[adjusting.name] = s;
            else delete next[adjusting.name];
            return next;
          })
        }
      />
    </Modal>
  );
}
