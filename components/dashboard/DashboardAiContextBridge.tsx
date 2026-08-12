'use client';

/**
 * Publica al asistente lo que realmente muestra el Dashboard Admin
 * (pestaña activa + KPIs del periodo), no el resumen personal del usuario.
 */

import { useMemo } from 'react';
import { useRegisterAiPageContext } from '../../lib/ai/AiAssistantContext';
import { useDashboardTab } from '../../lib/dashboard/DashboardTabContext';
import { useDashboardData } from '../../lib/dashboard/DashboardDataContext';
import { computeActivityStats } from '../../lib/dashboard/activityMetrics';
import { getPeriodRangeLabel } from '../../lib/dashboard/dateRange';
import { countRequestsByDashboardStatus } from '../../lib/dashboard/requestStatus';

const TAB_LABEL: Record<string, string> = {
  solicitudes: 'Solicitudes (analítica)',
  actividades: 'Actividades (tareas y rendimiento)',
  tickets: 'Tickets (mesa de ayuda)',
};

export default function DashboardAiContextBridge() {
  const { activeTab } = useDashboardTab();
  const {
    tasks,
    requests,
    cases,
    tasksLoading,
    ticketsLoading,
    dateFilter,
    selectedMonthDate,
    appliedRange,
    ticketsAppliedRange,
    isAdmin,
  } = useDashboardData();

  const activityStats = useMemo(() => computeActivityStats(tasks), [tasks]);
  const requestStats = useMemo(
    () => countRequestsByDashboardStatus(requests),
    [requests],
  );
  const periodLabel = useMemo(
    () => appliedRange || getPeriodRangeLabel(dateFilter, selectedMonthDate),
    [appliedRange, dateFilter, selectedMonthDate],
  );

  const screenSummary = useMemo(() => {
    const tabName = TAB_LABEL[activeTab] || activeTab;
    const lines: string[] = [
      '### En esta página',
      'Estás en el **Dashboard Admin** de SynerLink (analítica global del equipo, no tu bandeja personal).',
      `**Pestaña activa:** ${tabName}`,
      `**Periodo:** ${periodLabel}`,
      '',
    ];

    if (activeTab === 'actividades') {
      const pct =
        activityStats.total > 0
          ? Math.round((activityStats.completed / activityStats.total) * 100)
          : 0;
      lines.push('#### Lo que se ve ahora (Actividades)');
      lines.push(`- **${activityStats.total}** actividades en el periodo`);
      lines.push(
        `- **${activityStats.completed}** completadas (${pct}% del total)`,
      );
      lines.push(
        `- **${activityStats.pending}** pendientes / requieren atención`,
      );
      lines.push(
        `- **${activityStats.inProgress + activityStats.abierto}** en curso / abiertas`,
      );
      lines.push(
        `- Sección **Desempeño por encargado** (líderes de área y avance del equipo)`,
      );
      if (tasksLoading) lines.push('\n_Cargando datos de actividades…_');
    } else if (activeTab === 'solicitudes') {
      lines.push('#### Lo que se ve ahora (Solicitudes)');
      lines.push(`- **${requestStats.total}** solicitudes en el periodo`);
      lines.push(`- Abiertas: **${requestStats.abierto}**`);
      lines.push(`- En proceso: **${requestStats.enProceso}**`);
      lines.push(`- Cerradas/completadas: **${requestStats.cerrada}**`);
      lines.push(`- Pendientes: **${requestStats.pendiente}**`);
      if (tasksLoading) lines.push('\n_Cargando datos de solicitudes…_');
    } else {
      lines.push('#### Lo que se ve ahora (Tickets)');
      lines.push(`- **${cases.length}** casos Help Desk en el periodo`);
      lines.push(
        `Periodo tickets: ${ticketsAppliedRange || periodLabel}`,
      );
      if (ticketsLoading) lines.push('\n_Cargando tickets…_');
    }

    lines.push('');
    lines.push(
      'Puedes cambiar de pestaña (**Solicitudes / Actividades / Tickets**), filtrar el periodo o preguntarme por un encargado o un #id.',
    );
    return lines.join('\n');
  }, [
    activeTab,
    activityStats,
    requestStats,
    cases.length,
    periodLabel,
    ticketsAppliedRange,
    tasksLoading,
    ticketsLoading,
  ]);

  useRegisterAiPageContext(
    isAdmin
      ? {
          pageLabel: `Dashboard Admin · ${TAB_LABEL[activeTab] || activeTab}`,
          pageKind: 'dashboard-admin',
          extra: screenSummary,
          facts: {
            pestana: activeTab,
            periodo: periodLabel,
            actividades_total: activityStats.total,
            actividades_completadas: activityStats.completed,
            actividades_pendientes: activityStats.pending,
            solicitudes_periodo: requestStats.total,
            tickets_periodo: cases.length,
          },
        }
      : null,
  );

  return null;
}
