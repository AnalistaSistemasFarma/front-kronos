'use client';

import { STATUS_LABEL, type StatusTone } from './colors';
import { formatValue } from './format';
import styles from './monitor.module.css';

export type RingSpec = {
  key: string;
  label: string;
  /** 0–100; null si no hay dato. */
  percent: number | null;
  sub: string;
  warning: number;
  critical: number;
};

function toneFor(spec: RingSpec): StatusTone {
  if (spec.percent == null) return 'idle';
  if (spec.percent >= spec.critical) return 'critical';
  if (spec.percent >= spec.warning) return 'warning';
  return 'ok';
}

/** Anillos de saturación (estilo anillos de actividad): qué tan "lleno" está cada recurso. */
export function ResourceRings({ rings }: { rings: RingSpec[] }) {
  return (
    <div className={styles.rings}>
      {rings.map((ring) => (
        <Ring key={ring.key} spec={ring} />
      ))}
    </div>
  );
}

function Ring({ spec }: { spec: RingSpec }) {
  const tone = toneFor(spec);
  const size = 104;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = spec.percent == null ? 0 : Math.max(0, Math.min(100, spec.percent));
  const offset = c * (1 - pct / 100);
  const text = spec.percent == null ? '–' : `${formatValue(spec.percent, 0)}%`;

  return (
    <div className={`${styles.ring} ${styles[`tone-${tone}`]}`}>
      <svg
        className={styles.ringSvg}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${spec.label}: ${text}, ${STATUS_LABEL[tone]}`}
      >
        <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className={styles.ringValue}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text className={styles.ringNumber} x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
          {text}
        </text>
      </svg>
      <div className={styles.ringCaption}>{spec.label}</div>
      <div className={styles.ringSub}>
        {STATUS_LABEL[tone]} · {spec.sub}
      </div>
    </div>
  );
}
