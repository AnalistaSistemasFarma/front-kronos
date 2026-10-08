'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconHighlight } from '@tabler/icons-react';
import {
  alignBlocks,
  compactWithMap,
  diffText,
  findAnchorLoose,
  type DraftBlock,
} from '../../../lib/orion/draftDiff';
import type { DraftMark } from '../../../lib/orion/draftBoardDb';
import { fetchPdfArrayBuffer } from '../pdfFetchCache';
import type { DraftSelection } from './DraftBoardDocument';
import DraftMarkBubble, { markStyle } from './DraftMarkBubble';

/**
 * Lienzo del tablero: la hoja real del Word (convertida a PDF por OneDrive, con sus márgenes,
 * tablas, logos y saltos de página) con una capa de texto invisible encima para seleccionar,
 * y los subrayados de marcas y cambios dibujados sobre la página.
 */

type Props = {
  pdfUrl: string;
  versionLabel: string;
  /** Párrafos de la subversión que se ve (anclan marcas y cambios). */
  blocks: DraftBlock[];
  /** Subversión anterior para resaltar cambios (null = sin cambios). */
  previousBlocks: DraftBlock[] | null;
  marks: DraftMark[];
  activeMarkId: number | null;
  /** Marca con la burbuja abierta. */
  openMarkId: number | null;
  onMarkClick: (id: number) => void;
  onMarkDetails: (id: number) => void;
  onBubbleClose: () => void;
  onSelect: ((sel: DraftSelection) => void) | null;
};

type BubbleHandlers = Pick<Props, 'openMarkId' | 'onMarkClick' | 'onMarkDetails' | 'onBubbleClose'>;

type SheetItem = { str: string; x: number; top: number; w: number; h: number };
type SheetPage = {
  number: number;
  width: number;
  height: number;
  imageUrl: string;
  items: SheetItem[];
  compact: string;
  /** Carácter compacto → (ítem, posición en el ítem). */
  at: Array<{ item: number; ch: number }>;
};
type Rect = { x: number; y: number; w: number; h: number };
type Hit = { page: number; rects: Rect[] };

