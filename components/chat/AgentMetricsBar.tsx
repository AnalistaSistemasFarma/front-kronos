'use client';

import { Box, Group, Progress, Text, Tooltip } from '@mantine/core';
import {
  colorContexto,
  metricasRancias,
  totalEntrada,
  type AgentMetricsDto,
} from '../../lib/chat/agent-metrics';

/**
 * Barra de métricas del agente (mod synerlink-metrics, F1): qué tan llena va la
 * ventana de contexto, tokens del último turno y de la sesión, modelo y
 * sub-agentes. Va anclada arriba del hilo directo, fuera del área que se
 * desplaza. Solo se pinta si el servidor mandó `metrics` (es decir, si el
 * usuario las puede ver: ver canViewAgentMetrics).
 *
 * Sin reporte en este hilo (null) no se pinta nada; con un reporte de hace más
 * de 5 minutos dice "sin datos recientes" en vez de mostrar cifras viejas como
 * si fueran en vivo.
 */

const compacto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const entero = new Intl.NumberFormat('es-CO');
const usd = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n >= 10_000 ? compacto.format(n) : entero.format(n);
}

function haceCuanto(iso: string, ahora = Date.now()): string {
  const ms = ahora - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const COLOR_MANTINE = { green: 'teal', yellow: 'yellow', red: 'red', gray: 'gray' } as const;

export default function AgentMetricsBar({ metrics }: { metrics: AgentMetricsDto | null | undefined }) {
  if (!metrics) return null;

  if (metricasRancias(metrics)) {
    return (
      <Box className='chat-thread__metricas' data-testid='chat-agent-metrics' data-stale='true'>
        <Text size='xs' className='chat-text-muted'>
          Métricas del asistente: sin datos recientes
          {metrics.updatedAt ? ` (último reporte ${haceCuanto(metrics.updatedAt)})` : ''}
        </Text>
      </Box>
    );
  }

  const pct = metrics.context.percent;
  const color = colorContexto(pct);
  const subagentes = Math.max(metrics.subagentCount, metrics.subagents.length);
  const detalleSub = metrics.subagents
    .map((s) => s.description || s.type || s.id)
    .filter(Boolean)
    .join(' · ');

  return (
    <Box className='chat-thread__metricas' data-testid='chat-agent-metrics' data-context-color={color}>
      <Group gap='xs' wrap='wrap' align='center'>
        <Tooltip
          label={`Contexto: ${fmt(metrics.context.tokens)} de ${fmt(metrics.context.window)} tokens`}
          withArrow
        >
          <Group gap={6} wrap='nowrap' className='chat-thread__metricas-contexto'>
            <Text size='xs' fw={600}>
              Contexto
            </Text>
            <Progress
              value={pct ?? 0}
              color={COLOR_MANTINE[color]}
              size='sm'
              radius='xl'
              w={90}
              aria-label={`Contexto usado ${pct ?? 0} %`}
            />
            <Text size='xs' fw={600} c={COLOR_MANTINE[color]}>
              {pct === null ? '—' : `${entero.format(Math.round(pct))} %`}
            </Text>
          </Group>
        </Tooltip>

        <Tooltip
          label={`Último turno — entrada ${entero.format(metrics.turn.input)}, caché leída ${entero.format(
            metrics.turn.cacheRead
          )}, caché escrita ${entero.format(metrics.turn.cacheCreation)}, salida ${entero.format(metrics.turn.output)}`}
          withArrow
          multiline
          w={260}
        >
          <Text size='xs' className='chat-text-muted'>
            Turno: {fmt(totalEntrada(metrics.turn))} entr. · {fmt(metrics.turn.output)} sal.
          </Text>
        </Tooltip>

        <Tooltip
          label={`Sesión — entrada ${entero.format(metrics.session.input)}, caché leída ${entero.format(
            metrics.session.cacheRead
          )}, caché escrita ${entero.format(metrics.session.cacheCreation)}, salida ${entero.format(
            metrics.session.output
          )}${metrics.costUsd !== null ? ` · costo estimado US$ ${usd.format(metrics.costUsd)}` : ''}`}
          withArrow
          multiline
          w={260}
        >
          <Text size='xs' className='chat-text-muted'>
            Sesión: {fmt(totalEntrada(metrics.session))} entr. · {fmt(metrics.session.output)} sal.
          </Text>
        </Tooltip>

        {metrics.model && (
          <Text size='xs' className='chat-text-muted' ff='monospace'>
            {metrics.model}
          </Text>
        )}

        <Tooltip label={detalleSub || 'Sin sub-agentes en curso'} withArrow multiline w={260}>
          <Text size='xs' className='chat-text-muted'>
            {subagentes === 1 ? '1 sub-agente' : `${subagentes} sub-agentes`}
          </Text>
        </Tooltip>
      </Group>
    </Box>
  );
}
