'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconHourglassHigh,
  IconInfoCircle,
} from '@tabler/icons-react';
import styles from './panel.module.css';

/**
 * Piezas de los paneles de SynerLink (mismo diseño del Monitor del sistema).
 * Todas esperan estar dentro de un contenedor con `panelStyles.root`.
 */

export const panelStyles = styles;

export type StatusTone = 'ok' | 'warning' | 'critical' | 'info' | 'idle';

export const STATUS_LABEL: Record<StatusTone, string> = {
  ok: 'Normal',
  warning: 'Atención',
  critical: 'Crítico',
  info: 'Información',
  idle: 'Sin datos',
};

export function toneClass(tone: StatusTone): string {
  return styles[`tone-${tone}`];
}

/** Paleta categórica validada para daltonismo (la misma del Monitor). */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function seriesColor(index: number, isDark: boolean): string {
  const palette = isDark ? SERIES_DARK : SERIES_LIGHT;
  return palette[Math.abs(index) % palette.length];
}

/** Color estable por persona (no cambia aunque cambie su puesto en la lista). */
export function avatarColor(key: string, isDark: boolean): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return seriesColor(Math.abs(hash), isDark);
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

export function ToneIcon({ tone, size = 16 }: { tone: StatusTone; size?: number }) {
  if (tone === 'ok') return <IconCircleCheck size={size} stroke={2} />;
  if (tone === 'info') return <IconInfoCircle size={size} stroke={2} />;
  if (tone === 'idle') return <IconHourglassHigh size={size} stroke={2} />;
  return <IconAlertTriangle size={size} stroke={2} />;
}

export function ToneChip({ tone, label }: { tone: StatusTone; label?: string }) {
  return (
    <span className={`${styles.toneChip} ${toneClass(tone)}`}>
      <ToneIcon tone={tone} size={12} />
      {label ?? STATUS_LABEL[tone]}
    </span>
  );
}

export function PanelSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {hint ? <span className={styles.sectionHint}>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Tarjeta con título, explicación corta y acciones opcionales a la derecha. */
export function PanelCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.card}>
      {title || actions ? (
        <div className={styles.cardHead}>
          <div style={{ minWidth: 0 }}>
            {title ? <h3 className={styles.cardTitle}>{title}</h3> : null}
            {description ? <p className={styles.cardHint}>{description}</p> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      {!title && description ? <p className={styles.cardHint}>{description}</p> : null}
      {children}
    </div>
  );
}

/**
 * Indicador clave: etiqueta con ícono, número grande y una línea de contexto.
 * `textValue` para valores de texto (nombre de un proceso) en vez de un número.
 */
export function KpiTile({
  icon,
  label,
  value,
  unit,
  foot,
  tone,
  trend,
  textValue = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  foot?: ReactNode;
  tone?: StatusTone;
  trend?: Array<number | null>;
  textValue?: boolean;
}) {
  return (
    <div className={`${styles.signal} ${tone ? toneClass(tone) : ''}`}>
      <div className={styles.signalLabel}>
        {icon}
        {label}
      </div>
      <div className={textValue ? styles.signalValueText : styles.signalValue} title={value}>
        {value}
        {unit && <span className={styles.signalUnit}>{unit}</span>}
      </div>
      {trend ? <Sparkline values={trend} label={`Tendencia de ${label.toLowerCase()}`} /> : null}
      {foot ? <div className={styles.signalFoot}>{foot}</div> : null}
    </div>
  );
}

/** Mini línea de tendencia (SVG): sin ejes, solo forma, con un punto en el último valor. */
export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const gradientId = useId();
  const points = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null);
  if (points.length < 2) {
    return <svg className={styles.sparkline} role='img' aria-label={`${label}: sin datos suficientes`} />;
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
    <svg className={styles.sparkline} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' role='img' aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor='var(--pn-info)' stopOpacity='0.22' />
          <stop offset='100%' stopColor='var(--pn-info)' stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={d} fill='none' stroke='var(--pn-info)' strokeWidth={2} vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill='var(--pn-info)' stroke='var(--pn-card-solid, var(--pn-card))' strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
    </svg>
  );
}

export interface HeroItem {
  id: string;
  title: string;
  detail: string;
  tone: StatusTone;
  icon: ReactNode;
  chip?: string;
}

const HERO_COLLAPSED = 4;

/** Resumen grande de arriba: estado general en una frase y hallazgos debajo. */
export function StatusHero({
  tone,
  kicker,
  headline,
  sub,
  items,
}: {
  tone: StatusTone;
  kicker: string;
  headline: string;
  sub?: string;
  items: HeroItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, HERO_COLLAPSED);

  return (
    <section className={`${styles.hero} ${toneClass(tone)}`} aria-live='polite'>
      <div className={styles.heroTop}>
        <div className={styles.orb} aria-hidden>
          <ToneIcon tone={tone} size={30} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className={styles.heroKicker}>
            <ToneIcon tone={tone} size={14} />
            {kicker}
          </div>
          <h2 className={styles.heroHeadline}>{headline}</h2>
          {sub ? <p className={styles.heroSub}>{sub}</p> : null}
        </div>
      </div>

      {items.length > 0 && (
        <div className={styles.insightList} role='list' aria-label='Hallazgos'>
          {visible.map((item) => (
            <div key={item.id} role='listitem' className={`${styles.insightRow} ${toneClass(item.tone)}`}>
              <div className={styles.insightIcon} aria-hidden>
                {item.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className={styles.insightTitle}>{item.title}</div>
                <div className={styles.insightDetail}>{item.detail}</div>
              </div>
              <ToneChip tone={item.tone} label={item.chip} />
            </div>
          ))}
          {items.length > HERO_COLLAPSED && (
            <button type='button' className={styles.linkButton} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Ver menos' : `Ver los ${items.length} hallazgos`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
