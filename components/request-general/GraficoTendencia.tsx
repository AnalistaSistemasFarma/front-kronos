'use client';

import { Badge, Text, Tooltip } from '@mantine/core';
import type { ChartData, ChartOptions } from 'chart.js';
import { ChartBox } from '../charts/ChartBox';
import type { Tendencia } from '../../lib/workflow/mejora-continua-rules';
import { textoDias, textoTendencia } from '../../lib/workflow/mejora-continua-rules';

/**
 * TENDENCIA de la duración (2026-11-09; Nicolás Rivera: «para que podamos medir si se han vuelto
 * más rápidos o no»): la duración normal de una solicitud mes a mes (línea) y cuántas se
 * resolvieron (barras). Lo usan el indicador del panel de flujos y el panel de cada flujo.
 */

export const COLOR_VEREDICTO: Record<Tendencia['veredicto'], string> = { mas_rapido: 'green', mas_lento: 'red', igual: 'gray', sin_datos: 'gray' };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export default function GraficoTendencia({ tendencia, alto = 160 }: { tendencia: Tendencia; alto?: number }) {
  const conDatos = tendencia.meses.some((m) => m.casos > 0);
  if (!conDatos) {
    return (
      <Text size='xs' c='dimmed'>
        Todavía no hay solicitudes resueltas para dibujar la tendencia.
      </Text>
    );
  }
  const data: ChartData<'bar' | 'line'> = {
    labels: tendencia.meses.map((m) => etiquetaMes(m.mes)),
    datasets: [
      {
        type: 'line',
        label: 'Duración normal (días)',
        data: tendencia.meses.map((m) => m.medianaDias),
        borderColor: '#0ca678',
        backgroundColor: '#0ca678',
        tension: 0.3,
        spanGaps: true,
        yAxisID: 'y',
        pointRadius: 3,
      },
      {
        type: 'bar',
        label: 'Solicitudes resueltas',
        data: tendencia.meses.map((m) => m.casos),
        backgroundColor: 'rgba(134, 142, 150, 0.25)',
        yAxisID: 'y2',
      },
    ],
  };
  const options: ChartOptions<'bar' | 'line'> = {
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ctx.dataset.yAxisID === 'y' ? `Duración normal: ${textoDias(ctx.parsed.y as number)}` : `Resueltas: ${ctx.parsed.y}`,
        },
      },
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'días', font: { size: 10 } }, ticks: { font: { size: 10 } } },
      y2: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { font: { size: 10 } } },
      x: { ticks: { font: { size: 10 } } },
    },
  };
  return <ChartBox type='bar' data={data as ChartData<'bar'>} options={options as ChartOptions<'bar'>} height={alto} />;
}

/** «▼ 12 %» (más rápido, verde), «▲ 8 %» (más lento, rojo), «= igual», «—». */
export function FlechaTendencia({ tendencia }: { tendencia: Pick<Tendencia, 'veredicto' | 'cambioPct' | 'reciente' | 'base'> }) {
  if (tendencia.veredicto === 'sin_datos') {
    return (
      <Text size='xs' c='dimmed'>
        —
      </Text>
    );
  }
  const etiqueta =
    tendencia.veredicto === 'igual' ? '= igual' : `${tendencia.veredicto === 'mas_rapido' ? '▼' : '▲'} ${Math.abs(tendencia.cambioPct ?? 0)} %`;
  return (
    <Tooltip
      label={`${textoTendencia(tendencia)}: ${textoDias(tendencia.reciente.medianaDias)} en los últimos 30 días frente a ${textoDias(tendencia.base.medianaDias)} antes.`}
      withArrow
      multiline
      w={260}
    >
      <Badge size='sm' variant='light' color={COLOR_VEREDICTO[tendencia.veredicto]}>
        {etiqueta}
      </Badge>
    </Tooltip>
  );
}
