'use client';

/** Publica KPIs del Dashboard personal (solicitado) al asistente. */

import { useMemo } from 'react';
import { useRegisterAiPageContext } from '../../lib/ai/AiAssistantContext';
import { useSolicitadoData } from './SolicitadoShell';
import { useSolicitadoTab } from '../../lib/request-general/SolicitadoTabContext';

export default function SolicitadoAiContextBridge() {
  const {
    requestCounts,
    activityCounts,
    appliedRange,
    refreshing,
  } = useSolicitadoData();
  const { activeTab } = useSolicitadoTab();

  const screenSummary = useMemo(() => {
    const lines = [
      '### En esta página',
      'Estás en el **Dashboard personal** (lo que te toca **gestionar**, no lo que tú pediste).',
      `**Pestaña:** ${activeTab}`,
      `**Periodo:** ${appliedRange}`,
      '',
      '#### Solicitudes a tu cargo',
      `- Total: **${requestCounts.total}**`,
      `- Abiertas: **${requestCounts.abierto}** · En progreso: **${requestCounts.enProgreso}**`,
      `- Resueltas: **${requestCounts.resuelto}** · Canceladas: **${requestCounts.cancelado}**`,
      '',
      '#### Actividades',
      `- Total: **${activityCounts.total}** (abiertas: ${activityCounts.abierto}, en progreso: ${activityCounts.enProgreso}, resueltas: ${activityCounts.resuelto})`,
    ];
    if (refreshing) lines.push('\n_Actualizando datos…_');
    lines.push(
      '\nPregúntame por pendientes, un **#id**, o pídeme resolver una solicitud.',
    );
    return lines.join('\n');
  }, [requestCounts, activityCounts, appliedRange, activeTab, refreshing]);

  useRegisterAiPageContext({
    pageLabel: `Dashboard personal · ${activeTab}`,
    pageKind: 'dashboard-solicitado',
    extra: screenSummary,
    facts: {
      pestana: activeTab,
      periodo: appliedRange,
      solicitudes_total: requestCounts.total,
      solicitudes_abiertas: requestCounts.abierto,
      actividades_total: activityCounts.total,
    },
  });

  return null;
}
