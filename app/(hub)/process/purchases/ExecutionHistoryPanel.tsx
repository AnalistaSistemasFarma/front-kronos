'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Code, Collapse, Group, Loader, Stack, Text, Timeline, UnstyledButton } from '@mantine/core';
import type { TimelineEvent } from '../../../../lib/workflow-sap/history';

/**
 * Historial de ejecucion de una solicitud: la corriente completa del proceso,
 * con cada paso humano, cada ejecucion en SAP, reintentos y cambios externos.
 * Cada ejecucion SAP se puede desplegar para ver que se envio y que respondio SAP.
 */

const STATUS: Record<TimelineEvent['status'], { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: 'yellow' },
  running: { label: 'En curso', color: 'blue' },
  ok: { label: 'Completada', color: 'green' },
  rejected: { label: 'Rechazada', color: 'red' },
  error: { label: 'Error', color: 'red' },
  skipped: { label: 'Omitida', color: 'gray' },
  cancelled: { label: 'Cancelada', color: 'gray' },
};

const time = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const duration = (ms: number | null) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export default function ExecutionHistoryPanel({ requestId }: { requestId: string | number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflow-sap/history?requestId=${requestId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar el historial');
        if (!cancelled) setEvents(d.events ?? []);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!events) return <Loader size="sm" />;
  if (events.length === 0) return <Text size="sm" c="dimmed">Aún no hay pasos registrados.</Text>;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Historial de ejecución
      </Text>
      <Timeline bulletSize={14} lineWidth={2} active={events.length}>
        {events.map((e, i) => {
          const s = STATUS[e.status];
          const hasDetail = Boolean(e.request || e.response || e.error);
          return (
            <Timeline.Item
              key={`${e.at}-${i}`}
              color={s.color}
              title={
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {e.title}
                  </Text>
                  <Badge size="xs" color={s.color} variant="light">
                    {s.label}
                  </Badge>
                </Group>
              }
            >
              <Text size="xs" c="dimmed">
                {time(e.at)}
                {e.by ? ` · ${e.by}` : ''}
                {e.durationMs != null ? ` · ${duration(e.durationMs)}` : ''}
                {e.detail ? ` · ${e.detail}` : ''}
              </Text>
              {e.error && (
                <Text size="xs" c="red">
                  {e.error}
                </Text>
              )}
              {hasDetail && (
                <>
                  <UnstyledButton onClick={() => setOpen((o) => (o === i ? null : i))}>
                    <Text size="xs" c="blue">
                      {open === i ? 'Ocultar detalle' : 'Ver qué se envió y qué respondió SAP'}
                    </Text>
                  </UnstyledButton>
                  <Collapse in={open === i}>
                    {e.request && <Code block>{`Enviado: ${e.request}`}</Code>}
                    {e.response && <Code block mt={4}>{`Respuesta: ${e.response}`}</Code>}
                  </Collapse>
                </>
              )}
            </Timeline.Item>
          );
        })}
      </Timeline>
    </Stack>
  );
}
