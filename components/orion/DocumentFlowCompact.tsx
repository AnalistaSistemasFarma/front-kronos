'use client';

/**
 * Recorrido del documento en versión corta (2026-11-13) para el final del «Ver detalle» de
 * Autorizaciones: los mismos datos que «Ver flujo» (DocumentFlowTimeline), con pasos numerados
 * que entran en orden y una línea que se rellena hacia abajo (respeta reducir movimiento),
 * una línea por paso y las personas en texto corto, para leerlo de un vistazo.
 * Comparte la caché de lib/orion/documentFlowClient (si ya se abrió «Ver flujo», sale al toque).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Alert, Badge, Card, Group, Progress, Skeleton, Text } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconCheck,
  IconCircleDashed,
  IconHourglassHigh,
  IconRoute,
  IconX,
} from '@tabler/icons-react';
import type { DocumentFlow, FlowPersonStatus } from '@/lib/orion/documentFlow';
import { loadDocumentFlow, peekDocumentFlow } from '@/lib/orion/documentFlowClient';
import classes from './documentFlowCompact.module.css';

const STATUS_COLOR: Record<FlowPersonStatus, string> = {
  hecho: 'green',
  actual: 'blue',
  pendiente: 'gray',
  devuelto: 'orange',
  rechazado: 'red',
};

const STATUS_TEXT: Record<FlowPersonStatus, string> = {
  hecho: 'Listo',
  actual: 'En curso',
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
  rechazado: 'Rechazado',
};

function StatusIcon({ status }: { status: FlowPersonStatus }) {
  switch (status) {
    case 'hecho':
      return <IconCheck size={10} stroke={3.5} />;
    case 'actual':
      return <IconHourglassHigh size={10} stroke={2.5} />;
    case 'devuelto':
      return <IconArrowBackUp size={10} stroke={2.5} />;
    case 'rechazado':
      return <IconX size={10} stroke={3} />;
    default:
      return <IconCircleDashed size={10} stroke={2.5} />;
  }
}

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DocumentFlowCompact({
  requestId,
  fileId,
}: {
  requestId: number;
  fileId: string;
}) {
  const [flow, setFlow] = useState<DocumentFlow | null>(() => peekDocumentFlow(requestId, fileId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFlow(peekDocumentFlow(requestId, fileId));
    setError(null);
    loadDocumentFlow(requestId, fileId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setFlow(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setError(err instanceof Error ? err.message : 'No se pudo cargar el recorrido del documento');
      });
    return () => controller.abort();
  }, [requestId, fileId]);

  const header = (
    <Group gap={6} mb='xs' wrap='nowrap'>
      <IconRoute size={18} className='text-gray-500' aria-hidden />
      <Text fw={600}>Recorrido del documento</Text>
    </Group>
  );

  if (error) {
    return (
      <div>
        {header}
        <Alert color='gray' variant='light' icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      </div>
    );
  }

  if (!flow) {
    return (
      <div aria-busy aria-label='Cargando recorrido del documento'>
        {header}
        <Skeleton height={120} radius='md' />
      </div>
    );
  }

  const percent = flow.total ? Math.round((flow.doneCount / flow.total) * 100) : 0;
  const finished = flow.total > 0 && flow.doneCount === flow.total;
  const stepNow = Math.min(flow.doneCount + (finished ? 0 : 1), flow.total);

  return (
    <section aria-label='Recorrido del documento'>
      {header}
      <Card withBorder radius='md' p='sm'>
        <Group justify='space-between' wrap='nowrap' gap='xs'>
          <Text size='sm' fw={600} style={{ minWidth: 0 }}>
            {finished ? 'Documento firmado' : (flow.currentLabel ?? 'Aún no ha empezado')}
          </Text>
          <Badge variant='light' color={finished ? 'green' : 'blue'} style={{ flexShrink: 0 }}>
            {finished ? 'Completo' : `Paso ${stepNow} de ${flow.total}`}
          </Badge>
        </Group>
        <Progress
          value={percent}
          color={finished ? 'green' : 'blue'}
          size='sm'
          radius='xl'
          mt={8}
          transitionDuration={0}
          aria-label={`${flow.doneCount} de ${flow.total} pasos listos`}
        />

        <ol className={classes.steps} style={{ marginTop: 'var(--mantine-spacing-sm)' }}>
          {flow.stages.map((stage, index) => {
            const current = stage.key === flow.currentStageKey;
            const when = formatWhen(stage.at);
            return (
              <li
                key={stage.key}
                className={classes.step}
                style={{ '--i': index } as CSSProperties}
                aria-current={current ? 'step' : undefined}
              >
                {stage.status === 'hecho' && index < flow.stages.length - 1 ? (
                  <span className={classes.rail} aria-hidden />
                ) : null}
                {stage.status === 'actual' && index < flow.stages.length - 1 ? (
                  <span className={classes.railNext} aria-hidden />
                ) : null}
                <span
                  className={classes.dot}
                  data-status={stage.status}
                  aria-label={`Paso ${index + 1}: ${STATUS_TEXT[stage.status]}`}
                >
                  {index + 1}
                  <span className={classes.badge} aria-hidden>
                    <StatusIcon status={stage.status} />
                  </span>
                </span>
                <div className={classes.body}>
                  <Group justify='space-between' gap='xs' wrap='nowrap'>
                    <Text
                      size='sm'
                      fw={current ? 700 : 500}
                      c={stage.status === 'pendiente' ? 'dimmed' : undefined}
                    >
                      {stage.title}
                    </Text>
                    {when ? (
                      <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                        {when}
                      </Text>
                    ) : null}
                  </Group>
                  {stage.people.length > 0 ? (
                    <Text size='xs' c='dimmed' mt={2}>
                      {stage.people.map((p, i) => (
                        <span key={`${p.name}-${i}`}>
                          {i > 0 ? ' · ' : ''}
                          {p.name}{' '}
                          <Text span size='xs' fw={600} c={STATUS_COLOR[p.status]}>
                            ({p.statusLabel})
                          </Text>
                        </span>
                      ))}
                    </Text>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
