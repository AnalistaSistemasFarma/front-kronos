'use client';

import { useId } from 'react';
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from '@tabler/icons-react';
import { formatValue } from './format';
import styles from './monitor.module.css';

type Polarity = 'up-is-bad' | 'up-is-good' | 'neutral';

/**
 * Señal clave (tráfico, latencia, errores, saturación): número grande, variación frente al
 * periodo anterior (con flecha y palabra, no solo color) y una mini tendencia.
 */
export function SignalTile({
  icon,
  label,
  value,
  unit,
  change,
  polarity,
  trend,
  foot,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  /** Variación % frente al periodo anterior. */
  change: number | null;
  polarity: Polarity;
  trend: Array<number | null>;
  foot?: string;
}) {
  return (
    <div className={styles.signal}>
      <div className={styles.signalLabel}>
        {icon}
        {label}
      </div>
      <div className={styles.signalValue}>
        {value}
        {unit && <span className={styles.signalUnit}>{unit}</span>}
      </div>
      <Sparkline values={trend} label={`Tendencia de ${label.toLowerCase()}`} />
      <div className={styles.signalFoot}>
        <Delta change={change} polarity={polarity} />
        {foot && <span>{foot}</span>}
      </div>
    </div>
  );
}

function Delta({ change, polarity }: { change: number | null; polarity: Polarity }) {
  if (change == null) return <span>Sin periodo anterior para comparar</span>;
  const rounded = Math.round(change);
  if (Math.abs(rounded) < 3) {
    return (
      <span className={`${styles.delta} ${styles['tone-idle']}`}>
        <IconMinus size={13} stroke={2.4} /> Estable vs. periodo anterior
      </span>
    );
  }
  const up = rounded > 0;
  const bad = polarity === 'neutral' ? null : polarity === 'up-is-bad' ? up : !up;
  const tone = bad == null ? 'tone-info' : bad ? 'tone-warning' : 'tone-ok';
  const word = bad == null ? '' : bad ? ' · peor' : ' · mejor';
  return (
    <span className={`${styles.delta} ${styles[tone]}`}>
      {up ? <IconArrowUpRight size={14} stroke={2.4} /> : <IconArrowDownRight size={14} stroke={2.4} />}
      {formatValue(Math.abs(rounded), 0)} %{word}
    </span>
  );
}

/** Mini línea de tendencia (SVG): sin ejes, solo forma, con un punto en el último valor. */
export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const gradientId = useId();
  const points = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null);
  if (points.length < 2) {
    return <svg className={styles.sparkline} role="img" aria-label={`${label}: sin datos suficientes`} />;
  }
  const W = 200;
  const H = 40;
  const pad = 3;
  const max = Math.max(...points.map((p) => p.v));
  const min = Math.min(0, ...points.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const area = `${d} L${x(last.i).toFixed(1)},${H} L${x(points[0].i).toFixed(1)},${H} Z`;

  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sm-info)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--sm-info)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={d} fill="none" stroke="var(--sm-info)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill="var(--sm-info)" stroke="var(--sm-card-solid, var(--sm-card))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
