'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconDownload, IconLock, IconPrinter, IconZoomIn, IconZoomOut } from '@tabler/icons-react';

/**
 * VISOR SEGURO del SGC: muestra el PDF controlado SIN barra del navegador,
 * sin descarga ni impresión, salvo permiso excepcional vigente.
 *
 * - El PDF llega del servidor ya estampado con la marca "copia controlada"
 *   (quién y cuándo) y tras verificar su SHA-256; cada apertura queda en la
 *   auditoría del SGC.
 * - Se dibuja página por página en <canvas> con pdf.js (no se usa el visor
 *   nativo del navegador, que trae botones de descargar e imprimir).
 * - Se bloquean el menú contextual, arrastrar, Ctrl/Cmd+S y Ctrl/Cmd+P, y la
 *   hoja de impresión sale en blanco (@media print).
 * Limitación honesta: nada impide una captura de pantalla; la marca de agua y
 * el registro de consultas son la mitigación.
 */
export interface SgcSecureViewerProps {
  fileUrl: string;
  canDownload: boolean;
  canPrint: boolean;
  /**
   * Sprint 4 (lectura obligatoria): se llama UNA vez cuando la persona llega
   * al final del documento (se desplazó hasta la última página, o el
   * documento completo cabe en pantalla). Con esto se habilita «Leído».
   */
  onReachedEnd?: (pages: number) => void;
}

/** Escala inicial del visor (página al 100 % del ancho disponible). */
const BASE_SCALE = 1.3;

async function renderPdf(bytes: Uint8Array, scale: number, container: HTMLElement, isCancelled: () => boolean) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  if (isCancelled()) return 0;
  container.replaceChildren();
  for (let n = 1; n <= pdf.numPages; n++) {
    if (isCancelled()) return 0;
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    // «Acercar» debe agrandar la página también cuando el visor es angosto
    // (celular): por encima de la escala base el ancho crece en proporción y el
    // visor se desplaza a lo ancho. En escritorio el tope sigue siendo el
    // tamaño natural de la página, como antes.
    canvas.style.width = scale > BASE_SCALE ? `${Math.round((scale / BASE_SCALE) * 100)}%` : '100%';
    canvas.style.maxWidth = `${viewport.width}px`;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto 16px';
    canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.18)';
    canvas.setAttribute('data-testid', 'sgc-visor-pagina');
    canvas.setAttribute('draggable', 'false');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Un dibujo más nuevo (p. ej. dos toques seguidos en «Acercar») reemplaza a este: no mezclar páginas.
    if (isCancelled()) return 0;
    container.appendChild(canvas);
  }
  return pdf.numPages;
}

/** Imprime (solo con permiso) a partir del PDF de "impresión autorizada". */
async function printAuthorized(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'No se pudo preparar la impresión');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write('<!doctype html><html><head><style>@page{margin:0}body{margin:0}img{width:100%;page-break-after:always;display:block}</style></head><body></body></html>');
  doc.close();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    const img = doc.createElement('img');
    img.src = canvas.toDataURL('image/png');
    doc.body.appendChild(img);
  }
  await new Promise((r) => setTimeout(r, 300));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 60_000);
}

