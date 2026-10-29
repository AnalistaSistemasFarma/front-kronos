'use client';

import {
  ActionIcon,
  Alert,
  Box,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconCalendar,
  IconCurrencyDollar,
  IconEye,
  IconHash,
  IconPlus,
  IconStack2,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  ANNOTATION_MAX_LABEL,
  ANNOTATION_MAX_TEXT,
  SEAL_MAX_BYTES,
  documentFullySigned,
  latestAnnotatedCopy,
} from '../../lib/orion/annotations';
import { createFieldId, pctFromClientPoint } from '../../lib/orion/signatureFields';
import type { OrionDocumentAnnotation, OrionSignatureState } from '../../lib/orion/types';
import { usePdfPageImages } from './usePdfPageImages';
import { openAnnotatedPdfPreview } from './annotatedPdfPreview';

type Draft = Pick<
  OrionDocumentAnnotation,
  'id' | 'kind' | 'page' | 'x' | 'y' | 'width' | 'height' | 'text' | 'label' | 'sealItemId' | 'sealFileName'
>;

type TextPreset = {
  key: string;
  /** Texto del botón. */
  title: string;
  /** Nombre que queda en el dato ('' = lo escribe la persona). */
  label: string;
  icon: ReactNode;
  width: number;
  placeholder: string;
  /** Valor inicial (p. ej. la fecha de hoy). */
  initialText?: () => string;
};

type PlacingMode =
  | { kind: 'text'; preset: TextPreset }
  | { kind: 'seal'; sealItemId: string; sealFileName: string }
  | null;

type DragState = {
  mode: 'move' | 'resize';
  id: string;
  page: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

function todayLabel(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** Datos habituales de los giros; "Otro dato" deja escribir el nombre. */
const TEXT_PRESETS: TextPreset[] = [
  { key: 'consecutivo', title: 'Consecutivo', label: 'Consecutivo', icon: <IconHash size={16} />, width: 18, placeholder: 'Ej.: 2026-0451' },
  { key: 'tasa', title: 'Tipo de cambio', label: 'Tipo de cambio', icon: <IconCurrencyDollar size={16} />, width: 16, placeholder: 'Ej.: 4.123,45' },
  { key: 'fecha', title: 'Fecha del giro', label: 'Fecha del giro', icon: <IconCalendar size={16} />, width: 14, placeholder: 'dd/mm/aaaa', initialText: todayLabel },
  { key: 'otro', title: 'Otro dato', label: '', icon: <IconPlus size={16} />, width: 22, placeholder: 'Escriba el valor' },
];

const TEXT_HEIGHT = 3.2;
const SEAL_DEFAULT = { width: 16, height: 11 };
const MIN_SIZE = 1.5;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
    sealItemId: a.sealItemId ?? null,
    sealFileName: a.sealFileName ?? null,
  };
}

