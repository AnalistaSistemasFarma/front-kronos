'use client';

import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Divider,
  FileButton,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconBold,
  IconEye,
  IconStack2,
  IconTextSize,
  IconTrash,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import toast from 'react-hot-toast';
import {
  ANNOTATION_FONT_SIZE_MAX,
  ANNOTATION_FONT_SIZE_MIN,
  ANNOTATION_MAX_TEXT,
  SEAL_MAX_BYTES,
  documentFullySigned,
  latestAnnotatedCopy,
} from '../../lib/orion/annotations';
import { createFieldId, pctFromClientPoint } from '../../lib/orion/signatureFields';
import type { OrionAnnotationFont, OrionDocumentAnnotation, OrionSignatureState } from '../../lib/orion/types';
import { usePdfPageImages } from './usePdfPageImages';
import { openAnnotatedPdfPreview } from './annotatedPdfPreview';
import { removeSealBackground } from './sealBackground';

type Draft = Pick<
  OrionDocumentAnnotation,
  | 'id'
  | 'kind'
  | 'page'
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'text'
  | 'label'
  | 'fontFamily'
  | 'fontSize'
  | 'bold'
  | 'sealItemId'
  | 'sealFileName'
>;

type TextStyle = { fontFamily: OrionAnnotationFont; fontSize: number; bold: boolean };

type PlacingMode = { kind: 'text' } | { kind: 'seal'; sealItemId: string; sealFileName: string } | null;

type DragState = {
  mode: 'move' | 'resize';
  id: string;
  page: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

/** Escala a la que se dibujan las hojas (más que la vista base, para que se lea al hacer zoom). */
const PDF_SCALE = 2;
/** Ancho de la hoja al 100%; el zoom lo multiplica (igual que al ubicar firmas). */
const PAGE_BASE_WIDTH = 900;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const DEFAULT_STYLE: TextStyle = { fontFamily: 'helvetica', fontSize: 11, bold: false };
const FONT_OPTIONS: Array<{ value: OrionAnnotationFont; label: string }> = [
  { value: 'helvetica', label: 'Helvetica (Arial)' },
  { value: 'times', label: 'Times New Roman' },
  { value: 'courier', label: 'Courier' },
];
/** Cómo se ve cada letra estándar del PDF en el navegador. */
const CSS_FONT: Record<OrionAnnotationFont, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};
const SIZE_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48]
  .filter((n) => n >= ANNOTATION_FONT_SIZE_MIN && n <= ANNOTATION_FONT_SIZE_MAX)
  .map((n) => ({ value: String(n), label: String(n) }));

