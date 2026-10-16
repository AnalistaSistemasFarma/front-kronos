'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Divider, Group, Loader, Modal, Stack, Text, Timeline } from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconClock,
  IconFileUpload,
  IconGitBranch,
  IconSend,
  IconSignature,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import {
  orionDocumentEventLabel,
  type OrionDocumentEvent,
} from '../../lib/orion/documentEventTypes';
import { isSignerCompleted, orderedSigners } from '../../lib/orion/signerStatus';
import type { OrionSignatureState } from '../../lib/orion/types';

type Props = {
  opened: boolean;
  onClose: () => void;
  requestId: number;
  fileId: string;
  fileName?: string | null;
  versionLabel?: string | null;
  /** Estado actual del documento: pinta el flujo validadores → firmantes. */
  state?: OrionSignatureState | null;
};

type FlowStep = {
  key: string;
  title: string;
  subtitle?: string | null;
  when?: string | null;
  note?: string | null;
  tone: 'done' | 'current' | 'pending' | 'returned' | 'rejected';
};

const TONE: Record<FlowStep['tone'], { color: string; icon: ReactNode; label: string }> = {
  done: { color: 'teal', icon: <IconCheck size={12} />, label: 'Listo' },
  current: { color: 'blue', icon: <IconClock size={12} />, label: 'En turno' },
  pending: { color: 'gray', icon: <IconClock size={12} />, label: 'Pendiente' },
  returned: { color: 'orange', icon: <IconArrowBackUp size={12} />, label: 'Devuelto' },
  rejected: { color: 'red', icon: <IconX size={12} />, label: 'Rechazado' },
};

function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('es-CO');
}

function validatorSteps(state: OrionSignatureState): FlowStep[] {
  const review = state.review;
  if (!review || review.approvals.length === 0) return [];
  const approvals = [...review.approvals].sort((a, b) => a.order - b.order);
  const firstPending = approvals.find((a) => a.decision === 'PENDIENTE');
  return approvals.map((a) => ({
    key: `v-${a.order}`,
    title: `${a.order}. ${a.name || a.email}`,
    subtitle: a.email,
    when: formatWhen(a.decidedAt),
    note: a.comment,
    tone:
      a.decision === 'APROBADO'
        ? 'done'
        : a.decision === 'DEVUELTO'
          ? 'returned'
          : review.status === 'EN_VALIDACION' && firstPending?.order === a.order
            ? 'current'
            : 'pending',
  }));
}

function signerSteps(state: OrionSignatureState): FlowStep[] {
  const signers = orderedSigners(state.signers);
  const sent = ['PENDIENTE_FIRMA', 'EN_PROCESO', 'FIRMADO'].includes(
    String(state.status || '').toUpperCase()
  );
  const firstPending = signers.find(
    (s) => !isSignerCompleted(s.status) && !/RECHAZ|DEVUEL/i.test(String(s.status || ''))
  );
  return signers.map((s, index) => {
    const status = String(s.status || '').toUpperCase();
    const tone: FlowStep['tone'] = isSignerCompleted(status)
      ? 'done'
      : /RECHAZ/.test(status)
        ? 'rejected'
        : /DEVUEL/.test(status)
          ? 'returned'
          : sent && firstPending === s
            ? 'current'
            : 'pending';
    return {
      key: `s-${s.order ?? index + 1}-${s.email}`,
      title: `${s.order ?? index + 1}. ${s.name || s.email}`,
      subtitle: s.email,
      when: formatWhen(s.signedAt),
      tone,
    };
  });
}

function FlowSection({ title, steps }: { title: string; steps: FlowStep[] }) {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.tone === 'done').length;
  return (
    <Stack gap={8}>
      <Group justify='space-between'>
        <Text size='xs' fw={700} c='dimmed' tt='uppercase' style={{ letterSpacing: '0.04em' }}>
          {title}
        </Text>
        <Badge size='xs' variant='light' color={done === steps.length ? 'teal' : 'gray'}>
          {done}/{steps.length}
        </Badge>
      </Group>
      <Timeline
        active={steps.reduce((last, s, i) => (s.tone === 'done' ? i : last), -1)}
        bulletSize={20}
        lineWidth={2}
      >
        {steps.map((step) => {
          const tone = TONE[step.tone];
          return (
            <Timeline.Item
              key={step.key}
              bullet={tone.icon}
              color={tone.color}
              title={
                <Group gap={6} wrap='nowrap'>
                  <Text size='sm' fw={700} lineClamp={1}>
                    {step.title}
                  </Text>
                  <Badge size='xs' variant='light' color={tone.color}>
                    {tone.label}
                  </Badge>
                </Group>
              }
            >
              {step.subtitle ? (
                <Text size='xs' c='dimmed'>
                  {step.subtitle}
                </Text>
              ) : null}
              {step.note ? (
                <Text size='xs' mt={2}>
                  {step.note}
                </Text>
              ) : null}
              {step.when ? (
                <Text size='xs' c='dimmed' mt={2}>
                  {step.when}
                </Text>
              ) : null}
            </Timeline.Item>
          );
        })}
      </Timeline>
    </Stack>
  );
}

