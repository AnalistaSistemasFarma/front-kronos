'use client';

/**
 * UBICACIÓN DE FIRMAS SOBRE EL DOCUMENTO — copia CONGELADA (2026-10-03) de
 * components/orion/SignaturePlacementCanvas.tsx de SynerLink (el mecanismo en
 * el que el usuario elige en el documento dónde firman las otras personas),
 * dentro del SGC: el sistema validado no importa en ejecución componentes
 * vivos de Orión/SynerLink. Mismo marcado, estilos, textos e interacción
 * (clic para colocar, arrastrar para mover, esquina para redimensionar). Solo
 * cambian los imports y el rótulo de la caja (significado · nombre, p. ej.
 * «Aprobó · Ana Pérez»). La paridad se prueba en
 * components/sgc/signature/__tests__/placementParity.test.tsx.
 *
 * Celular (revisión móvil 2026-10-03): con dedo (`pointer: coarse`) el
 * documento se desplaza y se amplía con los dedos (antes `touch-action: none`
 * en toda la página atrapaba el desplazamiento), un toque en el documento
 * coloca la caja de la persona elegida («tocar para ubicar») y la caja se
 * arrastra con el dedo. Con ratón el marcado es idéntico al de SynerLink (la
 * condición solo se activa en el navegador, así que la prueba de paridad no
 * cambia).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ActionIcon, Box, Group, Loader, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCircleCheckFilled, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import {
  clampFieldSize,
  createFieldId,
  defaultSizeForKind,
  isValidatorPlacementOrder,
  normalizeFieldKind,
  pctFromClientPoint,
  sizeBoundsForKind,
  type SignatureFieldKind,
  type SignatureFieldPlacement,
} from '../../../lib/sgc/signature/fields';
import { useSgcPdfPageImages as usePdfPageImages } from './useSgcPdfPageImages';

/** Persona cuya firma se ubica (mismo contrato que el participante de SynerLink que usa este lienzo). */
export type SgcPlacementPerson = {
  order: number;
  name: string;
  email: string;
  role: string;
  signatureDataUrl?: string | null;
  signatureMarkId?: number | null;
};

