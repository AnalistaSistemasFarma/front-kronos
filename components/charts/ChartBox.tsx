'use client';

import { Box } from '@mantine/core';
import type {
  ActiveElement,
  Chart as ChartJS,
  ChartData,
  ChartDataset,
  ChartEvent,
  ChartOptions,
  ChartType,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scheduleLayoutUpdate } from '../../lib/dom/scheduleLayoutUpdate';
import { Chart } from 'react-chartjs-2';
import {
  applyClickOnlyTooltipToChart,
  mergeClickOnlyTooltipOptions,
  shouldUseClickOnlyTooltip,
} from '../../lib/charts/clickOnlyTooltip';
import { mergeChartOptionsForTheme } from '../../lib/charts/chartColorScheme';
import { useTheme } from '../providers';
import { useChartViewport } from '../dashboard/useChartViewport';
import '../../lib/charts/register';

/** Copia los datasets con valores en 0 para animar de 0 → valor real. */
function zeroChartData<T extends ChartType>(data: ChartData<T>): ChartData<T> {
  return {
    ...data,
    datasets: data.datasets.map((dataset) => {
      const next = { ...dataset } as ChartDataset<T>;
      const values = dataset.data as unknown[];
      next.data = values.map((value) => {
        if (typeof value === 'number') return 0;
        if (value == null) return 0;
        if (typeof value === 'object') {
          const point = value as Record<string, unknown>;
          if ('y' in point) return { ...point, y: 0 };
          if ('x' in point) return { ...point, x: 0 };
        }
        return 0;
      }) as ChartDataset<T>['data'];
      return next;
    }),
  } as ChartData<T>;
}

type ChartBoxProps<T extends ChartType = ChartType> = {
  type: T;
  data: ChartData<T>;
  options?: ChartOptions<T>;
  height: number;
  minWidth?: number;
  onChartClick?: (index: number | null) => void;
  pinnedIndex?: number | null;
  /** Sincroniza resize cuando cambia el contenedor padre (scroll, breakpoint) */
  layoutRevision?: number | string;
  /**
   * Al cambiar, la gráfica se reinicia en 0 y anima hasta los valores
   * (entrada / cambio de pestaña / filtro).
   */
  entranceKey?: string | number;
};

