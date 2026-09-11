'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import {
  clampFieldSize,
  createFieldId,
  DEFAULT_FIELD_HEIGHT,
  DEFAULT_FIELD_WIDTH,
  MAX_FIELD_HEIGHT,
  MAX_FIELD_WIDTH,
  MIN_FIELD_HEIGHT,
  MIN_FIELD_WIDTH,
  pctFromClientPoint,
  type SignatureFieldPlacement,
} from '../../lib/orion/signatureFields';
import type { OrionParticipant } from '../../lib/orion/participants';
import { usePdfPageImages } from './usePdfPageImages';

type Props = {
  pdfSrc: string | null;
  documentId: string;
  participants: OrionParticipant[];
  activeOrder: number;
  fields: SignatureFieldPlacement[];
  onChange: (fields: SignatureFieldPlacement[]) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
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

export default function SignaturePlacementCanvas({
  pdfSrc,
  documentId,
  participants,
  activeOrder,
  fields,
  onChange,
}: Props) {
  const { pages, loading, error } = usePdfPageImages(pdfSrc);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const imgRefs = useRef<Record<number, HTMLImageElement | null>>({});
  const fieldsRef = useRef(fields);
  const onChangeRef = useRef(onChange);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [, setInteractionTick] = useState(0);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const activePerson = participants.find((p) => p.order === activeOrder);

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
      const existing = currentFields.find((f) => f.signerOrder === activeOrder);
      const width = clamp(existing?.width ?? DEFAULT_FIELD_WIDTH, MIN_FIELD_WIDTH, MAX_FIELD_WIDTH);
      const height = clamp(
        existing?.height ?? DEFAULT_FIELD_HEIGHT,
        MIN_FIELD_HEIGHT,
        MAX_FIELD_HEIGHT
      );
      const x = clamp(xPct - width / 2, 0, 100 - width);
      const y = clamp(yPct - height / 2, 0, 100 - height);

      if (existing) {
        onChangeRef.current(
          currentFields.map((f) =>
            f.id === existing.id
              ? clampFieldSize({ ...f, page, x, y, label: signer?.name || f.label })
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
          label: signer?.name || `Firma ${activeOrder}`,
        }),
      ]);
    },
    [activeOrder, documentId, participants]
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

      const width = clamp(pct.x - field.x, MIN_FIELD_WIDTH, MAX_FIELD_WIDTH);
      const height = clamp(pct.y - field.y, MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT);
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
          Ubique la firma de {activePerson?.name ?? 'firmante'}
        </Text>
        <Text size='xs' c='dimmed' mt={4}>
          Clic para colocar · arrastre para mover · esquina inferior para redimensionar (
          {MIN_FIELD_WIDTH}–{MAX_FIELD_WIDTH}% × {MIN_FIELD_HEIGHT}–{MAX_FIELD_HEIGHT}%).
        </Text>
      </Box>
      <ScrollArea
        style={{ flex: 1, minHeight: 0 }}
        h='100%'
        offsetScrollbars
        type='scroll'
        scrollbarSize={10}
        styles={{
          viewport: { paddingBottom: 16 },
        }}
      >
        <Stack gap='lg' p='md' align='center' pb='xl'>
          {pages.map((page) => (
            <Box
              key={page.page}
              ref={(el) => {
                pageRefs.current[page.page] = el;
              }}
              onClick={(e) => handlePageClick(page.page, e)}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 720,
                cursor: interacting ? 'grabbing' : 'crosshair',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                borderRadius: 4,
                overflow: 'hidden',
                background: '#fff',
                userSelect: 'none',
                touchAction: 'none',
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
                      {person?.signatureDataUrl ? (
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
                        {(person?.name || field.label || 'Firmante').toUpperCase()}
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
