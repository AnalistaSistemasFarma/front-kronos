'use client';

import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { IconChevronRight } from '@tabler/icons-react';
import '../../lib/charts/register';
import { mergeChartOptionsForTheme } from '../../lib/charts/chartColorScheme';
import { useTheme } from '../providers';
import { moduleColor, moduleSlot, OTHER_MODULES } from './colors';
import { formatBucket, formatInt, formatMs, formatValue } from './format';
import type { ModuleRow, ModuleSeriesRow, RangeKey } from './types';
import styles from './monitor.module.css';

/**
 * "Tiempo de servidor": como Tiempo en pantalla de iPhone, pero para el servidor.
 * Barras apiladas por hora con el tiempo que el servidor dedicó a cada módulo, y debajo la
 * lista de módulos con su parte del total. Los módulos sin color propio se agrupan en "Otros".
 */
export function ServerTime({
  modules,
  series,
  range,
  onSelectModule,
}: {
  modules: ModuleRow[];
  series: ModuleSeriesRow[];
  range: RangeKey;
  onSelectModule: (label: string) => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  /** Agrupa por etiqueta (páginas + API del mismo módulo suman juntas). */
  const rows = useMemo(() => {
    const map = new Map<string, { label: string; requests: number; totalMs: number; errors: number }>();
    for (const m of modules) {
      const cur = map.get(m.label) ?? { label: m.label, requests: 0, totalMs: 0, errors: 0 };
      cur.requests += m.requests;
      cur.totalMs += m.totalMs;
      cur.errors += m.errors;
      map.set(m.label, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.totalMs - a.totalMs);
  }, [modules]);

  const total = rows.reduce((acc, r) => acc + r.totalMs, 0);

  const chart = useMemo(() => {
    const buckets = Array.from(new Set(series.map((s) => s.bucket))).sort();
    const index = new Map(buckets.map((b, i) => [b, i]));
    const stackKey = (label: string) => (moduleSlot(label) == null ? OTHER_MODULES : label);
    const byKey = new Map<string, number[]>();
    for (const s of series) {
      const key = stackKey(s.label);
      const arr = byKey.get(key) ?? buckets.map(() => 0);
      arr[index.get(s.bucket)!] += s.totalMs / 1000;
      byKey.set(key, arr);
    }
    // Orden de apilado fijo por identidad (no por ranking) para que no "salten" los colores.
    const keys = Array.from(byKey.keys()).sort((a, b) => (moduleSlot(a) ?? 99) - (moduleSlot(b) ?? 99));
    const panel = isDark ? '#1f2840' : '#ffffff';
    return {
      labels: buckets.map((b) => formatBucket(b, range)),
      datasets: keys.map((key) => ({
        label: key,
        data: byKey.get(key)!.map((v) => Math.round(v * 10) / 10),
        backgroundColor: moduleColor(key, isDark),
        borderColor: panel,
        borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
        borderRadius: 3,
        borderSkipped: false as const,
        barPercentage: 0.82,
        categoryPercentage: 0.92,
      })),
    };
  }, [series, range, isDark]);

  const options = useMemo(
    () =>
      mergeChartOptionsForTheme<'bar'>(
        {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              itemSort: (a, b) => Number(b.parsed.y) - Number(a.parsed.y),
              filter: (item) => Number(item.parsed.y) > 0,
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${formatMs(Number(ctx.parsed.y) * 1000)}`,
              },
            },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: { maxTicksLimit: 4, callback: (v) => formatMs(Number(v) * 1000) },
            },
          },
        } satisfies ChartOptions<'bar'>,
        isDark
      ),
    [isDark]
  );

  if (rows.length === 0) {
    return <div className={styles.empty}>Todavía no hay peticiones registradas en este rango.</div>;
  }

  return (
    <>
      <div style={{ height: 220 }}>
        <Bar data={chart} options={options} aria-label="Tiempo de servidor por módulo a lo largo del tiempo" />
      </div>
      <div className={styles.moduleList}>
        {rows.slice(0, 10).map((row) => {
          const share = total ? (row.totalMs / total) * 100 : 0;
          const color = moduleColor(row.label, isDark);
          return (
            <button
              key={row.label}
              type="button"
              className={styles.moduleRow}
              onClick={() => onSelectModule(row.label)}
              aria-label={`Ver rutas de ${row.label}`}
            >
              <span className={styles.swatch} style={{ background: color }} aria-hidden />
              <span style={{ minWidth: 0 }}>
                <div className={styles.moduleName}>{row.label}</div>
                <div className={styles.moduleMeta}>
                  {formatInt(row.requests)} peticiones{row.errors > 0 ? ` · ${formatInt(row.errors)} con error` : ''}
                </div>
              </span>
              <span className={styles.shareTrack} aria-hidden>
                <span className={styles.shareFill} style={{ width: `${share}%`, background: color, display: 'block' }} />
              </span>
              <span className={styles.moduleValue}>
                {formatMs(row.totalMs)}
                <div className={styles.moduleMeta}>{formatValue(share, 0)} %</div>
              </span>
              <IconChevronRight size={16} className={styles.chevron} aria-hidden />
            </button>
          );
        })}
      </div>
    </>
  );
}