function eventVisual(type: string): { icon: ReactNode; color: string } {
  switch (type) {
    case 'DOCUMENTO_CARGADO':
      return { icon: <IconFileUpload size={12} />, color: 'gray' };
    case 'NUEVA_SUBVERSION':
      return { icon: <IconGitBranch size={12} />, color: 'violet' };
    case 'ENVIADO_VALIDACION':
    case 'ENVIADO_A_FIRMA':
      return { icon: <IconSend size={12} />, color: 'blue' };
    case 'VALIDACION_APROBADA':
    case 'APROBADO_PARA_FIRMA':
      return { icon: <IconCheck size={12} />, color: 'teal' };
    case 'VALIDACION_DEVUELTA':
    case 'DEVUELTO_POR_FIRMANTE':
      return { icon: <IconArrowBackUp size={12} />, color: 'orange' };
    case 'FIRMANTES_ASIGNADOS':
      return { icon: <IconUsers size={12} />, color: 'indigo' };
    case 'FIRMA_REGISTRADA':
      return { icon: <IconSignature size={12} />, color: 'blue' };
    case 'FIRMADO':
      return { icon: <IconCheck size={12} />, color: 'green' };
    case 'RECHAZADO':
      return { icon: <IconX size={12} />, color: 'red' };
    default:
      return { icon: <IconCheck size={12} />, color: 'gray' };
  }
}

export default function OrionDocumentLifecycleModal({
  opened,
  onClose,
  requestId,
  fileId,
  fileName,
  versionLabel,
  state = null,
}: Props) {
  const validators = state ? validatorSteps(state) : [];
  const signers = state ? signerSteps(state) : [];
  const hasFlow = validators.length > 0 || signers.length > 0;
  const [events, setEvents] = useState<OrionDocumentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ requestId: String(requestId), fileId });
    fetch(`/api/integrations/orion/document-events?${qs.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la hoja de vida');
        if (!cancelled) setEvents(Array.isArray(data.events) ? data.events : []);
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
  }, [opened, requestId, fileId]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size={560}
      radius='lg'
      title={
        <Stack gap={2}>
          <Text fw={800}>{hasFlow ? 'Flujo del documento' : 'Hoja de vida del documento'}</Text>
          <Group gap={6}>
            <Text size='sm' c='dimmed' lineClamp={1}>
              {fileName || 'Documento'}
            </Text>
            {versionLabel ? (
              <Badge size='sm' variant='light' color='violet'>
                {versionLabel}
              </Badge>
            ) : null}
          </Group>
        </Stack>
      }
    >
      {hasFlow ? (
        <Stack gap='md' mb='md'>
          <FlowSection
            title={`Validación${state?.review?.round && state.review.round > 1 ? ` · ronda ${state.review.round}` : ''}`}
            steps={validators}
          />
          <FlowSection title='Firma' steps={signers} />
          <Divider label='Historial' labelPosition='left' />
        </Stack>
      ) : null}
      {loading ? (
        <Group justify='center' py='lg'>
          <Loader size='sm' />
        </Group>
      ) : error ? (
        <Alert color='red' variant='light'>
          {error}
        </Alert>
      ) : events.length === 0 ? (
        <Text size='sm' c='dimmed' py='md'>
          Aún no hay eventos registrados para este documento.
        </Text>
      ) : (
        <Timeline active={events.length - 1} bulletSize={22} lineWidth={2}>
          {events.map((event) => {
            const visual = eventVisual(event.eventType);
            return (
              <Timeline.Item
                key={event.id}
                bullet={visual.icon}
                color={visual.color}
                title={
                  <Group gap={6} wrap='nowrap'>
                    <Text size='sm' fw={700}>
                      {orionDocumentEventLabel(event.eventType)}
                    </Text>
                    {event.versionLabel ? (
                      <Badge size='xs' variant='outline' color='gray'>
                        {event.versionLabel}
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
                  {new Date(event.createdAt).toLocaleString('es-CO')}
                </Text>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Modal>
  );
}
