'use client';

/**
 * Recorrido completo del documento (2026-11-11) para «Ver flujo» de Autorizaciones: del Word a la
 * última firma, con quién va, quién ya aprobó o firmó y cuándo. Solo nombres, estado y fecha
 * (GET /api/integrations/orion/document-flow → lib/orion/documentFlow.ts).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Skeleton, Stack, Text } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconCheck,
  IconCircleDashed,
  IconFileTypeDocx,
  IconFileTypePdf,
  IconHistory,
  IconHourglassHigh,
  IconRosetteDiscountCheck,
  IconRoute,
  IconShieldCheck,
  IconSignature,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import type { DocumentFlow, FlowPersonStatus, FlowStage, FlowStatus } from '@/lib/orion/documentFlow';
import { loadDocumentFlow, peekDocumentFlow } from '@/lib/orion/documentFlowClient';
import s from './documentFlowTimeline.module.css';

const STAGE_ICON: Record<string, ReactNode> = {
  word: <IconFileTypeDocx size={18} />,
  'word-validacion': <IconShieldCheck size={18} />,
  cliente: <IconUsersGroup size={18} />,
  pdf: <IconFileTypePdf size={18} />,
  'pdf-validacion': <IconShieldCheck size={18} />,
  firmas: <IconSignature size={18} />,
  firmado: <IconRosetteDiscountCheck size={18} />,
};

const STATUS_TEXT: Record<FlowStatus, string> = {
  hecho: 'Listo',
  actual: 'En curso',
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
};

function statusIcon(status: FlowPersonStatus, size = 12): ReactNode {
  switch (status) {
    case 'hecho':
      return <IconCheck size={size} />;
    case 'actual':
      return <IconHourglassHigh size={size} />;
    case 'devuelto':
      return <IconArrowBackUp size={size} />;
    case 'rechazado':
      return <IconX size={size} />;
    default:
      return <IconCircleDashed size={size} />;
  }
}

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function Stage({ stage, index, isCurrent }: { stage: FlowStage; index: number; isCurrent: boolean }) {
  const when = formatWhen(stage.at);
  return (
    <li
      className={`${s.stage} ${s[`stage_${stage.status}`]} ${isCurrent ? s.stageCurrent : ''}`}
      style={{ ['--delay' as string]: `${index * 28}ms` }}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <div className={s.rail} aria-hidden>
        <span className={s.node}>{stage.status === 'hecho' ? <IconCheck size={16} stroke={3} /> : STAGE_ICON[stage.key]}</span>
      </div>
      <div className={s.body}>
        <div className={s.card}>
          <div className={s.head}>
            <div className={s.headMain}>
              <span className={s.title}>{stage.title}</span>
              {stage.description ? <p className={s.desc}>{stage.description}</p> : null}
            </div>
            <div className={s.headMeta}>
              <span className={`${s.chip} ${s[`chip_${stage.status}`]}`}>
                {statusIcon(stage.status)}
                {STATUS_TEXT[stage.status]}
              </span>
              {when ? <span className={s.when}>{when}</span> : null}
            </div>
          </div>

          {stage.people.length > 0 ? (
            <ul className={s.people}>
              {stage.people.map((p, i) => (
                <li
                  key={`${p.name}-${i}`}
                  className={`${s.person} ${s[`person_${p.status}`]}`}
                  style={{ ['--person-delay' as string]: `${index * 28 + 60 + i * 24}ms` }}
                >
                  <span className={s.avatar} aria-hidden>
                    {initials(p.name)}
                  </span>
                  <span className={s.personText}>
                    <span className={s.personName}>{p.name}</span>
                    <span className={s.personRole}>
                      {p.role}
                      {p.detail ? ` · ${p.detail}` : ''}
                    </span>
                  </span>
                  <span className={s.personMeta}>
                    <span className={`${s.chip} ${s[`chip_${p.status}`]}`}>
                      {statusIcon(p.status)}
                      {p.statusLabel}
                    </span>
                    {formatWhen(p.at) ? <span className={s.when}>{formatWhen(p.at)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {stage.events.length > 0 ? (
            <div className={s.eventsBlock}>
              <div className={s.eventsTitle}>
                <IconHistory size={13} aria-hidden />
                Historial
              </div>
              <ul className={s.events} aria-label={`Historial de ${stage.title}`}>
                {stage.events.map((e, i) => (
                  <li key={`${e.label}-${i}`} className={s.event}>
                    <span className={s.eventDot} aria-hidden />
                    <span className={s.eventLabel}>
                      {e.label}
                      {e.who ? <span className={s.eventWho}> · {e.who}</span> : null}
                    </span>
                    {formatWhen(e.at) ? <span className={s.when}>{formatWhen(e.at)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function DocumentFlowTimeline({ requestId, fileId }: { requestId: number; fileId: string }) {
  const [flow, setFlow] = useState<DocumentFlow | null>(() => peekDocumentFlow(requestId, fileId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const cached = peekDocumentFlow(requestId, fileId);
    if (cached) {
      setFlow(cached);
      setError(null);
    } else {
      setFlow(null);
      setError(null);
    }
    loadDocumentFlow(requestId, fileId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setFlow(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el recorrido del documento');
      });
    return () => controller.abort();
  }, [requestId, fileId]);

  if (error) {
    return (
      <Alert color='gray' variant='light' icon={<IconAlertCircle size={16} />} title='Recorrido del documento'>
        {error}
      </Alert>
    );
  }

  if (!flow) {
    return (
      <Stack gap='sm' aria-busy className={s.skeleton}>
        <Skeleton height={88} radius={16} />
        <Skeleton height={72} radius={16} />
        <Skeleton height={72} radius={16} />
        <Skeleton height={56} radius={16} />
      </Stack>
    );
  }

  const percent = flow.total ? Math.round((flow.doneCount / flow.total) * 100) : 0;
  const finished = flow.total > 0 && flow.doneCount === flow.total;
  const stepNow = Math.min(flow.doneCount + (finished ? 0 : 1), flow.total);

  return (
    <section className={s.root} aria-label='Recorrido del documento'>
      <header className={`${s.summary} ${finished ? s.summaryDone : ''}`}>
        <span className={s.summaryIcon} aria-hidden>
          {finished ? <IconRosetteDiscountCheck size={22} /> : <IconRoute size={22} />}
        </span>
        <div className={s.summaryBody}>
          <div className={s.summaryTop}>
            <Text size='xs' fw={700} tt='uppercase' className={s.eyebrow}>
              Recorrido del documento
            </Text>
            <span className={s.percent} aria-hidden>
              {percent}%
            </span>
          </div>
          <Text fw={700} size='md' className={s.summaryText}>
            {flow.currentLabel ?? 'Aún no ha empezado'}
          </Text>
          <Text size='xs' c='dimmed' className={s.summaryStep}>
            Paso {stepNow} de {flow.total}
            {finished ? ' · Completo' : ''}
          </Text>
          <div
            className={s.bar}
            role='progressbar'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${flow.doneCount} de ${flow.total} pasos listos`}
          >
            <span className={s.barFill} style={{ width: `${percent}%` }} />
          </div>
        </div>
      </header>

      <ol className={s.list}>
        {flow.stages.map((stage, i) => (
          <Stage key={stage.key} stage={stage} index={i} isCurrent={stage.key === flow.currentStageKey} />
        ))}
      </ol>
    </section>
  );
}
