'use client';

import { useEffect, useState } from 'react';
import { Drawer, Loader, Group } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { MetricLineChart } from './MetricLineChart';
import { formatBucket, formatInt, formatMs, formatValue } from './format';
import type { DetailTarget, RangeKey, RouteRow } from './types';
import styles from './monitor.module.css';

type SeriesRow = {
  bucket: string;
  requests: number;
  errors: number;
  throttled: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
};

export function DetailSheet({
  target,
  range,
  inbound,
  outbound,
  onClose,
  onSelect,
}: {
  target: DetailTarget | null;
  range: RangeKey;
  inbound: RouteRow[];
  outbound: RouteRow[];
  onClose: () => void;
  onSelect: (target: DetailTarget) => void;
}) {
  const title = target?.kind === 'module' ? target.label : target?.title ?? '';

  return (
    <Drawer
      opened={target != null}
      onClose={onClose}
      position="right"
      size="lg"
      radius="lg"
      offset={8}
      overlayProps={{ backgroundOpacity: 0.25, blur: 3 }}
      classNames={{ content: styles.sheet, header: styles.sheetHeader }}
      title={<span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</span>}
    >
      <div className={styles.root} style={{ minHeight: 'auto', background: 'transparent' }}>
        {target?.kind === 'module' && (
          <ModuleDetail
            label={target.label}
            routes={inbound.filter((r) => (r.moduleLabel ?? r.module) === target.label)}
            onSelect={onSelect}
          />
        )}
        {target?.kind === 'route' && (
          <RouteDetail
            target={target}
            range={range}
            row={(target.direction === 'in' ? inbound : outbound).find((r) => r.key === target.key) ?? null}
          />
        )}
      </div>
    </Drawer>
  );
}

function ModuleDetail({
  label,
  routes,
  onSelect,
}: {
  label: string;
  routes: RouteRow[];
  onSelect: (target: DetailTarget) => void;
}) {
  const total = routes.reduce((acc, r) => acc + r.totalMs, 0);
  const requests = routes.reduce((acc, r) => acc + r.requests, 0);
  const errors = routes.reduce((acc, r) => acc + r.errors, 0);

  return (
    <>
      <div className={styles.sheetStats}>
        <Stat label="Tiempo de servidor" value={formatMs(total)} />
        <Stat label="Peticiones" value={formatInt(requests)} />
        <Stat label="Errores 5xx" value={formatInt(errors)} />
        <Stat label="Rutas" value={formatInt(routes.length)} />
      </div>
      <h3 className={styles.cardTitle} style={{ marginBottom: 10 }}>
        Rutas de {label}
      </h3>
      {routes.length === 0 ? (
        <div className={styles.empty}>Las rutas de este módulo no están entre las 40 más pesadas del rango.</div>
      ) : (
        <div className={styles.list}>
          {routes.map((r) => (
            <button
              key={r.key}
              type="button"
              className={styles.listRowButton}
              onClick={() => onSelect({ kind: 'route', direction: 'in', key: r.key, title: r.key })}
            >
              <span style={{ minWidth: 0 }}>
                <div className={`${styles.rowTitle} ${styles.rowMono}`}>{r.key}</div>
                <div className={styles.rowSub}>
                  {formatInt(r.requests)} peticiones · promedio {formatMs(r.avgMs)}
                  {r.errors > 0 ? ` · ${formatInt(r.errors)} errores` : ''}
                </div>
              </span>
              <span className={styles.rowMetric}>
                {formatMs(r.p95Ms)}
                <div className={styles.rowMetricSub}>p95</div>
              </span>
              <IconChevronRight size={16} className={styles.chevron} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function RouteDetail({
  target,
  range,
  row,
}: {
  target: Extract<DetailTarget, { kind: 'route' }>;
  range: RangeKey;
  row: RouteRow | null;
}) {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSeries(null);
    setError(null);
    const params = new URLSearchParams({ range, direction: target.direction, key: target.key });
    fetch(`/api/system-metrics/route-series?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('No se pudo cargar la historia');
        const data = await res.json();
        setSeries(data.series ?? []);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Error inesperado');
      });
    return () => controller.abort();
  }, [range, target.direction, target.key]);

  const labels = (series ?? []).map((s) => formatBucket(s.bucket, range));

  return (
    <>
      {target.direction === 'out' && (
        <p className={styles.cardHint} style={{ marginTop: 0 }}>
          Servicio externo <code>{target.key}</code>. El tiempo es hasta que el servicio responde.
        </p>
      )}
      {row && (
        <div className={styles.sheetStats}>
          <Stat label={target.direction === 'out' ? 'Llamadas' : 'Peticiones'} value={formatInt(row.requests)} />
          <Stat label="Promedio" value={formatMs(row.avgMs)} />
          <Stat label="p95 (aprox.)" value={formatMs(row.p95Ms)} />
          <Stat label="Máximo" value={formatMs(row.maxMs)} />
          <Stat
            label="Errores"
            value={`${formatInt(row.errors)}${row.requests ? ` (${formatValue((row.errors / row.requests) * 100, 1)} %)` : ''}`}
          />
          <Stat label={target.direction === 'out' ? 'Limitadas (429)' : 'Tiempo total'} value={target.direction === 'out' ? formatInt(row.throttled) : formatMs(row.totalMs)} />
        </div>
      )}

      {error && <div className={styles.empty}>{error}</div>}
      {!error && series == null && (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      )}
      {series && series.length === 0 && <div className={styles.empty}>Sin datos en este rango.</div>}
      {series && series.length > 0 && (
        <>
          <h3 className={styles.cardTitle}>Tiempo de respuesta</h3>
          <p className={styles.cardHint}>Promedio y p95 por ventana de tiempo</p>
          <MetricLineChart
            labels={labels}
            unit="ms"
            height={200}
            series={[
              { label: 'Promedio', colorIndex: 0, values: series.map((s) => s.avgMs) },
              { label: 'p95', colorIndex: 1, values: series.map((s) => s.p95Ms) },
            ]}
          />
          <h3 className={styles.cardTitle} style={{ marginTop: 20 }}>
            {target.direction === 'out' ? 'Llamadas' : 'Peticiones'}
          </h3>
          <p className={styles.cardHint}>Cantidad por ventana y cuántas fallaron</p>
          <MetricLineChart
            labels={labels}
            unit=""
            height={180}
            series={[
              { label: target.direction === 'out' ? 'Llamadas' : 'Peticiones', colorIndex: 0, values: series.map((s) => s.requests) },
              { label: 'Con error', colorIndex: 1, values: series.map((s) => s.errors) },
              ...(target.direction === 'out'
                ? [{ label: 'Limitadas (429)', colorIndex: 2, values: series.map((s) => s.throttled) }]
                : []),
            ]}
          />
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.sheetStat}>
      <div className={styles.sheetStatLabel}>{label}</div>
      <div className={styles.sheetStatValue}>{value}</div>
    </div>
  );
}