const RENDER_SCALE = 1.75;
const MAX_WIDTH = 860;

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, px: number): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * px * 0.5;
  measureCtx.font = `${px}px sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Imagen de la página sin bloquear la pantalla (toBlob es asíncrono; toDataURL no). */
function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png')), 'image/png');
  });
}

/**
 * Hojas ya dibujadas en esta pestaña: cada subversión es una copia congelada, así que volver a
 * ella (o reabrir el tablero) es inmediato.
 */
const sheetCache = new Map<string, SheetPage[]>();
const SHEET_CACHE_MAX = 8;

async function loadSheet(url: string, onProgress: (pages: SheetPage[]) => void): Promise<SheetPage[]> {
  const cached = sheetCache.get(url);
  if (cached) return cached;
  const [pdfjs, buffer] = await Promise.all([import('pdfjs-dist'), fetchPdfArrayBuffer(url)]);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const data = new Uint8Array(buffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: SheetPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    // Dibujo y texto de la página en paralelo.
    const [, content] = await Promise.all([
      page.render({ canvasContext: ctx, viewport }).promise,
      page.getTextContent(),
    ]);
    const items: SheetItem[] = [];
    let compact = '';
    const at: SheetPage['at'] = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue;
      const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
      const h = Math.hypot(tx[2], tx[3]);
      if (!(h > 0)) continue;
      const index = items.length;
      items.push({ str: raw.str, x: tx[4], top: tx[5] - h, w: raw.width * viewport.scale, h });
      for (let c = 0; c < raw.str.length; c++) {
        if (/\s/.test(raw.str[c])) continue;
        compact += raw.str[c].toLowerCase();
        at.push({ item: index, ch: c });
      }
    }
    pages.push({
      number: n,
      width: viewport.width,
      height: viewport.height,
      imageUrl: await canvasToUrl(canvas),
      items,
      compact,
      at,
    });
    // La primera página aparece ya; las demás se van agregando.
    onProgress([...pages]);
  }
  sheetCache.set(url, pages);
  while (sheetCache.size > SHEET_CACHE_MAX) {
    const oldest = sheetCache.keys().next().value;
    if (oldest === undefined) break;
    sheetCache.get(oldest)?.forEach((p) => p.imageUrl.startsWith('blob:') && URL.revokeObjectURL(p.imageUrl));
    sheetCache.delete(oldest);
  }
  return pages;
}

function rectsFor(page: SheetPage, start: number, length: number): Rect[] {
  const first = page.at[start];
  const last = page.at[start + length - 1];
  if (!first || !last) return [];
  const rects: Rect[] = [];
  for (let i = first.item; i <= last.item; i++) {
    const it = page.items[i];
    const len = Math.max(1, it.str.length);
    const from = i === first.item ? first.ch : 0;
    const to = i === last.item ? last.ch + 1 : len;
    if (to <= from) continue;
    const x0 = it.x + (it.w * from) / len;
    const x1 = it.x + (it.w * to) / len;
    const prev = rects[rects.length - 1];
    // Mismo renglón y pegado: un solo rectángulo.
    if (prev && Math.abs(prev.y - it.top) < it.h * 0.4 && x0 - (prev.x + prev.w) < it.h) {
      prev.w = Math.max(prev.w, x1 - prev.x);
      prev.h = Math.max(prev.h, it.h);
    } else {
      rects.push({ x: x0, y: it.top, w: x1 - x0, h: it.h });
    }
  }
  return rects;
}

/** Ubica una frase en la hoja; si se da el párrafo, la busca dentro de él. */
function locate(pages: SheetPage[], phrase: string, blockText?: string | null): Hit | null {
  const needle = compactWithMap(phrase).compact;
  if (needle.length < 2) return null;
  const block = blockText ? compactWithMap(blockText).compact : '';
  if (block) {
    // Inicio del párrafo (sus primeros caracteres) para no confundirlo con otro igual.
    const head = block.slice(0, Math.min(block.length, 60));
    for (const page of pages) {
      const b = page.compact.indexOf(head);
      if (b < 0) continue;
      const p = page.compact.indexOf(needle, b);
      if (p >= 0 && p < b + block.length) return { page: page.number, rects: rectsFor(page, p, needle.length) };
      // El párrafo sigue en la página siguiente.
      const next = pages.find((x) => x.number === page.number + 1);
      const q = next ? next.compact.indexOf(needle) : -1;
      if (next && q >= 0 && q < block.length) return { page: next.number, rects: rectsFor(next, q, needle.length) };
    }
  }
  for (const page of pages) {
    const p = page.compact.indexOf(needle);
    if (p >= 0) return { page: page.number, rects: rectsFor(page, p, needle.length) };
  }
  return null;
}

type Overlay =
  | { kind: 'mark'; id: number; mark: DraftMark; fixed: boolean; type: DraftMark['type']; hit: Hit }
  | { kind: 'ins'; key: string; hit: Hit }
  | { kind: 'del'; key: string; text: string; hit: Hit };

const PILL_H = 26;
const PILL_W = 50;

type BubbleSpot = { id: number; left: number; top: number };

/**
 * Posición de cada burbuja en píxeles de pantalla (fuera de la escala de la hoja, para que se
 * vea siempre del mismo tamaño): al final del subrayado y sin encimarse con otra.
 */
function bubbleSpots(marks: Array<Extract<Overlay, { kind: 'mark' }>>, k: number, pageWidth: number): BubbleSpot[] {
  const raw = marks
    .map((o) => {
      const last = o.hit.rects[o.hit.rects.length - 1];
      if (!last) return null;
      return {
        id: o.id,
        left: Math.max(2, Math.min((last.x + last.w) * k + 4, pageWidth * k - PILL_W - 2)),
        top: (last.y + last.h / 2) * k - PILL_H / 2,
      };
    })
    .filter((s): s is BubbleSpot => s !== null)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const placed: BubbleSpot[] = [];
  for (const spot of raw) {
    let top = spot.top;
    for (const p of placed) {
      if (Math.abs(p.left - spot.left) < PILL_W + 4 && Math.abs(p.top - top) < PILL_H + 4) top = p.top + PILL_H + 4;
    }
    placed.push({ ...spot, top });
  }
  return placed;
}

function versionOrder(label: string): number {
  const m = /^v?0\.(\d+)$/i.exec(label);
  return m ? Number(m[1]) : 0;
}

function buildOverlays(
  pages: SheetPage[],
  blocks: DraftBlock[],
  previousBlocks: DraftBlock[] | null,
  marks: DraftMark[],
  versionLabel: string
): Overlay[] {
  const overlays: Overlay[] = [];
  const current = versionOrder(versionLabel);

  if (previousBlocks) {
    const rows = alignBlocks(previousBlocks, blocks);
    rows.forEach((row, r) => {
      if (row.type === 'ins') {
        const hit = locate(pages, blocks[row.newIndex].text, blocks[row.newIndex].text);
        if (hit) overlays.push({ kind: 'ins', key: `i${r}`, hit });
      } else if (row.type === 'del') {
        // Párrafo quitado: aviso al inicio del siguiente que sigue en la hoja.
        const next = rows.slice(r + 1).find((x) => x.type !== 'del') as { newIndex: number } | undefined;
        const anchor = next ? blocks[next.newIndex] : null;
        const hit = anchor ? locate(pages, anchor.text.slice(0, 40), anchor.text) : null;
        if (hit) {
          overlays.push({
            kind: 'del',
            key: `d${r}`,
            text: previousBlocks[row.oldIndex].text,
            hit: { page: hit.page, rects: hit.rects.slice(0, 1) },
          });
        }
      } else if (row.type === 'mod') {
        const blockText = blocks[row.newIndex].text;
        const ops = diffText(previousBlocks[row.oldIndex].text, blockText);
        let consumed = '';
        ops.forEach((op, k) => {
          if (op.t === 'eq') {
            consumed += op.v;
            return;
          }
          if (op.t === 'ins') {
            // Contexto: lo anterior del párrafo + lo agregado, para ubicar esta aparición.
            const hit = op.v.trim() ? locate(pages, op.v, blockText) : null;
            if (hit) overlays.push({ kind: 'ins', key: `m${r}-${k}`, hit });
            consumed += op.v;
            return;
          }
          if (!op.v.trim()) return;
          const after = ops.slice(k + 1).find((x) => x.t !== 'del' && x.v.trim());
          const probe = after ? after.v.trim().slice(0, 30) : consumed.trim().slice(-30);
          const hit = probe ? locate(pages, probe, blockText) : null;
          if (hit) {
            const first = hit.rects[0];
            const rect = after ? first : hit.rects[hit.rects.length - 1];
            if (rect) {
              overlays.push({
                kind: 'del',
                key: `x${r}-${k}`,
                text: op.v.trim(),
                hit: {
                  page: hit.page,
                  rects: [{ x: after ? rect.x - 3 : rect.x + rect.w, y: rect.y, w: 3, h: rect.h }],
                },
              });
            }
          }
        });
      }
    });
  }

  for (const mark of marks) {
    if (versionOrder(mark.createdVersion) > current) continue;
    const fixedHere = Boolean(mark.fixedIn && versionOrder(mark.fixedIn) <= current);
    const phrase = fixedHere && mark.fixedQuote ? mark.fixedQuote : mark.quote;
    const anchor = findAnchorLoose(blocks, phrase, mark.blockIndex);
    const hit = locate(pages, anchor?.quote ?? phrase, anchor ? blocks[anchor.index].text : null);
    if (hit) {
      overlays.push({
        kind: 'mark',
        id: mark.id,
        mark,
        fixed: fixedHere,
        type: mark.type,
        hit,
      });
    }
  }
  return overlays;
}

function PageView({
  page,
  overlays,
  activeMarkId,
  openMarkId,
  onMarkClick,
  onMarkDetails,
  onBubbleClose,
}: {
  page: SheetPage;
  overlays: Overlay[];
  activeMarkId: number | null;
} & BubbleHandlers) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setK(Math.min(el.clientWidth, MAX_WIDTH) / page.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width]);

  const mine = overlays.filter((o) => o.hit.page === page.number);
  const markOverlays = mine.filter((o): o is Extract<Overlay, { kind: 'mark' }> => o.kind === 'mark');
  const markById = new Map(markOverlays.map((o) => [o.id, o]));
  const spots = bubbleSpots(markOverlays, k, page.width);
  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <div
        data-page={page.number}
        style={{
          position: 'relative',
          width: page.width * k,
          height: page.height * k,
          margin: '0 auto',
          boxShadow: '0 1px 3px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.10)',
          background: '#fff',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: page.width,
            height: page.height,
            transform: `scale(${k})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Hoja real: siempre blanca, como en Word, también en modo oscuro. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador (data URL) */}
          <img src={page.imageUrl} alt={`Página ${page.number}`} width={page.width} height={page.height} draggable={false} style={{ display: 'block', userSelect: 'none' }} />

          {mine.map((o) =>
            o.hit.rects.map((r, i) => {
              if (o.kind === 'del') {
                return (
                  <Tooltip key={`${o.key}-${i}`} label={`Se quitó: “${o.text.length > 160 ? `${o.text.slice(0, 160)}…` : o.text}”`} multiline maw={320} withArrow>
                    <div
                      style={{
                        position: 'absolute',
                        left: r.x - 1,
                        top: r.y - 2,
                        width: Math.max(4, r.w),
                        height: r.h + 4,
                        background: 'rgba(220, 38, 38, .85)',
                        borderRadius: 2,
                        zIndex: 3,
                        cursor: 'help',
                      }}
                    />
                  </Tooltip>
                );
              }
              const isMark = o.kind === 'mark';
              const active = isMark && activeMarkId === o.id;
              return (
                <div
                  key={`${isMark ? o.id : o.key}-${i}`}
                  data-mark={isMark && i === 0 ? o.id : undefined}
                  style={{
                    position: 'absolute',
                    left: r.x - 1,
                    top: r.y,
                    width: r.w + 2,
                    height: r.h * 1.15,
                    pointerEvents: 'none',
                    mixBlendMode: 'multiply',
                    zIndex: 1,
                    background: isMark ? markStyle(o).fill : 'rgba(34, 197, 94, .28)',
                    borderBottom: isMark ? `2px solid ${markStyle(o).line}` : '2px solid rgba(22, 163, 74, .9)',
                    outline: active ? '2px solid rgba(37, 99, 235, .9)' : undefined,
                    outlineOffset: 2,
                  }}
                />
              );
            })
          )}

          {/* Capa de texto invisible: permite seleccionar sobre la hoja. */}
          <div className='draft-sheet-text' style={{ position: 'absolute', inset: 0, zIndex: 2, lineHeight: 1 }}>
            {page.items.map((it, i) => {
              const natural = measure(it.str, it.h);
              const sx = natural > 0 ? it.w / natural : 1;
              return (
                <span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: it.x,
                    top: it.top,
                    fontSize: it.h,
                    fontFamily: 'sans-serif',
                    whiteSpace: 'pre',
                    color: 'transparent',
                    transform: `scaleX(${sx})`,
                    transformOrigin: '0 0',
                    cursor: 'text',
                  }}
                >
                  {it.str}
                </span>
              );
            })}
          </div>
        </div>
        {spots.map((spot) => {
          const o = markById.get(spot.id);
          if (!o) return null;
          return (
            <DraftMarkBubble
              key={`bubble-${o.id}`}
              mark={o.mark}
              fixed={o.fixed}
              open={openMarkId === o.id}
              onPaper
              onOpen={() => onMarkClick(o.id)}
              onClose={onBubbleClose}
              onDetails={() => onMarkDetails(o.id)}
              style={{ position: 'absolute', left: spot.left, top: spot.top, zIndex: 6 }}
            />
          );
        })}
      </div>
      <Text size='xs' c='dimmed' ta='center' mt={6} mb='md'>
        Página {page.number}
      </Text>
    </div>
  );
}

