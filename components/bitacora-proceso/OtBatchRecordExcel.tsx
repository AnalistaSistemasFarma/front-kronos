'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, ScrollArea, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconArrowLeft, IconDownload, IconEye, IconFileSpreadsheet } from '@tabler/icons-react';
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

/** De dónde salió la OP sugerida (2026-11-25: había bitácoras sin OP y el Excel salía sin ella). */
const AYUDA_OP: Record<'bitacora' | 'lote' | 'sap' | 'ninguna', string> = {
  bitacora: 'Tomada de la bitácora.',
  lote: 'Esta bitácora no tiene OP: se tomó de otra bitácora del mismo lote. Confírmela.',
  sap: 'Ninguna bitácora del lote tiene OP: se encontró en SAP por el lote. Confírmela.',
  ninguna: 'Número de la orden de producción de SAP.',
};

const CAMPOS: Array<{ key: keyof Encabezado; label: string; ayuda?: string }> = [
  { key: 'producto', label: 'Producto' },
  { key: 'concentracion', label: 'Concentración', ayuda: 'Sugerida desde la descripción del producto. Confírmela.' },
  { key: 'lote', label: 'Lote' },
  { key: 'op', label: 'O.P. Farmalógica' },
  { key: 'loteMp', label: 'Lote materia prima', ayuda: 'Sugerido desde las observaciones de la OP en SAP. Confírmelo.' },
];