export default function SgcSecureViewer({ fileUrl, canDownload, canPrint, onReachedEnd }: SgcSecureViewerProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const renderGenRef = useRef(0);
  const endRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [scale, setScale] = useState(BASE_SCALE);
  const [state, setState] = useState<{ tipo: 'cargando' } | { tipo: 'listo'; pages: number } | { tipo: 'error'; mensaje: string }>({
    tipo: 'cargando',
  });
  const [printError, setPrintError] = useState<string | null>(null);

  // Descarga del PDF (una sola vez por URL: cada apertura queda en la auditoría).
  useEffect(() => {
    let cancelled = false;
    bytesRef.current = null;
    setState({ tipo: 'cargando' });
    fetch(fileUrl, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      })
      .then(async (bytes) => {
        if (cancelled || !pagesRef.current) return;
        bytesRef.current = bytes;
        const pages = await renderPdf(bytes.slice(), scale, pagesRef.current, () => cancelled);
        if (!cancelled) setState({ tipo: 'listo', pages });
      })
      .catch((err: unknown) => !cancelled && setState({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
    // El zoom se maneja aparte para no volver a pedir (ni auditar) el archivo.
  }, [fileUrl]);

  const rerender = useCallback(async (nextScale: number) => {
    setScale(nextScale);
    const gen = ++renderGenRef.current;
    if (bytesRef.current && pagesRef.current) await renderPdf(bytesRef.current.slice(), nextScale, pagesRef.current, () => gen !== renderGenRef.current);
  }, []);

  // Bloqueo de atajos de guardar e imprimir mientras el visor está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 's' || key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const block = (e: React.SyntheticEvent) => e.preventDefault();

  // Lectura obligatoria: avance de lectura y detección del final del documento.
  const checkEnd = useCallback(() => {
    const el = pagesRef.current;
    if (!el || !onReachedEnd || state.tipo !== 'listo') return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max <= 4 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
    setProgress((p) => Math.max(p, pct));
    if (!endRef.current && (max <= 4 || el.scrollTop >= max - 8)) {
      endRef.current = true;
      onReachedEnd(state.pages);
    }
  }, [onReachedEnd, state]);

  useEffect(() => {
    endRef.current = false;
    setProgress(0);
  }, [fileUrl]);

  useEffect(() => {
    checkEnd();
  }, [checkEnd]);

  return (
    <Stack gap='sm' className='sgc-visor' data-testid='sgc-visor'>
      <style>{'@media print { .sgc-visor, .sgc-visor * { visibility: hidden !important; } }'}</style>
      <Group justify='space-between' wrap='wrap'>
        <Group gap={6}>
          <IconLock size={16} />
          <Text size='sm' c='dimmed'>
            Copia controlada · solo consulta{canDownload || canPrint ? ' (con permiso excepcional vigente)' : ''}
          </Text>
        </Group>
        <Group gap='xs'>
          <Button size='xs' variant='default' leftSection={<IconZoomOut size={14} />} onClick={() => rerender(Math.max(0.6, scale - 0.2))} disabled={state.tipo !== 'listo'}>
            Alejar
          </Button>
          <Button size='xs' variant='default' leftSection={<IconZoomIn size={14} />} onClick={() => rerender(Math.min(2.6, scale + 0.2))} disabled={state.tipo !== 'listo'}>
            Acercar
          </Button>
          {canPrint && (
            <Button
              size='xs'
              variant='light'
              leftSection={<IconPrinter size={14} />}
              data-testid='sgc-visor-imprimir'
              onClick={() => {
                setPrintError(null);
                printAuthorized(`${fileUrl}?modo=impresion`).catch((e: unknown) => setPrintError(e instanceof Error ? e.message : String(e)));
              }}
            >
              Imprimir
            </Button>
          )}
          {canDownload && (
            <Button size='xs' variant='light' leftSection={<IconDownload size={14} />} component='a' href={`${fileUrl}?modo=descarga`} data-testid='sgc-visor-descargar'>
              Descargar
            </Button>
          )}
        </Group>
      </Group>
      {printError && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {printError}
        </Alert>
      )}
      {state.tipo === 'error' && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo abrir el documento'>
          {state.mensaje}
        </Alert>
      )}
      {state.tipo === 'cargando' && (
        <Group justify='center' my='xl'>
          <Loader />
          <Text size='sm' c='dimmed'>
            Preparando la copia controlada…
          </Text>
        </Group>
      )}
      {onReachedEnd && state.tipo === 'listo' && (
        <Text size='sm' c={progress >= 100 ? 'teal' : 'dimmed'} data-testid='sgc-lectura-avance'>
          {progress >= 100 ? 'Llegó al final del documento.' : `Lectura obligatoria: desplácese hasta el final del documento (${progress} %).`}
        </Text>
      )}
      <div
        ref={pagesRef}
        onScroll={onReachedEnd ? checkEnd : undefined}
        onContextMenu={block}
        onDragStart={block}
        onCopy={block}
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: 'var(--mantine-color-default-hover)',
          padding: 16,
          borderRadius: 8,
          maxHeight: '80vh',
          overflow: 'auto',
          display: state.tipo === 'error' ? 'none' : undefined,
        }}
        data-testid='sgc-visor-paginas'
      />
    </Stack>
  );
}