export default function DraftBoardSheet({
  pdfUrl,
  versionLabel,
  blocks,
  previousBlocks,
  marks,
  activeMarkId,
  openMarkId,
  onMarkClick,
  onMarkDetails,
  onBubbleClose,
  onSelect,
}: Props) {
  const [pages, setPages] = useState<SheetPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<(DraftSelection & { top: number; left: number }) | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPages(sheetCache.get(pdfUrl) ?? null);
    setError(null);
    loadSheet(pdfUrl, (partial) => !cancelled && setPages(partial))
      .then((p) => !cancelled && setPages(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudo mostrar la hoja'));
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  const overlays = useMemo(
    () => (pages ? buildOverlays(pages, blocks, previousBlocks, marks, versionLabel) : []),
    [pages, blocks, previousBlocks, marks, versionLabel]
  );

  const handleMouseUp = () => {
    if (!onSelect) return;
    const sel = window.getSelection();
    const wrap = wrapRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !wrap) {
      setPending(null);
      return;
    }
    const text = sel.toString();
    const range = sel.getRangeAt(0);
    const inSheet = (node: Node | null) =>
      Boolean((node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest('.draft-sheet-text'));
    if (!inSheet(range.startContainer) || !inSheet(range.endContainer)) {
      setPending(null);
      return;
    }
    // Solo dentro de un párrafo: la marca se ancla a él.
    const anchor = findAnchorLoose(blocks, text);
    if (!anchor) {
      setPending(null);
      return;
    }
    const box = wrap.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    setPending({
      blockIndex: anchor.index,
      quote: anchor.quote,
      top: rect.bottom - box.top + 6,
      left: Math.max(8, Math.min(rect.left - box.left, box.width - 170)),
    });
  };

  if (error) {
    return (
      <Alert color='red' title='No se pudo mostrar la hoja'>
        {error}. Pruebe con la vista “Texto con cambios”.
      </Alert>
    );
  }
  if (!pages) {
    return (
      <Group justify='center' p='xl'>
        <Loader size='sm' />
        <Text size='sm' c='dimmed'>
          Preparando la hoja de la {versionLabel}… (la primera vez OneDrive la convierte)
        </Text>
      </Group>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseUp={handleMouseUp}>
      <style>{`.draft-sheet-text span::selection{background:rgba(37,99,235,.35);color:transparent}`}</style>
      {pages.map((page) => (
        <PageView
          key={page.number}
          page={page}
          overlays={overlays}
          activeMarkId={activeMarkId}
          openMarkId={openMarkId}
          onMarkClick={onMarkClick}
          onMarkDetails={onMarkDetails}
          onBubbleClose={onBubbleClose}
        />
      ))}
      {pending && onSelect ? (
        <Button
          size='xs'
          leftSection={<IconHighlight size={14} />}
          style={{ position: 'absolute', top: pending.top, left: pending.left, zIndex: 10 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSelect({ blockIndex: pending.blockIndex, quote: pending.quote });
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Marcar selección
        </Button>
      ) : null}
    </div>
  );
}
