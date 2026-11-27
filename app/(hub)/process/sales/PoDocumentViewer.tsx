'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconExternalLink, IconFileText, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * Preview of the client's PO (PDF or image) next to the lines of the offer, to compare them
 * (Nicolás Rivera, 2026-11-27). The PDF is drawn with pdf.js from the file already in memory: no upload,
 * same look in every browser (the native viewer does not show PDFs inside an iframe on phones).
 */

const MAX_PAGES = 60;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

interface Props {
  file: File;
  /** Blob URL of the same file (owned by the parent), for "open in another tab" and images. */
  url: string;
  /** True while a splitter is being dragged: the viewer must not swallow the pointer. */
  passive?: boolean;
}

export default function PoDocumentViewer({ file, url, passive }: Props) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [rendering, setRendering] = useState(false);

  // Load the PDF once per file.
  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError('');
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        loaded = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (cancelled) return void loaded.destroy();
        setDoc(loaded);
      } catch {
        if (!cancelled) setError('No se pudo mostrar el documento. Ábralo en otra pestaña.');
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [file, isPdf]);

  // Width of the panel (debounced: the splitter changes it continuously).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => setWidth(el.clientWidth), 150);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // Draw the pages fitted to the width of the panel, times the zoom.
  useEffect(() => {
    const box = pagesRef.current;
    if (!doc || !box || width < 50) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setRendering(true);
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvases: HTMLCanvasElement[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
        const p = await doc.getPage(i);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const scale = ((width - 16) / base.width) * zoom;
        const vp = p.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(base.width * scale)}px`;
        canvas.style.height = `${Math.floor(base.height * scale)}px`;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 8px';
        canvas.style.background = '#fff';
        canvas.style.boxShadow = '0 1px 3px rgba(0,0,0,.25)';
        canvas.dataset.page = String(i);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        task = p.render({ canvasContext: ctx, viewport: vp });
        try {
          await task.promise;
        } catch {
          return;
        }
        if (cancelled) return;
        canvases.push(canvas);
        // Show the first page as soon as it is ready, the rest as they come.
        if (i === 1) box.replaceChildren(canvas);
        else box.appendChild(canvas);
      }
      if (!cancelled) setRendering(false);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, width, zoom]);

  const onScroll = () => {
    const el = scrollRef.current;
    const box = pagesRef.current;
    if (!el || !box) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let current = 1;
    for (const c of Array.from(box.children) as HTMLElement[]) {
      if (c.offsetTop <= mid) current = Number(c.dataset.page) || current;
    }
    setPage(current);
  };

  const zi = ZOOMS.indexOf(zoom);
  const pages = doc ? Math.min(doc.numPages, MAX_PAGES) : 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Group justify="space-between" wrap="nowrap" gap={6}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <IconFileText size={16} style={{ flexShrink: 0 }} />
          <Text size="sm" fw={600} truncate title={file.name}>{file.name}</Text>
        </Group>
        <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
          {pages > 0 && <Text size="xs" c="dimmed" mr={4} style={{ whiteSpace: 'nowrap' }}>Pág. {page} de {doc!.numPages}</Text>}
          <Tooltip label="Alejar" withinPortal zIndex={1400}>
            <ActionIcon variant="subtle" size="sm" aria-label="Alejar" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1])}><IconZoomOut size={16} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Ajustar al ancho" withinPortal zIndex={1400}>
            <Button variant="subtle" size="compact-xs" aria-label="Ajustar al ancho" onClick={() => setZoom(1)} leftSection={<IconZoomReset size={14} />}>{Math.round(zoom * 100)} %</Button>
          </Tooltip>
          <Tooltip label="Acercar" withinPortal zIndex={1400}>
            <ActionIcon variant="subtle" size="sm" aria-label="Acercar" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1])}><IconZoomIn size={16} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Abrir en otra pestaña" withinPortal zIndex={1400}>
            <ActionIcon variant="subtle" size="sm" component="a" href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir en otra pestaña"><IconExternalLink size={16} /></ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="po-document"
        style={{
          flex: 1, minHeight: 0, overflow: 'auto', padding: 8, borderRadius: 4,
          border: '1px solid var(--mantine-color-default-border)', background: 'var(--mantine-color-default-hover)',
          pointerEvents: passive ? 'none' : undefined,
        }}
      >
        {isPdf ? (
          <>
            {error && <Text size="sm" c="red">{error}</Text>}
            <div ref={pagesRef} />
            {!error && (!doc || rendering) && <Group justify="center" my="xs"><Loader size="sm" /></Group>}
            {doc && doc.numPages > MAX_PAGES && <Text size="xs" c="dimmed" ta="center">Se muestran las primeras {MAX_PAGES} páginas: ábralo en otra pestaña para ver el resto.</Text>}
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} style={{ display: 'block', width: `${zoom * 100}%`, maxWidth: 'none', margin: '0 auto', background: '#fff' }} />
        )}
      </div>
    </div>
  );
}