type Props = {
  pdfSrc: string | null;
  documentId: string;
  participants: SgcPlacementPerson[];
  activeOrder: number;
  /** Tipo de caja a colocar (firma / huella / validación). */
  activeKind?: SignatureFieldKind;
  fields: SignatureFieldPlacement[];
  onChange: (fields: SignatureFieldPlacement[]) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const AUTO_MARGIN = 4;
const AUTO_GAP = 1;

function approvalLabel(name?: string | null) {
  return `Validó · ${name || 'Validador'}`;
}

/** Cajas de validadores que faltan: fila en la esquina inferior derecha de la última página. */
function autoPlaceApprovalFields(
  fields: SignatureFieldPlacement[],
  validators: Array<{ order: number; name?: string | null }>,
  lastPage: number,
  documentId: string
): SignatureFieldPlacement[] | null {
  const missing = validators.filter(
    (v) => !fields.some((f) => f.signerOrder === v.order && normalizeFieldKind(f.kind) === 'approval')
  );
  if (missing.length === 0) return null;
  const { width, height } = defaultSizeForKind('approval');
  const perRow = Math.max(1, Math.floor((100 - AUTO_MARGIN * 2 + AUTO_GAP) / (width + AUTO_GAP)));
  const added = missing.map((v, index) => {
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return clampFieldSize({
      id: createFieldId(),
      documentId,
      signerOrder: v.order,
      page: lastPage,
      x: 100 - AUTO_MARGIN - width - col * (width + AUTO_GAP),
      y: 100 - AUTO_MARGIN - height - row * (height + AUTO_GAP),
      width,
      height,
      label: approvalLabel(v.name),
      kind: 'approval',
    });
  });
  return [...fields, ...added];
}

type DragState = {
  mode: 'move' | 'resize';
  fieldId: string;
  page: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  moved: boolean;
  startClientX: number;
  startClientY: number;
};

const CLICK_SUPPRESS_MS = 280;
const MOVE_THRESHOLD_PX = 4;

// S16 (R35, D22): página más grande para ubicar las firmas (antes 720 px); el mismo valor en el SGC y en SynerLink (paridad).
const PAGE_BASE_WIDTH = 1000;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
/** Se renderiza a más resolución que la vista base para que la letra se lea al hacer zoom. */
const PDF_RENDER_SCALE = 2.5;

function clampZoom(z: number) {
  return Math.round(clamp(z, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
}

export default function SgcSignaturePlacementCanvas({
  pdfSrc,
  documentId,
  participants,
  activeOrder,
  activeKind = 'signature',
  fields,
  onChange,
}: Props) {
  const { pages, loading, error } = usePdfPageImages(pdfSrc, PDF_RENDER_SCALE);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Centro visible (fracción del contenido) que se conserva al cambiar el zoom.
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const imgRefs = useRef<Record<number, HTMLImageElement | null>>({});
  const fieldsRef = useRef(fields);
  const onChangeRef = useRef(onChange);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [, setInteractionTick] = useState(0);
  const coarse = useMediaQuery('(pointer: coarse)') ?? false;

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const activePerson = participants.find((p) => p.order === activeOrder);
  const activeIsValidator = isValidatorPlacementOrder(activeOrder);

  const lastPage = pages.length > 0 ? pages[pages.length - 1]!.page : 0;
  useEffect(() => {
    if (!lastPage) return;
    const validators = participants.filter((p) => isValidatorPlacementOrder(p.order));
    if (validators.length === 0) return;
    const next = autoPlaceApprovalFields(fieldsRef.current, validators, lastPage, documentId);
    if (next) onChangeRef.current(next);
  }, [documentId, fields, lastPage, participants]);

  const getPageRect = useCallback((page: number): DOMRect | null => {
    const img = imgRefs.current[page];
    if (img) return img.getBoundingClientRect();
    const el = pageRefs.current[page];
    return el ? el.getBoundingClientRect() : null;
  }, []);

  const clientToPct = useCallback(
    (page: number, clientX: number, clientY: number) => {
      const rect = getPageRect(page);
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return pctFromClientPoint(rect, clientX, clientY);
    },
    [getPageRect]
  );

  const placeAt = useCallback(
    (page: number, xPct: number, yPct: number) => {
      const currentFields = fieldsRef.current;
      const signer = participants.find((p) => p.order === activeOrder);
      const kind = isValidatorPlacementOrder(activeOrder)
        ? 'approval'
        : normalizeFieldKind(activeKind);
      const defaults = defaultSizeForKind(kind);
      const bounds = sizeBoundsForKind(kind);
      const existing = currentFields.find(
        (f) => f.signerOrder === activeOrder && normalizeFieldKind(f.kind) === kind
      );
      const width = clamp(existing?.width ?? defaults.width, bounds.minW, bounds.maxW);
      const height = clamp(existing?.height ?? defaults.height, bounds.minH, bounds.maxH);
      const x = clamp(xPct - width / 2, 0, 100 - width);
      const y = clamp(yPct - height / 2, 0, 100 - height);

      const labelBase = signer?.name || existing?.label || `Firma ${activeOrder}`;
      const markId =
        signer &&
        Number.isFinite(Number(signer.signatureMarkId)) &&
        Number(signer.signatureMarkId) >= 1
          ? Math.trunc(Number(signer.signatureMarkId))
          : activeOrder;
      // SGC: el rótulo es el significado de la firma y el nombre (p. ej. «Aprobó · Ana Pérez»).
      const label = signer?.role
        ? `${signer.role} · ${labelBase}`
        : kind === 'approval'
          ? approvalLabel(signer?.name)
          : kind === 'validation'
          ? existing?.label || 'Elaboró'
          : kind === 'fingerprint'
            ? `Huella · ${markId} · ${signer?.name || activeOrder}`
            : `Firma ${markId} · ${labelBase}`;

      if (existing) {
        onChangeRef.current(
          currentFields.map((f) =>
            f.id === existing.id
              ? clampFieldSize({ ...f, page, x, y, width, height, label, kind })
              : f
          )
        );
        return;
      }

      onChangeRef.current([
        ...currentFields,
        clampFieldSize({
          id: createFieldId(),
          documentId,
          signerOrder: activeOrder,
          page,
          x,
          y,
          width,
          height,
          label,
          kind,
        }),
      ]);
    },
    [activeKind, activeOrder, documentId, participants]
  );

  const handlePageClick = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) return;
    if (dragRef.current) return;
    const pct = clientToPct(page, e.clientX, e.clientY);
    if (!pct) return;
    placeAt(page, pct.x, pct.y);
  };

  const updateFieldFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pct = clientToPct(drag.page, clientX, clientY);
      if (!pct) return;
      const currentFields = fieldsRef.current;
      const field = currentFields.find((f) => f.id === drag.fieldId);
      if (!field) return;

      if (drag.mode === 'move') {
        const x = clamp(pct.x - drag.offsetX, 0, 100 - field.width);
        const y = clamp(pct.y - drag.offsetY, 0, 100 - field.height);
        onChangeRef.current(
          currentFields.map((f) =>
            f.id === drag.fieldId ? clampFieldSize({ ...f, x, y }) : f
          )
        );
        return;
      }

      const bounds = sizeBoundsForKind(field.kind);
      const width = clamp(pct.x - field.x, bounds.minW, bounds.maxW);
      const height = clamp(pct.y - field.y, bounds.minH, bounds.maxH);
      onChangeRef.current(
        currentFields.map((f) =>
          f.id === drag.fieldId ? clampFieldSize({ ...f, width, height }) : f
        )
      );
    },
    [clientToPct]
  );

  const endInteraction = useCallback((pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (pointerId != null && drag.pointerId !== pointerId) return;

    if (drag.moved) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    }
    dragRef.current = null;
    setInteractionTick((n) => n + 1);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && dx * dx + dy * dy >= MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) {
        drag.moved = true;
      }
      if (drag.moved) {
        e.preventDefault();
        updateFieldFromPointer(e.clientX, e.clientY);
      }
    }

    function onUp(e: PointerEvent) {
      endInteraction(e.pointerId);
    }

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [endInteraction, updateFieldFromPointer]);

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

  // Ctrl + rueda: zoom (listener no pasivo para poder evitar el zoom del navegador).
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
  }, [changeZoom, hasPages, loading]);

  const startMove = (
    e: ReactPointerEvent<HTMLDivElement>,
    field: SignatureFieldPlacement,
    page: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const pct = clientToPct(page, e.clientX, e.clientY);
    if (!pct) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = {
      mode: 'move',
      fieldId: field.id,
      page,
      offsetX: pct.x - field.x,
      offsetY: pct.y - field.y,
      pointerId: e.pointerId,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setInteractionTick((n) => n + 1);
  };

  const startResize = (
    e: ReactPointerEvent<HTMLDivElement>,
    field: SignatureFieldPlacement,
    page: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = {
      mode: 'resize',
      fieldId: field.id,
      page,
      offsetX: 0,
      offsetY: 0,
      pointerId: e.pointerId,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setInteractionTick((n) => n + 1);
  };

  if (loading) {
    return (
      <Stack align='center' justify='center' py='xl' style={{ minHeight: 320 }}>
        <Loader />
        <Text size='sm' c='dimmed'>
          Cargando páginas del documento…
        </Text>
      </Stack>
    );
  }

  if (error || pages.length === 0) {
    return (
      <Stack align='center' justify='center' py='xl' style={{ minHeight: 320 }}>
        <Text size='sm' c='red'>
          {error || 'No se pudo renderizar el PDF'}
        </Text>
      </Stack>
    );
  }

  const interacting = Boolean(dragRef.current);
  const kindBounds = sizeBoundsForKind(activeIsValidator ? 'approval' : activeKind);

  return (
    <Stack gap='sm' style={{ height: '100%', minHeight: 0 }}>
      <Box
        px='md'
        py='sm'
        style={{
          flexShrink: 0,
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--app-accent) 12%, var(--app-surface))',
          border: '1px solid color-mix(in srgb, var(--app-accent) 35%, var(--app-border))',
        }}
      >
        <Text size='sm' fw={700} style={{ color: 'var(--app-accent)' }}>
          {activeIsValidator
            ? `Ubique el visto bueno de ${activePerson?.name ?? 'validador'}`
            : `Ubique la firma de ${activePerson?.name ?? 'firmante'}`}
        </Text>
        {activeIsValidator ? (
          <Text size='xs' c='dimmed' mt={2}>
            Mientras se firma se ve un chulito; en la versión final se reemplaza por su firma
            guardada, en pequeño.
          </Text>
        ) : null}
        <Group justify='space-between' align='center' gap='xs' mt={4} wrap='wrap'>
          <Text size='xs' c='dimmed' style={{ flex: '1 1 260px' }}>
            {coarse ? 'Toque el documento para colocar · arrastre la caja con el dedo para moverla · esquina inferior para redimensionar (' : 'Clic para colocar · arrastre para mover · esquina inferior para redimensionar ('}
            {kindBounds.minW}–{kindBounds.maxW}% × {kindBounds.minH}–{kindBounds.maxH}%). Usa los botones para hacer zoom.
          </Text>
          <Group gap={4} wrap='nowrap'>
            <Tooltip label='Alejar' withArrow>
              <ActionIcon
                variant='default'
                size={44}
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
                style={{ minWidth: 44, minHeight: 44, textAlign: 'center' }}
              >
                <Text size='xs' fw={600}>
                  {Math.round(zoom * 100)}%
                </Text>
              </UnstyledButton>
            </Tooltip>
            <Tooltip label='Acercar' withArrow>
              <ActionIcon
                variant='default'
                size={44}
                aria-label='Acercar'
                disabled={zoom >= ZOOM_MAX}
                onClick={() => changeZoom((z) => z + ZOOM_STEP)}
              >
                <IconZoomIn size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>
      <ScrollArea
        style={{ flex: 1, minHeight: 0 }}
        h='100%'
        offsetScrollbars
        type='scroll'
        scrollbarSize={10}
        viewportRef={viewportRef}
        styles={{
          viewport: { paddingBottom: 16 },
        }}
      >
        <Stack gap='lg' p='md' align='flex-start' pb='xl'>
          {pages.map((page) => (
            <Box
              key={page.page}
              ref={(el) => {
                pageRefs.current[page.page] = el;
              }}
              onClick={(e) => handlePageClick(page.page, e)}
              style={{
                position: 'relative',
                // Márgenes auto: centrada si cabe; con zoom se desborda solo hacia la derecha (scroll).
                marginInline: 'auto',
                flexShrink: 0,
                width: zoom <= 1 ? '100%' : PAGE_BASE_WIDTH * zoom,
                maxWidth: zoom <= 1 ? PAGE_BASE_WIDTH * zoom : 'none',
                cursor: interacting ? 'grabbing' : 'crosshair',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                borderRadius: 4,
                overflow: 'hidden',
                background: '#fff',
                userSelect: 'none',
                touchAction: coarse ? 'pan-x pan-y pinch-zoom' : 'none',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={(el) => {
                  imgRefs.current[page.page] = el;
                }}
                src={page.dataUrl}
                alt={`Página ${page.page}`}
                style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none' }}
                draggable={false}
              />
              {fields
                .filter((f) => f.page === page.page)
                .map((field) => {
                  const person = participants.find((p) => p.order === field.signerOrder);
                  const isActive = field.signerOrder === activeOrder;
                  const isApproval = normalizeFieldKind(field.kind) === 'approval';
                  return (
                    <Box
                      key={field.id}
                      onPointerDown={(e) => startMove(e, field, page.page)}
                      style={{
                        position: 'absolute',
                        left: `${field.x}%`,
                        top: `${field.y}%`,
                        width: `${field.width}%`,
                        height: `${field.height}%`,
                        border: isActive
                          ? '2px solid var(--mantine-color-blue-6)'
                          : isApproval
                            ? '2px dashed var(--mantine-color-teal-6)'
                            : '2px dashed var(--mantine-color-green-6)',
                        borderRadius: 6,
                        background: 'color-mix(in srgb, var(--app-surface) 88%, transparent)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        cursor: interacting ? 'grabbing' : 'grab',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                        boxSizing: 'border-box',
                        touchAction: 'none',
                      }}
                    >
                      {isApproval ? (
                        <IconCircleCheckFilled
                          size={14}
                          style={{ color: 'var(--mantine-color-teal-6)', flexShrink: 0, pointerEvents: 'none' }}
                        />
                      ) : person?.signatureDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={person.signatureDataUrl}
                          alt=''
                          style={{
                            maxWidth: '92%',
                            maxHeight: '58%',
                            objectFit: 'contain',
                            flexShrink: 0,
                            pointerEvents: 'none',
                          }}
                          draggable={false}
                        />
                      ) : null}
                      <Text
                        size='10px'
                        c='dimmed'
                        ta='center'
                        px={4}
                        fw={600}
                        style={{ lineHeight: 1.2, marginTop: 2, pointerEvents: 'none' }}
                      >
                        {(
                          field.label ||
                          (normalizeFieldKind(field.kind) === 'fingerprint'
                            ? 'Huella'
                            : normalizeFieldKind(field.kind) === 'validation'
                              ? 'Validación'
                              : person?.name) ||
                          'Firmante'
                        ).toUpperCase()}
                      </Text>
                      <Box
                        onPointerDown={(e) => startResize(e, field, page.page)}
                        style={{
                          position: 'absolute',
                          right: 2,
                          bottom: 2,
                          width: 14,
                          height: 14,
                          borderRadius: 2,
                          background: isActive
                            ? 'var(--mantine-color-blue-6)'
                            : 'var(--mantine-color-green-6)',
                          cursor: 'nwse-resize',
                          border: '1px solid #fff',
                          touchAction: 'none',
                        }}
                        title='Redimensionar'
                      />
                    </Box>
                  );
                })}
            </Box>
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
