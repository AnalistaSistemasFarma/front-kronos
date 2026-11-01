'use client';

import {
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Tooltip,
} from '@mantine/core';
import {
  IconCalendarEvent,
  IconCash,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconChevronUp,
  IconDatabase,
  IconFileSearch,
  IconFileText,
  IconFlag,
  IconMessage,
  IconSchool,
  IconSend,
  IconShieldCheck,
  IconShoppingCart,
  IconSignature,
  IconTool,
  IconTruck,
  IconUpload,
  IconUsers,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { FlowStep, RequestFlow } from '@/lib/requests-general/flowProgress';
import { flowStepKind, type FlowStepKind } from '@/lib/requests-general/flowStepKind';
import { RequestProgressBar } from './RequestProgressBar';
import styles from './requestFlow.module.css';

/** Flujos ya consultados en esta pestaña (se refrescan al volver a pedir). */
const flowCache = new Map<number, RequestFlow>();
const CHUNK = 200;

async function fetchFlows(ids: number[]): Promise<Record<number, RequestFlow>> {
  const out: Record<number, RequestFlow> = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await fetch(`/api/requests-general/flow-progress?ids=${chunk.join(',')}`);
    if (!res.ok) throw new Error('No se pudo cargar el avance');
    const data = (await res.json()) as { flows?: Record<string, RequestFlow> };
    for (const [id, flow] of Object.entries(data.flows ?? {})) {
      out[Number(id)] = flow;
      flowCache.set(Number(id), flow);
    }
  }
  return out;
}