/** Dibuja el PDF de la vista previa página por página (pdf.js, como el visor del SGC: sirve igual en la tablet). */
function VistaPdf({ pdf }: { pdf: Uint8Array }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [paginas, setPaginas] = useState(0);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const cont = ref.current;
      if (!cont) return;
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
      if (cancelado) return;
      cont.replaceChildren();
      setPaginas(doc.numPages);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelado) return;
        const natural = page.getViewport({ scale: 1 }).width;
        const cssWidth = Math.max(240, Math.min(cont.clientWidth - 16, natural * 1.4));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: (cssWidth / natural) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.round(cssWidth)}px`;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 12px';
        canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.18)';
        canvas.setAttribute('data-testid', 'ot-batch-pagina');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelado) return;
        cont.appendChild(canvas);
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelado = true;
    };
  }, [pdf]);
  return (
    <Stack gap={4}>
      {error && <Alert color='red' icon={<IconAlertTriangle size={18} />}>No se pudo mostrar la vista previa: {error}</Alert>}
      {paginas > 0 && <Text size='xs' c='dimmed'>{paginas} {paginas === 1 ? 'página' : 'páginas'} · vista previa generada por Microsoft Excel, igual a como se imprime.</Text>}
      <ScrollArea.Autosize mah='65vh' type='auto' offsetScrollbars>
        <div ref={ref} data-testid='ot-batch-vista' style={{ background: 'var(--mantine-color-gray-1)', padding: 8, minHeight: 200 }} />
      </ScrollArea.Autosize>
    </Stack>
  );
}

/**
 * «Excel del batch record» (reunión de mejoras con Farmalógica, 2026-11-24): vista previa del
 * encabezado del lote (editable: concentración y lote de materia prima son sugerencias) y de las
 * bitácoras del lote que se juntan en el archivo. Descarga el .xlsx sobre la plantilla
 * GMF-03-FR-003-16, listo para imprimir.
 * Nicolás (2026-11-24): PRIMERO la vista previa y DESPUÉS se genera. La vista previa es el MISMO
 * .xlsx convertido a PDF por Microsoft (como el SGC); «Generar Excel» solo se habilita cuando la
 * vista previa corresponde a los datos y las bitácoras que están elegidos.
 */
export default function OtBatchRecordExcel({ company, idOrden }: { company: OtCompanyAccess; idOrden: number }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [opened, setOpened] = useState(false);
  const base = `/api/bitacora-proceso/${idOrden}/batch-record?company=${company.idCompany}`;
  const prev = useOtFetch<{ encabezado: Encabezado; opOrigen?: 'bitacora' | 'lote' | 'sap' | null; sapConsultado: boolean; bitacoras: BitacoraLote[] }>(opened ? base : null);
  const [enc, setEnc] = useState<Encabezado | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'vista' | 'excel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<{ pdf: Uint8Array; clave: string } | null>(null);
  const clave = useMemo(() => JSON.stringify({ enc, ids: [...ids].sort() }), [enc, ids]);
  const vistaVigente = vista !== null && vista.clave === clave;

  useEffect(() => {
    if (!prev.data) return;
    setEnc(prev.data.encabezado);
    setIds(prev.data.bitacoras.map((b) => String(b.id)));
    setVista(null);
  }, [prev.data]);

  const verVistaPrevia = async () => {
    if (!enc) return;
    setBusy('vista');
    setError(null);
    try {
      const res = await fetch(`/api/bitacora-proceso/${idOrden}/batch-record/vista-previa?company=${company.idCompany}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...enc, ids: ids.map(Number) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setVista({ pdf: new Uint8Array(await res.arrayBuffer()), clave });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const descargar = async () => {
    if (!enc || !vistaVigente) return;
    setBusy('excel');
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
      setBusy(null);
    }
  };

  const bitacoras = prev.data?.bitacoras ?? [];
  return (
    <>
      <Button variant='light' size={mobile ? 'md' : 'lg'} h={mobile ? 52 : undefined} leftSection={<IconFileSpreadsheet size={18} />} onClick={() => { setVista(null); setOpened(true); }} data-testid='ot-batch-excel'>
        Excel batch record
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title='Excel del batch record' size='xl' fullScreen={mobile} centered>
        {prev.loading && !enc ? (
          <Group justify='center' my='xl'>
            <Loader />
          </Group>
        ) : prev.error ? (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>{prev.error}</Alert>
        ) : enc && vistaVigente ? (
          <Stack gap='md'>
            <Text size='sm'>
              Revise la vista previa. Si está bien, genere el Excel; si no, vuelva y corrija los datos.
            </Text>
            <VistaPdf pdf={vista.pdf} />
            {error && (
              <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='ot-batch-error'>
                {error}
              </Alert>
            )}
            <Group justify='space-between'>
              <Button variant='default' leftSection={<IconArrowLeft size={18} />} onClick={() => setVista(null)} data-testid='ot-batch-volver'>
                Corregir datos
              </Button>
              <Button leftSection={<IconDownload size={18} />} loading={busy === 'excel'} onClick={descargar} data-testid='ot-batch-descargar'>
                Generar Excel
              </Button>
            </Group>
          </Stack>
        ) : enc ? (
          <Stack gap='md'>
            {!prev.data?.sapConsultado && (
              <Alert color='yellow' icon={<IconAlertTriangle size={18} />} data-testid='ot-batch-sin-sap'>
                No se pudo consultar la OP en SAP (o la bitácora no tiene OP). Escriba la concentración y el lote de materia prima.
              </Alert>
            )}
            <Text size='sm' c='dimmed'>
              Encabezado del lote: sale arriba de cada página impresa, como en el formato GMF-03-FR-003-16. Revise los datos y pida la vista previa; después genera el Excel.
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
                    description={c.key === 'op' ? AYUDA_OP[prev.data?.opOrigen ?? 'ninguna'] : c.ayuda}
                    error={c.key === 'op' && !enc.op.trim() ? 'Escriba la OP: no está en la bitácora, ni en otras del lote, ni se encontró en SAP por el lote.' : undefined}
                    value={enc[c.key]}
                    maxLength={120}
                    required={c.key === 'producto' || c.key === 'lote' || c.key === 'op'}
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
              <Button
                leftSection={<IconEye size={18} />}
                loading={busy === 'vista'}
                disabled={!enc.producto.trim() || !enc.lote.trim() || !enc.op.trim() || ids.length === 0}
                onClick={verVistaPrevia}
                data-testid='ot-batch-ver-vista'
              >
                Ver vista previa
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </>
  );
}
