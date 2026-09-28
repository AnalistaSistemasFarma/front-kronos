'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Timeline,
} from '@mantine/core';
import { IconGitBranch, IconPointFilled } from '@tabler/icons-react';
import type { OrionTimeline } from '../../lib/orion/client';
import { orionDocumentEventLabel } from '../../lib/orion/documentEventTypes';

type Props = {
  opened: boolean;
  onClose: () => void;
  orionDocumentId?: string | null;
  requestId?: number | null;
  fileId?: string | null;
  title?: string | null;
};

const EVENT_COLOR: Record<string, string> = {
  FIRMADO: 'green',
  FIRMA_REGISTRADA: 'blue',
  RECHAZADO: 'red',
  VALIDACION_DEVUELTA: 'orange',
  DEVUELTO_POR_FIRMANTE: 'orange',
  DEVUELTO: 'orange',
  VALIDACION_APROBADA: 'teal',
  APROBADO_PARA_FIRMA: 'teal',
  NUEVA_SUBVERSION: 'violet',
};

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
}

export default function OrionTraceTimelineModal({
  opened,
  onClose,
  orionDocumentId,
  requestId,
  fileId,
  title,
}: Props) {
  const [timeline, setTimeline] = useState<OrionTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    const qs = new URLSearchParams();
    if (requestId && fileId) {
      qs.set('requestId', String(requestId));
      qs.set('fileId', fileId);
    } else if (orionDocumentId) {
      qs.set('orionDocumentId', orionDocumentId);
    } else {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTimeline(null);
    fetch(`/api/integrations/orion/trace/timeline?${qs.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la hoja de vida');
        if (!cancelled) setTimeline(data as OrionTimeline);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, orionDocumentId, requestId, fileId]);

  const events = [...(timeline?.events ?? [])].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );
  const versions = timeline?.versions ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size={640}
      radius='lg'
      title={
        <Stack gap={2}>
          <Text fw={800}>Hoja de vida completa</Text>
          <Text size='sm' c='dimmed' lineClamp={1}>
            {title || 'Documento'}
          </Text>
        </Stack>
      }
    >
      {loading ? (
        <Group justify='center' py='lg'>
          <Loader size='sm' />
        </Group>
      ) : error ? (
        <Alert color='red' variant='light'>
          {error}
        </Alert>
      ) : !timeline ? null : (
        <Stack gap='md'>
          {versions.length > 0 ? (
            <Stack gap={6}>
              <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                Versiones
              </Text>
              {versions.map((v) => (
                <Paper key={v.orionDocumentId} withBorder radius='md' p='xs'>
                  <Group justify='space-between' wrap='nowrap' gap='xs'>
                    <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                      <IconGitBranch size={14} />
                      <Badge size='sm' variant='light' color='violet'>
                        {v.versionLabel || 'v1.0'}
                      </Badge>
                      <Text size='sm' lineClamp={1}>
                        {v.title || 'Documento'}
                      </Text>
                      {v.deleted ? (
                        <Badge size='xs' color='gray' variant='outline'>
                          Eliminada
                        </Badge>
                      ) : null}
                    </Group>
                    <Group gap={6} wrap='nowrap'>
                      <Badge size='sm' variant='outline'>
                        {v.statusLabel || v.status || '—'}
                      </Badge>
                      <Text size='xs' c='dimmed'>
                        {formatDateTime(v.createdAt)}
                      </Text>
                    </Group>
                  </Group>
                </Paper>
              ))}
              <Divider my={4} />
            </Stack>
          ) : null}

          {events.length === 0 ? (
            <Text size='sm' c='dimmed' py='md'>
              Aún no hay eventos registrados para este documento.
            </Text>
          ) : (
            <Timeline active={events.length - 1} bulletSize={20} lineWidth={2}>
              {events.map((event) => (
                <Timeline.Item
                  key={event.id}
                  bullet={<IconPointFilled size={12} />}
                  color={EVENT_COLOR[event.type] ?? 'gray'}
                  title={
                    <Group gap={6} wrap='wrap'>
                      <Text size='sm' fw={700}>
                        {event.label || orionDocumentEventLabel(event.type)}
                      </Text>
                      {event.versionLabel ? (
                        <Badge size='xs' variant='outline' color='gray'>
                          {event.versionLabel}
                        </Badge>
                      ) : null}
                      {event.source ? (
                        <Badge
                          size='xs'
                          variant='light'
                          color={event.source === 'ORION' ? 'indigo' : 'cyan'}
                        >
                          {event.source === 'ORION' ? 'GSS Firma' : 'SynerLink'}
                        </Badge>
                      ) : null}
                    </Group>
                  }
                >
                  {event.actorName || event.actorEmail ? (
                    <Text size='xs' c='dimmed'>
                      {[event.actorName, event.actorEmail].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {event.detail ? (
                    <Text size='xs' mt={2}>
                      {event.detail}
                    </Text>
                  ) : null}
                  <Text size='xs' c='dimmed' mt={2}>
                    {formatDateTime(event.occurredAt)}
                    {event.ipAddress ? ` · IP ${event.ipAddress}` : ''}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </Stack>
      )}
    </Modal>
  );
}
