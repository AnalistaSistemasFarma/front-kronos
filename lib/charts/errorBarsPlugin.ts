import type { Chart, ChartDataset, Plugin } from 'chart.js';

/**
 * Barras de error (rango ± desviación) sobre los puntos de un dataset.
 * Solo actúa en datasets que traen `errorBars` (un [mín, máx] por punto o null), así que
 * registrarlo globalmente no cambia ninguna otra gráfica.
 */
export type ErrorBarRange = [number, number] | null;

type DatasetWithErrorBars = ChartDataset & { errorBars?: ErrorBarRange[] };

const CAP_HALF_WIDTH = 6;

export const errorBarsPlugin: Plugin = {
  id: 'synerlinkErrorBars',
  afterDatasetsDraw(chart: Chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((raw, datasetIndex) => {
      const dataset = raw as DatasetWithErrorBars;
      if (!dataset.errorBars || !chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      const scale = chart.scales[meta.yAxisID ?? 'y'];
      if (!scale) return;
      const color = typeof dataset.borderColor === 'string' ? dataset.borderColor : '#1c1c1e';

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      dataset.errorBars.forEach((range, i) => {
        const point = meta.data[i];
        if (!range || !point) return;
        const x = point.x;
        const top = scale.getPixelForValue(range[1]);
        const bottom = scale.getPixelForValue(range[0]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.moveTo(x - CAP_HALF_WIDTH, top);
        ctx.lineTo(x + CAP_HALF_WIDTH, top);
        ctx.moveTo(x - CAP_HALF_WIDTH, bottom);
        ctx.lineTo(x + CAP_HALF_WIDTH, bottom);
        ctx.stroke();
      });
      ctx.restore();
    });
  },
};
