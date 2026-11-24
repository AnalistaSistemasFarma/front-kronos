'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, ScrollArea, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconDownload, IconFileSpreadsheet } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { codigoOt, fmtFechaHora, turnoLabel, useOtFetch } from './otClient';

interface Encabezado {
  producto: string;
  concentracion: string;
  lote: string;
  op: string;
  loteMp: string;
}

interface BitacoraLote {
  id: number;
  consecutivo: number;
  turno: string;
  estado: string;
  abiertaEn: string;
  cerradaEn: string | null;
  area: string | null;
}

const CAMPOS: Array<{ key: keyof Encabezado; label: string; ayuda?: string }> = [
  { key: 'producto', label: 'Producto' },
  { key: 'concentracion', label: 'Concentración', ayuda: 'Sugerida desde la descripción del producto. Confírmela.' },
  { key: 'lote', label: 'Lote' },
  { key: 'op', label: 'O.P. Farmalógica' },
  { key: 'loteMp', label: 'Lote materia prima', ayuda: 'Sugerido desde las observaciones de la OP en SAP. Confírmelo.' },
];

/**
 * «Excel del batch record» (reunión de mejoras con Farmalógica, 2026-11-24): vista previa del
 * encabezado del lote (editable: concentración y lote de materia prima son sugerencias) y de las
 * bitácoras del lote que se juntan en el archivo. Descarga el .xlsx sobre la plantilla
 * GMF-03-FR-003-16, listo para imprimir.
 */
export default function OtBatchRecordExcel({ company, idOrden }: { company: OtCompanyAccess; idOrden: number }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [opened, setOpened] = useState(false);
  const base = `/api/bitacora-proceso/${idOrden}/batch-record?company=${company.idCompany}`;
  const prev = useOtFetch<{ encabezado: Encabezado; sapConsultado: boolean; bitacoras: BitacoraLote[] }>(opened ? base : null);
  const [enc, setEnc] = useState<Encabezado | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prev.data) return;
    setEnc(prev.data.encabezado);
    setIds(prev.data.bitacoras.map((b) => String(b.id)));
  }, [prev.data]);

  const descargar = async () => {
    if (!enc) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...enc, ids: ids.map(Number) }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'BatchRecord.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Descargado: ${nombre}`);
      setOpened(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const bitacoras = prev.data?.bitacoras ?? [];
  return (
    <>
      <Button variant='light' size={mobile ? 'md' : 'lg'} h={mobile ? 52 : undefined} leftSection={<IconFileSpreadsheet size={18} />} onClick={() => setOpened(true)} data-testid='ot-batch-excel'>
        Excel batch record
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title='Excel del batch record' size='xl' fullScreen={mobile} centered>
        {prev.loading && !enc ? (
          <Group justify='center' my='xl'>
            <Loader />
          </Group>
        ) : prev.error ? (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>{prev.error}</Alert>
        ) : enc ? (
          <Stack gap='md'>
            {!prev.data?.sapConsultado && (
              <Alert color='yellow' icon={<IconAlertTriangle size={18} />} data-testid='ot-batch-sin-sap'>
                No se pudo consultar la OP en SAP (o la bitácora no tiene OP). Escriba la concentración y el lote de materia prima.
              </Alert>
            )}
            <Text size='sm' c='dimmed'>
              Vista previa del encabezado del lote. Sale arriba de cada página impresa, como en el formato GMF-03-FR-003-16. Revise y corrija antes de descargar.
            </Text>
            <Paper withBorder radius='md' p='md' data-testid='ot-batch-encabezado'>
              <Group justify='space-between' mb='sm'>
                <Text fw={700}>BATCH RECORD · Información general</Text>
                <Text size='sm' c='dimmed'>GMF-03-FR-003-16</Text>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
                {CAMPOS.map((c) => (
                  <TextInput
                    key={c.key}
                    size='md'
                    label={c.label}
                    description={c.ayuda}
                    value={enc[c.key]}
                    maxLength={120}
                    required={c.key === 'producto' || c.key === 'lote'}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setEnc((x) => (x ? { ...x, [c.key]: v } : x));
                    }}
                    data-testid={`ot-batch-${c.key}`}
                  />
                ))}
              </SimpleGrid>
            </Paper>
            <div>
              <Text fw={600} mb={4}>
                Bitácoras del lote {enc.lote} <Badge variant='light' ml={4}>{ids.length} de {bitacoras.length}</Badge>
              </Text>
              <Text size='xs' c='dimmed' mb={6}>Van en orden de apertura, una sección por turno.</Text>
              <ScrollArea.Autosize mah={mobile ? 320 : 240} type='auto' offsetScrollbars>
                <Checkbox.Group value={ids} onChange={setIds}>
                  <Stack gap={6} data-testid='ot-batch-bitacoras'>
                    {bitacoras.map((b) => (
                      <Checkbox
                        key={b.id}
                        value={String(b.id)}
                        disabled={b.id === idOrden}
                        label={`${codigoOt(b.consecutivo)} · ${turnoLabel(b.turno)} · ${fmtFechaHora(b.abiertaEn)}${b.estado === 'ABIERTA' ? ' · abierta (parcial)' : ''}`}
                      />
                    ))}
                  </Stack>
                </Checkbox.Group>
              </ScrollArea.Autosize>
            </div>
            {error && (
              <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='ot-batch-error'>
                {error}
              </Alert>
            )}
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setOpened(false)}>Cancelar</Button>
              <Button leftSection={<IconDownload size={18} />} loading={busy} disabled={!enc.producto.trim() || !enc.lote.trim()} onClick={descargar} data-testid='ot-batch-descargar'>
                Descargar Excel
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </>
  );
}