export function ChartBox<T extends ChartType = ChartType>({
  type,
  data,
  options,
  height,
  minWidth = 0,
  onChartClick,
  pinnedIndex,
  layoutRevision = 0,
  entranceKey = 'default',
}: ChartBoxProps<T>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isCompact, layoutEpoch, resizeTick, pixelRatio } = useChartViewport();
  const [ready, setReady] = useState(false);
  const [animKey, setAnimKey] = useState(entranceKey);
  const [showFullValues, setShowFullValues] = useState(false);
  const [clickTooltipActive, setClickTooltipActive] = useState<ActiveElement[] | null>(
    null
  );
  const clickTooltipActiveRef = useRef<ActiveElement[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartJS<T> | null>(null);
  const readyAtRef = useRef<number | null>(null);

  clickTooltipActiveRef.current = clickTooltipActive;

  if (entranceKey !== animKey) {
    setAnimKey(entranceKey);
    setShowFullValues(false);
  }

  const tooltipEnabledOption = options?.plugins?.tooltip?.enabled;
  const tooltipEnabledByOptions =
    typeof tooltipEnabledOption === 'boolean' ? tooltipEnabledOption : undefined;
  const useClickOnlyTooltip = shouldUseClickOnlyTooltip(
    Boolean(isCompact),
    tooltipEnabledByOptions,
    pinnedIndex !== undefined
  );

  useEffect(() => {
    setClickTooltipActive(null);
  }, [data, type]);

  // Tras reiniciar en 0, subir a valores reales para disparar la animación
  useEffect(() => {
    if (showFullValues) return;
    const id = window.setTimeout(() => setShowFullValues(true), 48);
    return () => window.clearTimeout(id);
  }, [animKey, showFullValues, type]);

  const resizeChart = useCallback(() => {
    requestAnimationFrame(() => {
      const chart = chartRef.current;
      if (!chart) return;
      // Quitar cualquier DPR congelado para que Chart.js use el del zoom actual
      delete (chart.options as { devicePixelRatio?: number }).devicePixelRatio;
      chart.resize();
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width <= 0) return;
      scheduleLayoutUpdate(() => {
        setReady(true);
      });
    });

    observer.observe(node);
    if (node.getBoundingClientRect().width > 0) setReady(true);

    return () => observer.disconnect();
  }, [height, minWidth, layoutRevision]);

  useEffect(() => {
    if (ready) {
      if (readyAtRef.current == null) readyAtRef.current = Date.now();
    } else {
      readyAtRef.current = null;
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const elapsed = readyAtRef.current != null ? Date.now() - readyAtRef.current : 0;
    const delay = Math.max(0, 850 - elapsed);
    const id = window.setTimeout(() => resizeChart(), delay);
    return () => window.clearTimeout(id);
  }, [
    height,
    minWidth,
    layoutEpoch,
    resizeTick,
    pixelRatio,
    layoutRevision,
    isCompact,
    ready,
    resizeChart,
    animKey,
  ]);

  const handleClick = useCallback(
    (event: ChartEvent, elements: ActiveElement[], chart: ChartJS<T>) => {
      if (useClickOnlyTooltip) {
        applyClickOnlyTooltipToChart(
          chart,
          event,
          elements,
          clickTooltipActiveRef.current,
          (next) => {
            clickTooltipActiveRef.current = next;
            setClickTooltipActive(next);
          }
        );
      }

      if (onChartClick) {
        const index = elements[0]?.index;
        onChartClick(typeof index === 'number' ? index : null);
      }

      const userOnClick = options?.onClick as
        | ((event: ChartEvent, elements: ActiveElement[], chart: ChartJS<T>) => void)
        | undefined;
      userOnClick?.(event, elements, chart);
    },
    [useClickOnlyTooltip, onChartClick, options]
  );

  const tooltipVisible =
    pinnedIndex !== undefined
      ? pinnedIndex !== null
      : useClickOnlyTooltip
        ? clickTooltipActive !== null && clickTooltipActive.length > 0
        : tooltipEnabledByOptions !== false;

  const optionsWithInteraction = mergeClickOnlyTooltipOptions(
    options,
    useClickOnlyTooltip,
    tooltipVisible
  );

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    ...optionsWithInteraction,
    animation: {
      duration: 750,
      easing: 'easeOutQuart',
      ...(typeof optionsWithInteraction?.animation === 'object' &&
      optionsWithInteraction.animation
        ? optionsWithInteraction.animation
        : {}),
    },
    onClick: handleClick,
    plugins: {
      ...optionsWithInteraction?.plugins,
      tooltip: {
        ...optionsWithInteraction?.plugins?.tooltip,
        ...(pinnedIndex !== undefined
          ? {
              enabled: pinnedIndex !== null,
            }
          : useClickOnlyTooltip
            ? {
                enabled: tooltipVisible,
              }
            : {}),
      },
    },
  } as ChartOptions<T>;

  // Sin devicePixelRatio fijo: Chart.js usa window.devicePixelRatio en vivo
  // (mejor nitidez al hacer zoom, tooltip canvas igual que antes).
  const mergedOptions = mergeChartOptionsForTheme(baseOptions, isDark);

  const displayData = useMemo(
    () => (showFullValues ? data : zeroChartData(data)),
    [data, showFullValues]
  );

  const useExpandedWidth = minWidth <= 0;

  return (
    <Box
      ref={containerRef}
      w='100%'
      style={{
        height,
        minHeight: height,
        width: '100%',
        maxWidth: '100%',
        minWidth: minWidth > 0 ? minWidth : undefined,
        position: 'relative',
      }}
    >
      {ready ? (
        <Chart
          key={String(animKey)}
          ref={(instance) => {
            chartRef.current = instance ?? null;
          }}
          type={type}
          data={displayData}
          options={mergedOptions as ChartOptions<T>}
          style={{
            display: 'block',
            width: useExpandedWidth ? '100%' : minWidth,
            height: '100%',
            maxWidth: useExpandedWidth ? '100%' : undefined,
          }}
        />
      ) : null}
    </Box>
  );
}
