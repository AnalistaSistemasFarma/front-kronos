import type {
  ActiveElement,
  Chart as ChartJS,
  ChartEvent,
  ChartOptions,
  ChartType,
} from 'chart.js';

/** Viewports compactos: tooltip solo al tocar/clicar un punto, no al pasar o deslizar. */
export function shouldUseClickOnlyTooltip(
  isCompact: boolean,
  tooltipEnabled: boolean | undefined,
  hasPinnedIndexProp: boolean
): boolean {
  if (!isCompact || hasPinnedIndexProp) return false;
  return tooltipEnabled !== false;
}

export function getChartEventPosition(
  event: ChartEvent,
  chart: ChartJS
): { x: number; y: number } {
  if (typeof event.x === 'number' && typeof event.y === 'number') {
    return { x: event.x, y: event.y };
  }
  const rect = chart.canvas.getBoundingClientRect();
  const native = event.native as MouseEvent | TouchEvent | null;
  if (!native) return { x: 0, y: 0 };
  if ('clientX' in native) {
    return { x: native.clientX - rect.left, y: native.clientY - rect.top };
  }
  const touch = native.changedTouches?.[0];
  if (touch) {
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  return { x: 0, y: 0 };
}

function sameActiveElement(a: ActiveElement, b: ActiveElement): boolean {
  return a.datasetIndex === b.datasetIndex && a.index === b.index;
}

function sameActiveSet(a: ActiveElement[], b: ActiveElement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((el, i) => sameActiveElement(el, b[i]));
}

/** Replica modo "index" en el clic: todos los datasets del mismo índice X. */
export function buildIndexModeActiveElements(
  chart: ChartJS,
  hit: ActiveElement
): ActiveElement[] {
  const index = hit.index;
  if (typeof index !== 'number') return [hit];

  const active: ActiveElement[] = [];
  chart.data.datasets.forEach((_, datasetIndex) => {
    const element = chart.getDatasetMeta(datasetIndex).data[index];
    if (element) {
      active.push({ datasetIndex, index, element });
    }
  });

  return active.length > 0 ? active : [hit];
}

export function applyClickOnlyTooltipToChart(
  chart: ChartJS,
  event: ChartEvent,
  elements: ActiveElement[],
  currentActive: ActiveElement[] | null,
  setCurrentActive: (next: ActiveElement[] | null) => void
): void {
  if (elements.length === 0) {
    setCurrentActive(null);
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
    return;
  }

  const nextActive = buildIndexModeActiveElements(chart, elements[0]);
  const togglingOff =
    currentActive !== null && sameActiveSet(currentActive, nextActive);

  if (togglingOff) {
    setCurrentActive(null);
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  } else {
    setCurrentActive(nextActive);
    chart.setActiveElements(nextActive);
    const pos = getChartEventPosition(event, chart);
    chart.tooltip?.setActiveElements(nextActive, pos);
  }
  chart.update('none');
}

export function mergeClickOnlyTooltipOptions<T extends ChartType>(
  options: ChartOptions<T> | undefined,
  isCompact: boolean,
  tooltipVisible: boolean
): ChartOptions<T> {
  if (!isCompact) return (options ?? {}) as ChartOptions<T>;

  const interaction = options?.interaction;
  const tooltip = options?.plugins?.tooltip;

  return {
    ...options,
    interaction: {
      ...interaction,
      mode: interaction?.mode ?? 'nearest',
      intersect: interaction?.intersect ?? true,
    },
    hover: {
      ...options?.hover,
      mode: null,
    },
    plugins: {
      ...options?.plugins,
      tooltip: {
        ...tooltip,
        enabled: tooltipVisible,
      },
    },
  } as ChartOptions<T>;
}