/** Flujo de varias solicitudes (listados). Muestra lo que ya tenía mientras actualiza. */
export function useRequestFlows(ids: number[]): { flows: Record<number, RequestFlow>; loaded: boolean } {
  const key = useMemo(() => Array.from(new Set(ids.filter((n) => n > 0))).sort((a, b) => a - b).join(','), [ids]);
  const [flows, setFlows] = useState<Record<number, RequestFlow>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const list = key ? key.split(',').map(Number) : [];
    if (list.length === 0) {
      setFlows({});
      setLoaded(true);
      return;
    }
    const cached: Record<number, RequestFlow> = {};
    for (const id of list) {
      const hit = flowCache.get(id);
      if (hit) cached[id] = hit;
    }
    setFlows(cached);
    setLoaded(false);
    let cancelled = false;
    fetchFlows(list)
      .then((fresh) => {
        if (!cancelled) setFlows(fresh);
      })
      .catch(() => {
        /* sin avance: el listado sigue funcionando */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { flows, loaded };
}

/** Barra de avance + en qué paso va ("Paso 2 de 5 · Revisión jurídica"). */
export function RequestFlowBar({ flow }: { flow: RequestFlow | null | undefined }) {
  if (!flow || flow.total === 0) return null;
  const finished = flow.done >= flow.total;
  return (
    <Stack gap={2}>
      <RequestProgressBar done={flow.done} total={flow.total} percent={flow.percent} />
      <Text size='xs' c={finished ? 'teal.7' : 'dimmed'} lineClamp={1} style={{ overflowWrap: 'anywhere' }}>
        {finished
          ? 'Flujo completo'
          : flow.currentIndex
            ? `Paso ${flow.currentIndex} de ${flow.total} · ${flow.currentName}`
            : null}
      </Text>
    </Stack>
  );
}

const STEP_META: Record<FlowStep['status'], { color: string; label: string }> = {
  done: { color: 'teal', label: 'Resuelta' },
  current: { color: 'blue', label: 'En curso' },
  pending: { color: 'gray', label: 'Por hacer' },
  cancelled: { color: 'gray', label: 'Cancelada' },
};

/** Secuencia completa: qué se hizo, en qué va y qué falta. */
export function RequestFlowSteps({ flow, highlightTask }: { flow: RequestFlow; highlightTask?: string | null }) {
  const active = flow.steps.reduce((last, s, i) => (s.status === 'done' || s.status === 'current' ? i : last), -1);
  const mine = String(highlightTask || '').trim().toLowerCase();
  return (
    <Timeline active={active} bulletSize={24} lineWidth={2} color='teal'>
      {flow.steps.map((step) => {
        const meta = STEP_META[step.status];
        const isMine = Boolean(mine) && step.name.trim().toLowerCase() === mine;
        return (
          <Timeline.Item
            key={step.key}
            bullet={
              <ThemeIcon size={24} radius='xl' color={meta.color} variant={step.status === 'pending' ? 'light' : 'filled'}>
                {(() => {
                  const Icon = KIND_ICON[flowStepKind(step.name)];
                  return <Icon size={13} stroke={2.2} />;
                })()}
              </ThemeIcon>
            }
            title={
              <Group gap={6} wrap='wrap'>
                <Text
                  size='sm'
                  fw={step.status === 'current' || isMine ? 700 : 500}
                  td={step.status === 'cancelled' ? 'line-through' : undefined}
                  c={step.status === 'pending' || step.status === 'cancelled' ? 'dimmed' : undefined}
                >
                  {step.name}
                </Text>
                <Badge size='xs' variant='light' color={meta.color}>
                  {meta.label}
                  {step.totalCount > 1 ? ` · ${step.doneCount}/${step.totalCount}` : ''}
                </Badge>
                {isMine ? (
                  <Badge size='xs' variant='filled' color='violet'>
                    Su tarea
                  </Badge>
                ) : null}
              </Group>
            }
          >
            <Text size='xs' c='dimmed'>
              {step.assignees.length > 0
                ? step.assignees.join(', ')
                : step.status === 'pending'
                  ? step.sequential
                    ? 'Se asigna cuando termine el paso anterior'
                    : 'Aún sin responsable'
                  : 'Sin responsable'}
            </Text>
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}

function isMineStep(step: FlowStep, mine: string): boolean {
  return Boolean(mine) && step.name.trim().toLowerCase() === mine;
}

const KIND_ICON: Record<FlowStepKind, typeof IconChecklist> = {
  upload: IconUpload,
  review: IconFileSearch,
  approve: IconShieldCheck,
  sign: IconSignature,
  payment: IconCash,
  purchase: IconShoppingCart,
  send: IconSend,
  delivery: IconTruck,
  schedule: IconCalendarEvent,
  people: IconUsers,
  training: IconSchool,
  register: IconDatabase,
  fix: IconTool,
  comment: IconMessage,
  document: IconFileText,
  close: IconFlag,
  task: IconChecklist,
};

/**
 * Ícono redondo del paso: dibuja lo que se hace en esa tarea (subir, revisar, aprobar…) y el
 * color dice el estado. Hecho = verde con chulito en la esquina; en curso = azul que late.
 */
function StepIcon({ step }: { step: FlowStep }) {
  const Icon = KIND_ICON[flowStepKind(step.name)];
  return (
    <span className={styles.icon} aria-hidden>
      <Icon size={13} stroke={2.2} />
      {step.status === 'done' ? (
        <span className={styles.doneBadge}>
          <IconCheck size={8} stroke={4} />
        </span>
      ) : null}
    </span>
  );
}

/** Globo del paso (al pasar el mouse o tocarlo): estado y responsables. */
function FlowStepTip({ step, index, total, isMine }: { step: FlowStep; index: number; total: number; isMine: boolean }) {
  const meta = STEP_META[step.status];
  return (
    <Stack gap={2} maw={260}>
      <Text size='xs' opacity={0.75}>
        Paso {index + 1} de {total} · {meta.label}
        {step.totalCount > 1 ? ` · ${step.doneCount}/${step.totalCount}` : ''}
        {isMine ? ' · Su tarea' : ''}
      </Text>
      <Text size='sm' fw={700} style={{ overflowWrap: 'anywhere' }}>
        {step.name}
      </Text>
      <Text size='xs' opacity={0.75}>
        {step.assignees.length > 0
          ? step.assignees.join(', ')
          : step.status === 'pending'
            ? step.sequential
              ? 'Se asigna cuando termine el paso anterior'
              : 'Aún sin responsable'
            : 'Sin responsable'}
      </Text>
    </Stack>
  );
}

/** Pasos como cápsulas que reparten el ancho de la pantalla (sin desplazarse de lado). */
function FlowStepsRow({ flow, highlightTask }: { flow: RequestFlow; highlightTask?: string | null }) {
  const mine = String(highlightTask || '').trim().toLowerCase();
  const steps = useMemo(() => flow.steps.filter((s) => s.status !== 'cancelled'), [flow]);

  return (
    <div className={styles.flow}>
      <div className={styles.steps} style={{ ['--steps' as string]: steps.length }} role='group' aria-label='Pasos del flujo'>
        {steps.map((step, i) => {
          const meta = STEP_META[step.status];
          const isMine = isMineStep(step, mine);
          return (
            <Tooltip
              key={step.key}
              withArrow
              openDelay={150}
              events={{ hover: true, focus: true, touch: true }}
              label={<FlowStepTip step={step} index={i} total={steps.length} isMine={isMine} />}
            >
              <button
                type='button'
                className={styles.step}
                data-status={step.status}
                data-mine={isMine}
                aria-label={`Paso ${i + 1}: ${step.name}, ${meta.label}`}
                style={{ ['--i' as string]: i }}
              >
                <span className={styles.capsule}>
                  <span className={styles.capsuleFill} />
                </span>
                <span className={styles.head}>
                  <StepIcon step={step} />
                  <span className={styles.label}>{step.name}</span>
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Avance arriba, en el encabezado de la solicitud o tarea: cápsulas por paso, detalle del paso
 * tocado y, si se despliega, la lista completa. Solo tareas del flujo (las de firma no cuentan).
 */
export function RequestFlowHeader({ requestId, highlightTask }: { requestId: number | null | undefined; highlightTask?: string | null }) {
  const ids = useMemo(() => (requestId ? [requestId] : []), [requestId]);
  const { flows, loaded } = useRequestFlows(ids);
  const [open, setOpen] = useState(false);
  const flow = requestId ? flows[requestId] : undefined;
  if (!requestId || !loaded || !flow || flow.total === 0) return null;
  const finished = flow.done >= flow.total;
  return (
    <Box mt='md' pt='md' style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Group justify='space-between' wrap='wrap' gap='xs' mb={8} align='baseline'>
        <Text size='sm' fw={700}>
          Avance de la solicitud
        </Text>
        <Group gap={8} align='baseline' wrap='nowrap'>
          <Text size='sm' c={finished ? 'teal.7' : 'dimmed'} fw={finished ? 700 : 500}>
            {finished ? 'Flujo completo' : `${flow.done} de ${flow.total} tareas`}
          </Text>
          <Text size='lg' fw={700} c={finished ? 'teal.7' : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {flow.percent}%
          </Text>
        </Group>
      </Group>
      <FlowStepsRow flow={flow} highlightTask={highlightTask} />
      <Button
        variant='subtle'
        size='compact-sm'
        mt={6}
        rightSection={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Ocultar lista' : 'Ver todos los pasos'}
      </Button>
      <Collapse in={open}>
        <Box mt='sm'>
          <RequestFlowSteps flow={flow} highlightTask={highlightTask} />
        </Box>
      </Collapse>
    </Box>
  );
}
