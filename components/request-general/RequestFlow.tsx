'use client';

import {
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClockHour4,
  IconPlayerPlayFilled,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { FlowStep, RequestFlow } from '@/lib/requests-general/flowProgress';
import { RequestProgressBar } from './RequestProgressBar';

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

const STEP_META: Record<FlowStep['status'], { color: string; label: string; icon: React.ReactNode }> = {
  done: { color: 'teal', label: 'Resuelta', icon: <IconCheck size={13} /> },
  current: { color: 'blue', label: 'En curso', icon: <IconPlayerPlayFilled size={11} /> },
  pending: { color: 'gray', label: 'Por hacer', icon: <IconClockHour4 size={13} /> },
  cancelled: { color: 'gray', label: 'Cancelada', icon: <IconX size={13} /> },
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
                {meta.icon}
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

/** Pasos en fila (1 → 2 → 3), con el actual resaltado. Se desplaza de lado si son muchos. */
function FlowStepsRow({ flow, highlightTask }: { flow: RequestFlow; highlightTask?: string | null }) {
  const mine = String(highlightTask || '').trim().toLowerCase();
  const steps = flow.steps.filter((s) => s.status !== 'cancelled');
  return (
    <ScrollArea type='auto' offsetScrollbars scrollbarSize={6}>
      <Group gap={0} wrap='nowrap' align='flex-start' py={4}>
        {steps.map((step, i) => {
          const meta = STEP_META[step.status];
          const isMine = Boolean(mine) && step.name.trim().toLowerCase() === mine;
          return (
            <Group key={step.key} gap={0} wrap='nowrap' align='flex-start'>
              {i > 0 ? (
                <Box
                  mt={11}
                  w={28}
                  h={2}
                  style={{
                    flexShrink: 0,
                    background:
                      step.status === 'pending' ? 'var(--mantine-color-gray-3)' : 'var(--mantine-color-teal-5)',
                  }}
                />
              ) : null}
              <Tooltip
                withArrow
                multiline
                maw={260}
                label={`${step.name} · ${meta.label}${step.assignees.length ? ` · ${step.assignees.join(', ')}` : ''}`}
              >
                <Stack gap={4} align='center' w={112} style={{ flexShrink: 0 }}>
                  <ThemeIcon
                    size={24}
                    radius='xl'
                    color={meta.color}
                    variant={step.status === 'pending' ? 'light' : 'filled'}
                    style={isMine ? { boxShadow: '0 0 0 3px var(--mantine-color-violet-3)' } : undefined}
                  >
                    {step.status === 'pending' ? (
                      <Text size='11px' fw={700}>
                        {i + 1}
                      </Text>
                    ) : (
                      meta.icon
                    )}
                  </ThemeIcon>
                  <Text
                    size='xs'
                    ta='center'
                    lineClamp={2}
                    fw={step.status === 'current' || isMine ? 700 : 500}
                    c={step.status === 'pending' ? 'dimmed' : undefined}
                  >
                    {step.name}
                  </Text>
                  {isMine ? (
                    <Badge size='xs' variant='light' color='violet'>
                      Su tarea
                    </Badge>
                  ) : null}
                </Stack>
              </Tooltip>
            </Group>
          );
        })}
      </Group>
    </ScrollArea>
  );
}

/**
 * Avance arriba, en el encabezado de la solicitud o tarea: barra, pasos en fila y, si se
 * despliega, el detalle con los responsables. Solo tareas del flujo (las de firma no cuentan).
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
      <Group justify='space-between' wrap='wrap' gap='xs' mb={6}>
        <Text size='sm' fw={700}>
          Avance de la solicitud
        </Text>
        <Text size='sm' c={finished ? 'teal.7' : 'dimmed'} fw={finished ? 700 : 500}>
          {finished
            ? 'Flujo completo'
            : `Paso ${flow.currentIndex} de ${flow.total} · ${flow.currentName} · ${flow.percent} %`}
        </Text>
      </Group>
      <Progress value={flow.percent} color={finished ? 'teal' : 'blue'} size='md' radius='xl' mb='sm' />
      <FlowStepsRow flow={flow} highlightTask={highlightTask} />
      <Button
        variant='subtle'
        size='compact-sm'
        mt={4}
        rightSection={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Ocultar detalle' : 'Ver responsables de cada paso'}
      </Button>
      <Collapse in={open}>
        <Box mt='sm'>
          <RequestFlowSteps flow={flow} highlightTask={highlightTask} />
        </Box>
      </Collapse>
    </Box>
  );
}
