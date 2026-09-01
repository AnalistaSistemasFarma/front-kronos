'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
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
  const [drag, setDrag] = useState<{
    fieldId: string;
    page: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const activePerson = participants.find((p) => p.order === activeOrder);

  function clientToPct(page: number, clientX: number, clientY: number) {
    const el = pageRefs.current[page];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }

  function placeAt(page: number, xPct: number, yPct: number) {
    const signer = participants.find((p) => p.order === activeOrder);
    const existing = fields.find((f) => f.signerOrder === activeOrder);
    const width = clamp(existing?.width ?? DEFAULT_FIELD_WIDTH, MIN_FIELD_WIDTH, MAX_FIELD_WIDTH);
    const height = clamp(existing?.height ?? DEFAULT_FIELD_HEIGHT, MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT);
    const x = clamp(xPct - width / 2, 0, 100 - width);
    const y = clamp(yPct - height / 2, 0, 100 - height);

    if (existing) {
      onChange(
        fields.map((f) =>
          f.id === existing.id
            ? clampFieldSize({ ...f, page, x, y, label: signer?.name || f.label })
            : f
        )
      );
      return;
    }

    onChange([
      ...fields,
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
  }

  function handlePageClick(page: number, e: MouseEvent<HTMLDivElement>) {
    if (drag) return;
    const pct = clientToPct(page, e.clientX, e.clientY);
    if (!pct) return;
    placeAt(page, pct.x, pct.y);
  }

  useEffect(() => {
    if (!drag) return;
    const activeDrag = drag;

    function onMove(e: globalThis.MouseEvent) {
      const pct = clientToPct(activeDrag.page, e.clientX, e.clientY);
      if (!pct) return;
      const field = fields.find((f) => f.id === activeDrag.fieldId);
      if (!field) return;
      const width = field.width;
      const height = field.height;
      const x = clamp(pct.x - activeDrag.offsetX, 0, 100 - width);
      const y = clamp(pct.y - activeDrag.offsetY, 0, 100 - height);
      onChange(
        fields.map((f) => (f.id === activeDrag.fieldId ? clampFieldSize({ ...f, x, y }) : f))
      );
    }

    function onUp() {
      setDrag(null);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, fields, onChange]);

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
          Haga clic en el documento para colocar el campo. Arrastre para ajustar la posición.
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
                cursor: 'crosshair',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                borderRadius: 4,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.dataUrl}
                alt={`Página ${page.page}`}
                style={{ display: 'block', width: '100%', height: 'auto' }}
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
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const pct = clientToPct(page.page, e.clientX, e.clientY);
                        if (!pct) return;
                        setDrag({
                          fieldId: field.id,
                          page: page.page,
                          offsetX: pct.x - field.x,
                          offsetY: pct.y - field.y,
                        });
                      }}
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
                        background: 'color-mix(in srgb, var(--app-surface) 92%, transparent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        cursor: 'move',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                      }}
                    >
                      {person?.signatureDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={person.signatureDataUrl}
                          alt=''
                          style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }}
                          draggable={false}
                        />
                      ) : (
                        <Text size='xs' c='dimmed' ta='center' px={4} fw={500}>
                          {field.label || person?.name}
                        </Text>
                      )}
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
