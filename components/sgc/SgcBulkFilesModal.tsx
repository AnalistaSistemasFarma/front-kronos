'use client';

import React, { useState } from 'react';
import { Modal, Button, Group, Stack, Alert, Text, FileButton, Table, ScrollArea, Progress, Badge } from '@mantine/core';
import { IconUpload, IconCircleCheck, IconAlertTriangle, IconEye } from '@tabler/icons-react';
import { sgcSend } from './useSgcFetch';

/**
 * «Cargar archivos (PDF)» del listado maestro — Sprint 9. Misma pantalla del
 * cargue masivo de SynerLink (Registros sanitarios) que ya usa «Cargar
 * listado maestro (Excel)»: subir, «Simular» (con qué documento se empareja
 * cada archivo y si su nombre coincide con el del listado) y «Cargar». Los
 * archivos se suben de a uno, con su avance, y cada resultado queda en la
 * tabla y en el historial de la carga.
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

  const pick = (list: File[] | null) => {
    setError(null);
    setRows(null);
    setDone(0);
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
    onLoaded();
    onClose();
  };

  const ok = rows?.filter((r) => r.status === 'cargable' || r.status === 'cargado').length ?? 0;
  const bad = rows?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <Modal opened={opened} onClose={close} title='Cargar archivos (PDF) del listado maestro' size='lg'>
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
          <FileButton onChange={pick} accept='application/pdf' multiple>
            {(props) => (
              <Button {...props} variant='default' leftSection={<IconUpload size={16} />} data-testid='sgc-archivos-subir'>
                Subir archivos
              </Button>
            )}
          </FileButton>
        </Group>

        {files.length > 0 && (
          <Text size='sm'>
            Archivos: <b>{files.length}</b> PDF seleccionados. El nombre de cada archivo debe empezar con el código del documento (por ejemplo «OLP-GCC-02 Almacenamiento.pdf»).
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
    </Modal>
  );
}