function StepChip({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <Group gap={6} wrap='nowrap' style={{ opacity: active || done ? 1 : 0.55 }}>
      <ThemeIcon size={22} radius='xl' variant={active ? 'filled' : 'light'} color={done ? 'teal' : 'blue'}>
        <Text size='xs' fw={700}>
          {n}
        </Text>
      </ThemeIcon>
      <Text size='sm' fw={active ? 700 : 500}>
        {label}
      </Text>
    </Group>
  );
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
 * Datos y sellos DESPUÉS de firmar (p. ej. consecutivo, tipo de cambio y fecha del giro).
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
  // Sin los datos ya estampados: aquí se dibujan como cajas editables.
  const pdfSrc = opened
    ? `/api/integrations/orion/signed-file?${new URLSearchParams({ requestId: String(requestId), fileId, annotations: '0' })}`
    : null;
  const { pages, loading, error } = usePdfPageImages(pdfSrc);

  const [items, setItems] = useState<Draft[]>([]);
  const [placing, setPlacing] = useState<PlacingMode>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Caja de texto en la que se está escribiendo (directo sobre el PDF). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const boxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const lastDragMovedRef = useRef(false);
  const initialJsonRef = useRef('[]');

  useEffect(() => {
    if (!opened) return;
    const initial = (state.annotations ?? []).map(toDraft);
    initialJsonRef.current = JSON.stringify(initial);
    setItems(initial);
    setPlacing(null);
    setSelectedId(null);
    setEditingId(null);
    // Solo al abrir: mientras edita no se pisan sus cambios.
  }, [opened]);

  const dirty = JSON.stringify(items) !== initialJsonRef.current;

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

  const focusBox = (id: string) => {
    setSelectedId(id);
    boxRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handlePageClick = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!placing) {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    const pct = clientToPct(page, e.clientX, e.clientY);
    if (!pct) return;
    const size = placing.kind === 'text' ? { width: placing.preset.width, height: TEXT_HEIGHT } : SEAL_DEFAULT;
    const id = createFieldId();
    const draft: Draft = {
      id,
      kind: placing.kind,
      page,
      width: size.width,
      height: size.height,
      // El clic marca dónde empieza el texto (borde izquierdo, centrado en la línea).
      x: clamp(placing.kind === 'text' ? pct.x : pct.x - size.width / 2, 0, 100 - size.width),
      y: clamp(pct.y - size.height / 2, 0, 100 - size.height),
      text: placing.kind === 'text' ? (placing.preset.initialText?.() ?? '') : null,
      label: placing.kind === 'text' ? placing.preset.label : null,
      sealItemId: placing.kind === 'seal' ? placing.sealItemId : null,
      sealFileName: placing.kind === 'seal' ? placing.sealFileName : null,
    };
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
    setSelectedId(item.id);
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
            x: clamp(pct.x - drag.offsetX, 0, 100 - it.width),
            y: clamp(pct.y - drag.offsetY, 0, 100 - it.height),
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

  const uploadSeal = async (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('El sello debe ser una imagen PNG o JPG.');
      return;
    }
    if (file.size > SEAL_MAX_BYTES) {
      toast.error('La imagen del sello debe pesar máximo 2 MB.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('requestId', String(requestId));
      form.append('fileId', fileId);
      form.append('file', file);
      const res = await fetch('/api/integrations/orion/annotations/seal', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar el sello');
      setEditingId(null);
      setPlacing({ kind: 'seal', sealItemId: data.sealItemId, sealFileName: data.sealFileName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el sello');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const empty = items.find((it) => it.kind === 'text' && !String(it.text || '').trim());
    if (empty) {
      focusBox(empty.id);
      setEditingId(empty.id);
      toast.error(`Escriba el valor de "${empty.label || 'el dato'}" (o quítelo).`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/orion/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, annotations: items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron guardar los datos');
      if (data.documents) onDocumentsUpdate?.(data.documents as Record<string, OrionSignatureState>);
      const copy = latestAnnotatedCopy(data.state as OrionSignatureState | undefined);
      toast.success(
        copy && copy.round > (latestAnnotatedCopy(state)?.round ?? 0)
          ? `Guardado. Quedó la copia "${copy.label}" en el historial de versiones.`
          : 'Guardado.'
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron guardar los datos');
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
        annotations: items
          .filter((it) => it.kind === 'seal' || String(it.text || '').trim())
          .map((it) => ({ ...saved.get(it.id), ...it })),
        sealImageSrc: sealSrc,
        viewerName: currentUserName || 'Usted',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo armar la vista previa');
    } finally {
      setPreviewLoading(false);
    }
  };

  const textItems = items.filter((it) => it.kind === 'text');
  const sealItems = items.filter((it) => it.kind === 'seal');
  const textNumber = new Map(textItems.map((it, i) => [it.id, i + 1]));
  const fullySigned = documentFullySigned(state);
  const editingItem = editingId ? items.find((it) => it.id === editingId) : null;
  const step = placing ? 2 : editingItem ? 3 : 1;

  const placingMessage = placing
    ? placing.kind === 'text'
      ? `Haga clic en el PDF donde empieza ${placing.preset.label ? `"${placing.preset.label}"` : 'el dato'}.`
      : 'Haga clic en el PDF donde va el sello.'
    : null;

  return (
    <Modal
      opened={opened}
      onClose={requestClose}
      title={<Text fw={700}>Datos y sellos después de firmar · {fileName}</Text>}
      size='90rem'
      fullScreen={isMobile}
      closeOnClickOutside={false}
    >
      <Stack gap='sm'>
        <Alert variant='light' color='blue' icon={<IconAlertCircle size={18} />}>
          Lo que agregue aquí no cambia las firmas: queda encima del documento firmado, con su nombre
          y la fecha. Cada vez que guarde se crea una copia nueva (“Datos 1”, “Datos 2”…) en el
          historial de versiones; las anteriores no se borran.
        </Alert>

        {/* Pasos: qué hacer ahora. */}
        <Paper withBorder radius='md' p='sm'>
          <Group gap='lg' wrap='wrap'>
            <StepChip n={1} label='Elija qué dato va' active={step === 1} done={step > 1} />
            <StepChip n={2} label='Haga clic en el PDF donde va' active={step === 2} done={step > 2} />
            <StepChip n={3} label='Escriba el valor en la caja' active={step === 3} done={false} />
          </Group>

          {fullySigned ? (
            <Group gap='xs' mt='sm' wrap='wrap'>
              {TEXT_PRESETS.map((preset) => {
                const active = placing?.kind === 'text' && placing.preset.key === preset.key;
                return (
                  <Button
                    key={preset.key}
                    size='sm'
                    variant={active ? 'filled' : 'light'}
                    leftSection={preset.icon}
                    onClick={() => {
                      setEditingId(null);
                      setPlacing(active ? null : { kind: 'text', preset });
                    }}
                  >
                    {preset.title}
                  </Button>
                );
              })}
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
            </Group>
          ) : (
            <Group gap='xs' mt='sm' wrap='wrap'>
              <Text size='sm' c='dimmed'>
                Los datos se agregan cuando el documento tenga todas las firmas. Por ahora solo puede
                ubicar sellos.
              </Text>
              <FileButton onChange={(f) => void uploadSeal(f)} accept='image/png,image/jpeg'>
                {(props) => (
                  <Button {...props} size='sm' variant='light' color='grape' leftSection={<IconStack2 size={16} />} loading={uploading}>
                    Sello
                  </Button>
                )}
              </FileButton>
            </Group>
          )}

          {placingMessage ? (
            <Group
              mt='sm'
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
          ) : editingItem ? (
            <Text size='sm' mt='sm' c='blue' fw={600}>
              Escriba {editingItem.label ? `"${editingItem.label}"` : 'el valor'} en la caja resaltada. Enter para terminar ·
              arrastre la caja para moverla · esquina inferior para el tamaño.
            </Text>
          ) : null}
        </Paper>

        <Group align='flex-start' gap='md' wrap={isMobile ? 'wrap' : 'nowrap'}>
          <ScrollArea h={isMobile ? '60vh' : '64vh'} style={{ flex: 1, minWidth: 0 }} offsetScrollbars>
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
              <Stack gap='lg' p='xs' pt='lg'>
                {pages.map((page) => (
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
                        width: '100%',
                        maxWidth: 900,
                        marginInline: 'auto',
                        cursor: placing ? 'crosshair' : 'default',
                        boxShadow: placing
                          ? '0 0 0 2px var(--mantine-color-blue-5), 0 2px 12px rgba(0,0,0,0.08)'
                          : '0 2px 12px rgba(0,0,0,0.08)',
                        userSelect: 'none',
                        touchAction: 'none',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={page.dataUrl} alt={`Página ${page.page}`} style={{ width: '100%', display: 'block' }} draggable={false} />
                      {items
                        .filter((it) => it.page === page.page)
                        .map((it) => {
                          const selected = selectedId === it.id;
                          const editing = editingId === it.id;
                          const isText = it.kind === 'text';
                          const color = isText ? 'blue' : 'grape';
                          const tag = isText
                            ? `${textNumber.get(it.id)} · ${it.label || 'Dato'}`
                            : 'Sello';
                          return (
                            <Box
                              key={it.id}
                              ref={(el: HTMLDivElement | null) => {
                                boxRefs.current[it.id] = el;
                              }}
                              onPointerDown={(e) => startDrag(e, it, 'move')}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Clic sin arrastrar en un dato: escribir en él.
                                if (isText && !lastDragMovedRef.current) setEditingId(it.id);
                              }}
                              style={{
                                position: 'absolute',
                                left: `${it.x}%`,
                                top: `${it.y}%`,
                                width: `${it.width}%`,
                                height: `${it.height}%`,
                                border: `${editing ? 2 : 1.5}px ${selected || editing ? 'solid' : 'dashed'} var(--mantine-color-${color}-6)`,
                                background: isText
                                  ? `color-mix(in srgb, var(--mantine-color-${color}-1) ${editing ? 80 : 50}%, transparent)`
                                  : 'transparent',
                                boxShadow: editing ? '0 0 0 4px color-mix(in srgb, var(--mantine-color-blue-4) 35%, transparent)' : undefined,
                                cursor: editing ? 'text' : 'move',
                                zIndex: selected || editing ? 2 : 1,
                              }}
                            >
                              {/* Etiqueta: número y nombre, igual que en la lista. No sale en el PDF. */}
                              <Box
                                style={{
                                  position: 'absolute',
                                  left: -1.5,
                                  bottom: '100%',
                                  marginBottom: 2,
                                  padding: '0 6px',
                                  borderRadius: 4,
                                  background: `var(--mantine-color-${color}-6)`,
                                  color: '#fff',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  lineHeight: '16px',
                                  whiteSpace: 'nowrap',
                                  pointerEvents: 'none',
                                }}
                              >
                                {tag}
                              </Box>
                              <Box style={{ width: '100%', height: '100%', overflow: 'hidden', containerType: 'size' }}>
                                {isText ? (
                                  editing ? (
                                    <input
                                      autoFocus
                                      value={it.text ?? ''}
                                      maxLength={ANNOTATION_MAX_TEXT}
                                      placeholder={TEXT_PRESETS.find((p) => p.label === it.label)?.placeholder || 'Escriba el valor'}
                                      aria-label={it.label || 'Valor del dato'}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onChange={(e) => updateItem(it.id, { text: e.currentTarget.value })}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === 'Escape') setEditingId(null);
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
                                        color: 'var(--mantine-color-dark-8)',
                                      }}
                                    />
                                  ) : (
                                    <Text
                                      fw={700}
                                      c={it.text ? 'dark.8' : 'dimmed'}
                                      style={{ fontSize: '70cqh', lineHeight: 1.3, whiteSpace: 'nowrap', padding: '0 2px' }}
                                    >
                                      {it.text || 'Clic para escribir'}
                                    </Text>
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
                              </Box>
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
                            </Box>
                          );
                        })}
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </ScrollArea>

          <Stack gap='xs' w={isMobile ? '100%' : 320} style={{ flexShrink: 0 }}>
            <Text size='sm' fw={700}>
              Datos ({textItems.length})
            </Text>
            {textItems.length === 0 ? (
              <Text size='xs' c='dimmed'>
                {fullySigned
                  ? 'Elija arriba qué dato va (consecutivo, tipo de cambio, fecha…) y haga clic en el PDF donde debe quedar.'
                  : 'Disponible cuando el documento tenga todas las firmas.'}
              </Text>
            ) : null}
            {textItems.map((it) => {
              const active = selectedId === it.id || editingId === it.id;
              const missing = !String(it.text || '').trim();
              return (
                <Paper
                  key={it.id}
                  withBorder
                  radius='md'
                  p='xs'
                  onClick={() => focusBox(it.id)}
                  style={{
                    cursor: 'pointer',
                    borderColor: active ? 'var(--mantine-color-blue-6)' : undefined,
                    background: active ? 'var(--mantine-color-blue-light)' : undefined,
                  }}
                >
                  <Group justify='space-between' wrap='nowrap' gap={6}>
                    <Group gap={6} wrap='nowrap'>
                      <ThemeIcon size={20} radius='xl' color='blue'>
                        <Text size='11px' fw={700}>
                          {textNumber.get(it.id)}
                        </Text>
                      </ThemeIcon>
                      <Text size='xs' c='dimmed'>
                        Página {it.page}
                      </Text>
                    </Group>
                    <Tooltip label='Quitar dato' withArrow>
                      <ActionIcon
                        color='red'
                        variant='subtle'
                        size='sm'
                        aria-label='Quitar dato'
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(it.id);
                        }}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <TextInput
                    mt={6}
                    size='xs'
                    label='Nombre del dato'
                    placeholder='Ej.: Tipo de cambio'
                    value={it.label ?? ''}
                    maxLength={ANNOTATION_MAX_LABEL}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateItem(it.id, { label: e.currentTarget.value })}
                    description='Solo para identificarlo; no sale en el PDF.'
                  />
                  <TextInput
                    mt={6}
                    size='xs'
                    label='Valor (lo que sale en el PDF)'
                    placeholder={TEXT_PRESETS.find((p) => p.label === it.label)?.placeholder || 'Escriba el valor'}
                    value={it.text ?? ''}
                    maxLength={ANNOTATION_MAX_TEXT}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedId(it.id)}
                    onChange={(e) => updateItem(it.id, { text: e.currentTarget.value })}
                    error={missing ? 'Falta el valor' : undefined}
                  />
                </Paper>
              );
            })}

            <Text size='sm' fw={700} mt='sm'>
              Sellos ({sealItems.length})
            </Text>
            {sealItems.length === 0 ? (
              <Text size='xs' c='dimmed'>
                Use “Sello” para subir la imagen (PNG o JPG, máx. 2 MB; mejor con fondo transparente).
              </Text>
            ) : null}
            {sealItems.map((it) => (
              <Group key={it.id} gap={6} wrap='nowrap' justify='space-between'>
                <Text size='xs' onClick={() => focusBox(it.id)} style={{ cursor: 'pointer' }}>
                  Sello · página {it.page}
                </Text>
                <Tooltip label='Quitar sello' withArrow>
                  <ActionIcon color='red' variant='subtle' size='sm' aria-label='Quitar sello' onClick={() => removeItem(it.id)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        </Group>

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
