'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Button, Group, Stack, Alert, SimpleGrid, Badge, Text, Divider, Loader, Center, TextInput,
} from '@mantine/core';
import {
  DETAIL_FIELDS,
  stateLabel,
  stateColor,
  type PurchaseColumn,
  type PurchaseTipo,
} from '../../../../lib/purchases/fields';

export interface PurchaseDraft {
  companyId: number;
  companyName: string;
  DocEntry?: number;
  DocNum?: number;
  CardName?: string;
  U_SEND_State?: string;
  DocTotal?: number;
  DocCurrency?: string;
  [key: string]: unknown;
}

interface Props {
  draft: PurchaseDraft | null;
  tipo: PurchaseTipo;
  onClose: () => void;
}

/**
 * Regla de contraste (misma que Articulos): Mantine pinta los inputs
 * deshabilitados en gris muy claro (baja legibilidad). Para los campos
 * bloqueados forzamos un color de texto legible (ink-2 GSS #38445a) sobre fondo
 * gris suave.
 */
const LOCKED_FIELD_STYLES = {
  input: {
    color: '#38445a',
    opacity: 1,
    WebkitTextFillColor: '#38445a',
    backgroundColor: '#f1f3f5',
  },
} as const;

/** Da formato legible a un valor escalar de cabecera segun su tipo. */
function formatValue(col: PurchaseColumn, raw: unknown): string {
  if (raw == null || raw === '') return '';
  const value = String(raw);

  if (col.type === 'state') return stateLabel(value);

  if (col.type === 'date') {
    const iso = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(value);
    if (iso) return iso[1];
    return value;
  }

  if (col.type === 'currency') {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n.toLocaleString('es-CO');
    return value;
  }

  return value;
}

export default function DetailModal({ draft, tipo, onClose }: Props) {
  const [fullItem, setFullItem] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) {
      setFullItem(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    const docEntry = draft.DocEntry;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/purchases/item?companyId=${draft.companyId}&docEntry=${docEntry}`
        );
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) setLoadError(data.error || 'No se pudo cargar el detalle del documento');
          return;
        }
        if (!cancelled) setFullItem(data.item ?? {});
      } catch {
        if (!cancelled) setLoadError('Error de red al cargar el detalle del documento');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [draft]);

  const titulo = tipo === 'ordenes' ? 'Detalle de orden de compra' : 'Detalle de solicitud de compra';

  return (
    <Modal opened={!!draft} onClose={onClose} title={titulo} size="lg">
      {draft && (
        <Stack gap="sm">
          <Group gap="xs">
            <Text size="sm" fw={500}>Empresa:</Text>
            <Badge variant="light">{draft.companyName}</Badge>
            {draft.DocNum != null && (
              <Badge variant="outline" color="gray">N.o {String(draft.DocNum)}</Badge>
            )}
            {fullItem && (
              <Badge variant="light" color={stateColor(fullItem.U_SEND_State)}>
                {stateLabel(fullItem.U_SEND_State)}
              </Badge>
            )}
          </Group>

          {loading && (
            <Center py="lg">
              <Loader />
            </Center>
          )}

          {!loading && loadError && <Alert color="red">{loadError}</Alert>}

          {!loading && !loadError && fullItem && (
            <>
              <Divider label="Datos del documento" labelPosition="left" />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {DETAIL_FIELDS.map((col) => (
                  <TextInput
                    key={col.field}
                    label={col.label}
                    value={formatValue(col, fullItem[col.field])}
                    readOnly
                    disabled
                    styles={LOCKED_FIELD_STYLES}
                  />
                ))}
              </SimpleGrid>

              <Text size="xs" c="dimmed" mt="xs">
                Las lineas del documento (articulos, cantidades y precios) no se muestran en esta
                version de solo lectura.
              </Text>
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Cerrar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
