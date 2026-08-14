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
} from './defaults';

let registered = false;

/** Registra componentes Chart.js una sola vez (tree-shaking friendly). */
export function registerCharts(): void {
  if (registered) return;
  ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    LineController,
    BarElement,
    BarController,
    ArcElement,
    PieController,
    DoughnutController,
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
  // No fijar devicePixelRatio: Chart.js debe leer window.devicePixelRatio
  // en cada resize (si se congela aquí, zoom = canvas borroso).

  registered = true;
}

registerCharts();