const SEAL_DEFAULT = { width: 16, height: 11 };
const MIN_SIZE = 1.5;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampZoom(z: number) {
  return Math.round(clamp(z, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
}

function toDraft(a: OrionDocumentAnnotation): Draft {
  return {
    id: a.id,
    kind: a.kind,
    page: a.page,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    text: a.text ?? '',
    label: a.label ?? '',
    fontFamily: a.fontFamily ?? null,
    fontSize: a.fontSize ?? null,
    bold: a.bold ?? null,
    sealItemId: a.sealItemId ?? null,
    sealFileName: a.sealFileName ?? null,
  };
}

function styleOf(it: Draft): TextStyle {
  return {
    fontFamily: it.fontFamily ?? DEFAULT_STYLE.fontFamily,
    fontSize: it.fontSize ?? DEFAULT_STYLE.fontSize,
    bold: Boolean(it.bold),
  };
}

export type OrionAnnotationsModalProps = {
  opened: boolean;
  onClose: () => void;
  requestId: number;
  fileId: string;
  fileName: string;
  state: OrionSignatureState;
  onDocumentsUpdate?: (documents: Record<string, OrionSignatureState>) => void;
  /** Nombre para la leyenda de lo que aún no se ha guardado (vista previa). */
  currentUserName?: string | null;
};

/**
 * Texto y sellos DESPUÉS de firmar (p. ej. consecutivo, tipo de cambio y fecha del giro).
 * Como en un editor de PDF: "Texto", clic donde va, escribir. Se elige letra y tamaño.
 * No tocan las firmas: quedan como una capa aparte, con quién y cuándo, y nota en el historial.
 */
export default function OrionAnnotationsModal({
  opened,
  onClose,
  requestId,
  fileId,
  fileName,
  state,
  onDocumentsUpdate,
  currentUserName = null,
}: OrionAnnotationsModalProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  // El firmado limpio: sin los datos ya estampados (aquí se dibujan como cajas editables)
  // y sin la marca de agua de SynerLink encima.
  const pdfSrc = opened
    ? `/api/integrations/orion/signed-file?${new URLSearchParams({
        requestId: String(requestId),
        fileId,
        annotations: '0',
        watermark: '0',
      })}`
    : null;
  const { pages, loading, error } = usePdfPageImages(pdfSrc, PDF_SCALE);

  const [items, setItems] = useState<Draft[]>([]);
  const [placing, setPlacing] = useState<PlacingMode>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_STYLE);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Texto en el que se está escribiendo (directo sobre el PDF). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const boxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const lastDragMovedRef = useRef(false);
  const initialJsonRef = useRef('[]');
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Centro visible (fracción del contenido) que se conserva al cambiar el zoom.
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!opened) return;
    const initial = (state.annotations ?? []).map(toDraft);
    initialJsonRef.current = JSON.stringify(initial);
    setItems(initial);
    setPlacing(null);
    setSelectedId(null);
    setEditingId(null);
    setZoom(1);
    // Solo al abrir: mientras edita no se pisan sus cambios.
  }, [opened]);

  const changeZoom = useCallback((next: (current: number) => number) => {
    setZoom((current) => {
      const target = clampZoom(next(current));
      if (target === current) return current;
      const vp = viewportRef.current;
      if (vp && vp.scrollWidth > 0 && vp.scrollHeight > 0) {
        pendingScrollRef.current = {
          x: (vp.scrollLeft + vp.clientWidth / 2) / vp.scrollWidth,
          y: (vp.scrollTop + vp.clientHeight / 2) / vp.scrollHeight,
        };
      }
      return target;
    });
  }, []);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const anchor = pendingScrollRef.current;
    if (!vp || !anchor) return;
    pendingScrollRef.current = null;
    vp.scrollLeft = anchor.x * vp.scrollWidth - vp.clientWidth / 2;
    vp.scrollTop = anchor.y * vp.scrollHeight - vp.clientHeight / 2;
  }, [zoom]);

  // Ctrl + rueda (o pellizco en el touchpad): zoom de la hoja, no de toda la página.
  const hasPages = pages.length > 0;
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      changeZoom((z) => z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [changeZoom, hasPages, loading, opened]);

  const dirty = JSON.stringify(items) !== initialJsonRef.current;
  const selected = selectedId ? items.find((it) => it.id === selectedId) ?? null : null;
  const selectedText = selected?.kind === 'text' ? selected : null;
  const shownStyle = selectedText ? styleOf(selectedText) : textStyle;

  const requestClose = () => {
    if (dirty && !window.confirm('Tiene cambios sin guardar. ¿Cerrar y descartarlos?')) return;
    onClose();
  };

  const sealSrc = (itemId: string) =>
    `/api/integrations/orion/annotations/seal?${new URLSearchParams({ requestId: String(requestId), fileId, itemId })}`;

  const clientToPct = (page: number, clientX: number, clientY: number) => {
    const el = pageRefs.current[page];
    return el ? pctFromClientPoint(el.getBoundingClientRect(), clientX, clientY) : null;
  };

  const updateItem = (id: string, patch: Partial<Draft>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };

  /** Termina de escribir; un texto vacío no queda. */
  const finishEditing = () => {
    if (!editingId) return;
    const it = items.find((x) => x.id === editingId);
    if (it && it.kind === 'text' && !String(it.text || '').trim()) removeItem(it.id);
    setEditingId(null);
  };

  /** Cambia letra/tamaño: del texto seleccionado y de los que se agreguen después. */
  const changeStyle = (patch: Partial<TextStyle>) => {
    const next = { ...shownStyle, ...patch };
    setTextStyle(next);
    if (selectedText) updateItem(selectedText.id, next);
  };

  const pageInPoints = (page: number) => {
    const p = pages.find((x) => x.page === page);
    return p ? { w: p.width / PDF_SCALE, h: p.height / PDF_SCALE } : { w: 595, h: 842 };
  };

  const handlePageClick = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!placing) {
      finishEditing();
      setSelectedId(null);
      return;
    }
    const pct = clientToPct(page, e.clientX, e.clientY);
    if (!pct) return;
    const id = createFieldId();
    let draft: Draft;
    if (placing.kind === 'text') {
      const pts = pageInPoints(page);
      const lineH = (textStyle.fontSize / pts.h) * 100;
      draft = {
        id,
        kind: 'text',
        page,
        // El clic queda a la izquierda del texto, a media altura de la línea.
        x: clamp(pct.x, 0, 98),
        y: clamp(pct.y - lineH / 2, 0, 100 - lineH),
        width: 10,
        height: Math.max(1, lineH),
        text: '',
        label: '',
        ...textStyle,
        sealItemId: null,
        sealFileName: null,
      };
    } else {
      draft = {
        id,
        kind: 'seal',
        page,
        width: SEAL_DEFAULT.width,
        height: SEAL_DEFAULT.height,
        x: clamp(pct.x - SEAL_DEFAULT.width / 2, 0, 100 - SEAL_DEFAULT.width),
        y: clamp(pct.y - SEAL_DEFAULT.height / 2, 0, 100 - SEAL_DEFAULT.height),
        text: null,
        label: null,
        fontFamily: null,
        fontSize: null,
        bold: null,
        sealItemId: placing.sealItemId,
        sealFileName: placing.sealFileName,
      };
    }
    setItems((prev) => [...prev, draft]);
    setSelectedId(id);
    setPlacing(null);
    if (draft.kind === 'text') setEditingId(id);
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, item: Draft, mode: DragState['mode']) => {
    e.preventDefault();
    e.stopPropagation();
    const pct = clientToPct(item.page, e.clientX, e.clientY);
    if (!pct) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (editingId && editingId !== item.id) finishEditing();
    setSelectedId(item.id);
    if (item.kind === 'text') setTextStyle(styleOf(item));
    dragRef.current = {
      mode,
      id: item.id,
      page: item.page,
      offsetX: pct.x - item.x,
      offsetY: pct.y - item.y,
      moved: false,
    };
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pct = clientToPct(drag.page, e.clientX, e.clientY);
    if (!pct) return;
    drag.moved = true;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== drag.id) return it;
        if (drag.mode === 'move') {
          return {
            ...it,
            x: clamp(pct.x - drag.offsetX, 0, 100 - Math.min(it.width, 100)),
            y: clamp(pct.y - drag.offsetY, 0, 100 - Math.min(it.height, 100)),
          };
        }
        return {
          ...it,
          width: clamp(pct.x - it.x, MIN_SIZE, 100 - it.x),
          height: clamp(pct.y - it.y, MIN_SIZE, 100 - it.y),
        };
      })
    );
  };

  const endDrag = () => {
    lastDragMovedRef.current = Boolean(dragRef.current?.moved);
    dragRef.current = null;
  };

  // Suprimir borra lo seleccionado (si no está escribiendo).
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (editingId || !selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setItems((prev) => prev.filter((x) => x.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, editingId, selectedId]);

  /** Ancho y alto reales del texto (según letra y tamaño), medidos en pantalla. */
  const withMeasuredBoxes = (list: Draft[]): Draft[] =>
    list.map((it) => {
      if (it.kind !== 'text' || !it.fontSize) return it;
      const box = boxRefs.current[it.id]?.getBoundingClientRect();
      const pageRect = pageRefs.current[it.page]?.getBoundingClientRect();
      if (!box || !pageRect || pageRect.width === 0 || pageRect.height === 0) return it;
      const width = clamp((box.width / pageRect.width) * 100, 1, 100 - it.x);
      const height = clamp((box.height / pageRect.height) * 100, 1, 100 - it.y);
      return { ...it, width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
    });

  const uploadSeal = async (picked: File | null) => {
    if (!picked) return;
    if (!['image/png', 'image/jpeg'].includes(picked.type)) {
      toast.error('El sello debe ser una imagen PNG o JPG.');
      return;
    }
    setUploading(true);
    try {
      const file = await removeSealBackground(picked);
      if (file.size > SEAL_MAX_BYTES) {
        toast.error('La imagen del sello debe pesar máximo 2 MB.');
        return;
      }
      const form = new FormData();
      form.append('requestId', String(requestId));
      form.append('fileId', fileId);
      form.append('file', file);
      const res = await fetch('/api/integrations/orion/annotations/seal', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar el sello');
      finishEditing();
      setPlacing({ kind: 'seal', sealItemId: data.sealItemId, sealFileName: data.sealFileName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el sello');
    } finally {
      setUploading(false);
    }
  };

  /** Lo que se guarda o previsualiza: sin textos vacíos y con el tamaño real de cada texto. */
  const readyItems = () =>
    withMeasuredBoxes(items.filter((it) => it.kind === 'seal' || String(it.text || '').trim()));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/orion/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, annotations: readyItems() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron guardar los cambios');
      if (data.documents) onDocumentsUpdate?.(data.documents as Record<string, OrionSignatureState>);
      const copy = latestAnnotatedCopy(data.state as OrionSignatureState | undefined);
      toast.success(
        copy && copy.round > (latestAnnotatedCopy(state)?.round ?? 0)
          ? `Guardado. Quedó la copia "${copy.label}" en el historial de versiones.`
          : 'Guardado.'
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
    }
  };

  const [previewLoading, setPreviewLoading] = useState(false);
  const preview = async () => {
    if (!pdfSrc) return;
    setPreviewLoading(true);
    try {
      const saved = new Map((state.annotations ?? []).map((a) => [a.id, a]));
      await openAnnotatedPdfPreview({
        pdfUrl: pdfSrc,
        // Conserva el autor de lo ya guardado; lo nuevo sale a nombre de quien previsualiza.
        annotations: readyItems().map((it) => ({ ...saved.get(it.id), ...it })),
        sealImageSrc: sealSrc,
        viewerName: currentUserName || 'Usted',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo armar la vista previa');
    } finally {
      setPreviewLoading(false);
    }
  };

  const fullySigned = documentFullySigned(state);
  const placingMessage = placing
    ? placing.kind === 'text'
      ? 'Haga clic en el PDF donde va el texto.'
      : 'Haga clic en el PDF donde va el sello.'
    : null;

  return (
    <Modal
      opened={opened}
      onClose={requestClose}
      title={<Text fw={700}>Texto y sellos después de firmar · {fileName}</Text>}
      size='90rem'
      fullScreen={isMobile}
      closeOnClickOutside={false}
    >
      <Stack gap='sm'>
        <Alert variant='light' color='blue' icon={<IconAlertCircle size={18} />}>
          Lo que agregue aquí no cambia las firmas: queda encima del documento firmado. Cada vez que
          guarde se crea una copia nueva (“Datos 1”, “Datos 2”…) en el historial de versiones; las
          anteriores no se borran.
        </Alert>

        {/* Barra como la de un editor de PDF. */}
        <Paper withBorder radius='md' p='xs'>
          <Group gap='xs' wrap='wrap'>
            <Tooltip
              label={fullySigned ? 'Clic aquí y luego en el PDF donde va el texto' : 'Disponible cuando el documento tenga todas las firmas'}
              withArrow
            >
              <Button
                size='sm'
                variant={placing?.kind === 'text' ? 'filled' : 'light'}
                leftSection={<IconTextSize size={16} />}
                disabled={!fullySigned}
                onClick={() => {
                  finishEditing();
                  setSelectedId(null);
                  setPlacing(placing?.kind === 'text' ? null : { kind: 'text' });
                }}
              >
                Texto
              </Button>
            </Tooltip>
            <FileButton onChange={(f) => void uploadSeal(f)} accept='image/png,image/jpeg'>
              {(props) => (
                <Button
                  {...props}
                  size='sm'
                  variant={placing?.kind === 'seal' ? 'filled' : 'light'}
                  color='grape'
                  leftSection={<IconStack2 size={16} />}
                  loading={uploading}
                >
                  Sello
                </Button>
              )}
            </FileButton>

            <Divider orientation='vertical' />

            <Select
              size='sm'
              w={190}
              aria-label='Letra'
              data={FONT_OPTIONS}
              value={shownStyle.fontFamily}
              allowDeselect={false}
              disabled={!fullySigned}
              onChange={(v) => v && changeStyle({ fontFamily: v as OrionAnnotationFont })}
              renderOption={({ option }) => (
                <span style={{ fontFamily: CSS_FONT[option.value as OrionAnnotationFont] }}>{option.label}</span>
              )}
            />
            <Select
              size='sm'
              w={80}
              aria-label='Tamaño de letra'
              data={SIZE_OPTIONS}
              value={String(shownStyle.fontSize)}
              allowDeselect={false}
              searchable
              disabled={!fullySigned}
              onChange={(v) => v && changeStyle({ fontSize: Number(v) })}
            />
            <Tooltip label='Negrita' withArrow>
              <ActionIcon
                size='lg'
                variant={shownStyle.bold ? 'filled' : 'default'}
                aria-label='Negrita'
                aria-pressed={shownStyle.bold}
                disabled={!fullySigned}
                onClick={() => changeStyle({ bold: !shownStyle.bold })}
              >
                <IconBold size={16} />
              </ActionIcon>
            </Tooltip>

            {selected ? (
              <>
                <Divider orientation='vertical' />
                <Button
                  size='sm'
                  variant='subtle'
                  color='red'
                  leftSection={<IconTrash size={16} />}
                  onClick={() => removeItem(selected.id)}
                >
                  Quitar {selected.kind === 'text' ? 'texto' : 'sello'}
                </Button>
              </>
            ) : null}

            <Group gap={4} wrap='nowrap' ml='auto'>
              <Tooltip label='Alejar (Ctrl + rueda)' withArrow>
                <ActionIcon
                  variant='default'
                  size='lg'
                  aria-label='Alejar'
                  disabled={zoom <= ZOOM_MIN}
                  onClick={() => changeZoom((z) => z - ZOOM_STEP)}
                >
                  <IconZoomOut size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label='Volver al 100%' withArrow>
                <UnstyledButton
                  onClick={() => changeZoom(() => 1)}
                  aria-label='Volver al 100%'
                  style={{ minWidth: 44, textAlign: 'center' }}
                >
                  <Text size='xs' fw={600}>
                    {Math.round(zoom * 100)}%
                  </Text>
                </UnstyledButton>
              </Tooltip>
              <Tooltip label='Acercar (Ctrl + rueda)' withArrow>
                <ActionIcon
                  variant='default'
                  size='lg'
                  aria-label='Acercar'
                  disabled={zoom >= ZOOM_MAX}
                  onClick={() => changeZoom((z) => z + ZOOM_STEP)}
                >
                  <IconZoomIn size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {placingMessage ? (
            <Group
              mt='xs'
              px='sm'
              py={6}
              justify='space-between'
              wrap='nowrap'
              style={{ borderRadius: 8, background: 'var(--mantine-color-blue-light)' }}
            >
              <Text size='sm' fw={700} c='blue'>
                {placingMessage}
              </Text>
              <Button size='compact-sm' variant='subtle' leftSection={<IconX size={14} />} onClick={() => setPlacing(null)}>
                Cancelar
              </Button>
            </Group>
          ) : !fullySigned ? (
            <Text size='xs' c='dimmed' mt='xs'>
              El texto se agrega cuando el documento tenga todas las firmas. Por ahora solo puede ubicar sellos.
            </Text>
          ) : (
            <Text size='xs' c='dimmed' mt='xs'>
              Clic en un texto para cambiarlo · arrástrelo para moverlo · Suprimir para quitar lo seleccionado.
            </Text>
          )}
        </Paper>

        <ScrollArea h={isMobile ? '62vh' : '66vh'} offsetScrollbars viewportRef={viewportRef}>
          {loading ? (
            <Stack align='center' py='xl'>
              <Loader />
              <Text size='sm' c='dimmed'>
                Cargando el documento firmado…
              </Text>
            </Stack>
          ) : error || pages.length === 0 ? (
            <Text size='sm' c='red' py='xl' ta='center'>
              {error || 'No se pudo mostrar el documento'}
            </Text>
          ) : (
            <Stack gap='lg' p='xs' pt='sm'>
              {pages.map((page) => {
                const ptsW = page.width / PDF_SCALE;
                return (
                  <Box key={page.page}>
                    <Text size='xs' c='dimmed' ta='center' mb={4}>
                      Página {page.page} de {pages.length}
                    </Text>
                    <Box
                      ref={(el: HTMLDivElement | null) => {
                        pageRefs.current[page.page] = el;
                      }}
                      onClick={(e) => handlePageClick(page.page, e)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      style={{
                        position: 'relative',
                        // Centrada si cabe; con zoom se desborda y se recorre con el scroll.
                        width: zoom <= 1 ? '100%' : PAGE_BASE_WIDTH * zoom,
                        maxWidth: zoom <= 1 ? PAGE_BASE_WIDTH * zoom : 'none',
                        flexShrink: 0,
                        marginInline: 'auto',
                        // El tamaño de letra se calcula sobre el ancho de la hoja (cqw).
                        containerType: 'inline-size',
                        cursor: placing ? 'crosshair' : 'default',
                        boxShadow: placing
                          ? '0 0 0 2px var(--mantine-color-blue-5), 0 2px 12px rgba(0,0,0,0.08)'
                          : '0 2px 12px rgba(0,0,0,0.08)',
                        userSelect: 'none',
                        // La hoja deja desplazarse con el dedo; solo las cajas (abajo) bloquean el gesto para arrastrarlas.
                        touchAction: 'pan-x pan-y pinch-zoom',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.dataUrl ?? undefined}
                        alt={`Página ${page.page}`}
                        style={{ width: '100%', display: 'block', aspectRatio: `${page.width} / ${page.height}`, background: '#fff' }}
                        draggable={false}
                      />
                      {items
                        .filter((it) => it.page === page.page)
                        .map((it) => {
                          const isSelected = selectedId === it.id;
                          const editing = editingId === it.id;
                          const isText = it.kind === 'text';
                          // Texto con letra y tamaño: la caja se ajusta sola al texto.
                          const styled = isText && Boolean(it.fontSize);
                          const color = isText ? 'blue' : 'grape';
                          const st = styleOf(it);
                          const textCss = {
                            fontFamily: CSS_FONT[st.fontFamily],
                            fontSize: `${(st.fontSize / ptsW) * 100}cqw`,
                            fontWeight: st.bold ? 700 : 400,
                            lineHeight: 1,
                            color: '#0d1426',
                          } as const;
                          return (
                            <Box
                              key={it.id}
                              ref={(el: HTMLDivElement | null) => {
                                boxRefs.current[it.id] = el;
                              }}
                              onPointerDown={(e) => {
                                if (!editing) startDrag(e, it, 'move');
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Clic sin arrastrar en un texto: escribir en él.
                                if (isText && !lastDragMovedRef.current) setEditingId(it.id);
                              }}
                              style={{
                                position: 'absolute',
                                left: `${it.x}%`,
                                top: `${it.y}%`,
                                ...(styled
                                  ? { whiteSpace: 'nowrap', padding: 0 }
                                  : { width: `${it.width}%`, height: `${it.height}%` }),
                                outline: editing
                                  ? `2px solid var(--mantine-color-${color}-6)`
                                  : isSelected
                                    ? `1.5px dashed var(--mantine-color-${color}-6)`
                                    : styled
                                      ? 'none'
                                      : `1px dashed var(--mantine-color-${color}-4)`,
                                outlineOffset: 2,
                                background: editing ? 'color-mix(in srgb, var(--mantine-color-blue-1) 60%, transparent)' : 'transparent',
                                cursor: editing ? 'text' : 'move',
                                zIndex: isSelected || editing ? 2 : 1,
                                touchAction: 'none',
                              }}
                            >
                              {isText ? (
                                styled ? (
                                  editing ? (
                                    <input
                                      autoFocus
                                      value={it.text ?? ''}
                                      maxLength={ANNOTATION_MAX_TEXT}
                                      placeholder='Escriba aquí'
                                      aria-label='Texto'
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onChange={(e) => updateItem(it.id, { text: e.currentTarget.value })}
                                      onBlur={finishEditing}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === 'Escape') finishEditing();
                                      }}
                                      style={{
                                        ...textCss,
                                        display: 'block',
                                        border: 'none',
                                        outline: 'none',
                                        background: 'transparent',
                                        padding: 0,
                                        margin: 0,
                                        fieldSizing: 'content',
                                        minWidth: `${Math.max(3, (it.text ?? '').length + 1)}ch`,
                                      } as React.CSSProperties}
                                    />
                                  ) : (
                                    <span style={{ ...textCss, display: 'block' }}>{it.text}</span>
                                  )
                                ) : (
                                  // Texto guardado antes (sin letra elegida): se ajusta a su caja.
                                  <Box style={{ width: '100%', height: '100%', overflow: 'hidden', containerType: 'size' }}>
                                    {editing ? (
                                      <input
                                        autoFocus
                                        value={it.text ?? ''}
                                        maxLength={ANNOTATION_MAX_TEXT}
                                        aria-label='Texto'
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) => updateItem(it.id, { text: e.currentTarget.value })}
                                        onBlur={finishEditing}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === 'Escape') finishEditing();
                                        }}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          border: 'none',
                                          outline: 'none',
                                          background: 'transparent',
                                          padding: '0 2px',
                                          fontWeight: 700,
                                          fontSize: '70cqh',
                                          lineHeight: 1,
                                          color: '#0d1426',
                                        }}
                                      />
                                    ) : (
                                      <Text fw={700} c='dark.8' style={{ fontSize: '70cqh', lineHeight: 1.3, whiteSpace: 'nowrap', padding: '0 2px' }}>
                                        {it.text}
                                      </Text>
                                    )}
                                  </Box>
                                )
                              ) : it.sealItemId ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={sealSrc(it.sealItemId)}
                                  alt='Sello'
                                  draggable={false}
                                  style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                                />
                              ) : null}
                              {!styled ? (
                                <Box
                                  onPointerDown={(e) => startDrag(e, it, 'resize')}
                                  title='Cambiar tamaño'
                                  style={{
                                    position: 'absolute',
                                    right: -5,
                                    bottom: -5,
                                    width: 10,
                                    height: 10,
                                    borderRadius: 2,
                                    border: '1px solid #fff',
                                    background: `var(--mantine-color-${color}-6)`,
                                    cursor: 'nwse-resize',
                                  }}
                                />
                              ) : null}
                            </Box>
                          );
                        })}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          )}
        </ScrollArea>

        <Group justify='space-between' gap='xs' wrap='wrap'>
          <Text size='xs' c={dirty ? 'orange' : 'dimmed'}>
            {dirty ? 'Hay cambios sin guardar.' : 'Sin cambios.'}
          </Text>
          <Group gap='xs'>
            <Button
              variant='subtle'
              leftSection={<IconEye size={16} />}
              onClick={() => void preview()}
              loading={previewLoading}
              disabled={saving || loading || pages.length === 0}
            >
              Vista previa (PDF)
            </Button>
            <Button variant='default' onClick={requestClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={loading || pages.length === 0 || !dirty}>
              Guardar
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
