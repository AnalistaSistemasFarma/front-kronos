import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from 'chart.js';
import {
  CHART_AXIS_FONT_SIZE,
  chartFontFamily,
  chartLabelColor,
  getChartDevicePixelRatio,
} from './defaults';

let registered = false;

/** Registra componentes Chart.js una sola vez (tree-shaking friendly). */
export function registerCharts(): void {
  if (registered) return;
  ChartJS.register(
    // Controladores (necesarios para el componente genérico <Chart type="line|bar|pie">)
    LineController,
    BarController,
    PieController,
    DoughnutController,
    // Escalas y elementos
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Filler,
    Tooltip,
    Legend
  );

  ChartJS.defaults.font = {
    family: chartFontFamily,
    size: CHART_AXIS_FONT_SIZE,
    weight: 600,
    lineHeight: 1.3,
  };
  ChartJS.defaults.color = chartLabelColor;
  ChartJS.defaults.devicePixelRatio = getChartDevicePixelRatio();

  registered = true;
}

registerCharts();
