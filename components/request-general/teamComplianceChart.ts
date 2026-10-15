import type { ChartData, ChartOptions } from 'chart.js';
import { baseChartOptions, categoryAxis, chartAxisFont, valueAxis } from '../../lib/charts/defaults';
import type { ErrorBarRange } from '../../lib/charts/errorBarsPlugin';
import { formatResolutionDuration } from '../../lib/request-general/solicitadoAnalytics';
import type { TeamCompliance } from '../../lib/request-general/teamWorkload';
import { seriesColor } from '../ui/panel/Panel';

const HOURS_PER_DAY = 24;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Cumplimiento por colaborador: barras = % cerrado de lo asignado (eje izq.), línea =
 * tiempo promedio de cierre en días con ± desviación (eje der.) y línea roja = cumplimiento
 * del equipo. Colores del panel (los mismos del Monitor).
 */
export function buildTeamComplianceChart(
  data: TeamCompliance,
  { isDark, compact }: { isDark: boolean; compact: boolean }
): { data: ChartData<'bar' | 'line'>; options: ChartOptions<'bar'> } {
  const members = data.members;
  const barColor = seriesColor(0, isDark);
  const lineColor = isDark ? '#f5f5f7' : '#1c1c1e';
  const averageColor = isDark ? '#ff453a' : '#ff3b30';

  const avgDays = members.map((m) => (m.avgHours != null ? round1(m.avgHours / HOURS_PER_DAY) : null));
  const errorBars: ErrorBarRange[] = members.map((m) =>
    m.avgHours != null && m.stdHours != null
      ? [
          Math.max(0, (m.avgHours - m.stdHours) / HOURS_PER_DAY),
          (m.avgHours + m.stdHours) / HOURS_PER_DAY,
        ]
      : null
  );
  const maxDays = Math.max(1, ...errorBars.map((r) => r?.[1] ?? 0), ...avgDays.map((d) => d ?? 0));

  return {
    data: {
      labels: members.map((m) => m.name),
      datasets: [
        {
          type: 'line',
          label: 'Tiempo promedio (días)',
          data: avgDays,
          yAxisID: 'y1',
          borderColor: lineColor,
          backgroundColor: lineColor,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          spanGaps: true,
          tension: 0,
          order: 1,
          errorBars,
        } as ChartData<'line'>['datasets'][number],
        {
          type: 'line',
          label: 'Cumplimiento del equipo',
          data: members.map(() => (data.teamPct != null ? round1(data.teamPct) : null)),
          yAxisID: 'y',
          borderColor: averageColor,
          backgroundColor: averageColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          order: 2,
        },
        {
          type: 'bar',
          label: '% cumplimiento',
          data: members.map((m) => round1(m.compliancePct)),
          yAxisID: 'y',
          backgroundColor: `${barColor}cc`,
          hoverBackgroundColor: barColor,
          borderRadius: 6,
          maxBarThickness: 56,
          order: 3,
        },
      ],
    } as ChartData<'bar' | 'line'>,
    options: baseChartOptions<'bar'>({
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          // Un solo bloque por persona (el de la barra) con todo el detalle.
          filter: (item) => item.dataset.type === 'bar',
          callbacks: {
            label: (ctx) => {
              const m = members[ctx.dataIndex];
              if (!m) return '';
              const lines = [
                `Asignadas: ${m.assigned}`,
                `% cumplimiento: ${round1(m.compliancePct)} % (${m.resolved} cerradas)`,
              ];
              if (m.avgHours != null) {
                const range =
                  m.stdHours != null
                    ? ` (± ${formatResolutionDuration(m.stdHours)})`
                    : '';
                lines.push(`Tiempo promedio: ${formatResolutionDuration(m.avgHours)}${range}`);
              }
              if (data.teamPct != null) lines.push(`Equipo: ${round1(data.teamPct)} %`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          ...categoryAxis(undefined, compact),
          grid: { display: false },
        },
        y: {
          ...valueAxis(undefined, true, compact),
          min: 0,
          max: 100,
          ticks: { ...valueAxis(undefined, true, compact).ticks, stepSize: 25, callback: (v) => `${v} %` },
          title: { display: !compact, text: '% cumplimiento', font: chartAxisFont(false) },
        },
        y1: {
          ...valueAxis(undefined, true, compact),
          position: 'right',
          min: 0,
          suggestedMax: Math.ceil(maxDays * 1.15),
          ticks: { ...valueAxis(undefined, true, compact).ticks, precision: 1 },
          grid: { display: false },
          title: { display: !compact, text: 'Días promedio de cierre', font: chartAxisFont(false) },
        },
      },
    }),
  };
}
