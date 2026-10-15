'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  IconChevronDown,
  IconChevronRight,
  IconFileDescription,
} from '@tabler/icons-react';
import { panelStyles as ps, toneClass, type StatusTone } from '../../ui/panel/Panel';
import styles from './requestList.module.css';

/**
 * Piezas de los listados de solicitudes con el diseño de los paneles (el del Monitor).
 * Envolver la pantalla con <RequestsPage>.
 */

export function RequestsPage({ children }: { children: ReactNode }) {
  return (
    <div className={`${ps.root} ${ps.page}`}>
      <div className={ps.container}>{children}</div>
    </div>
  );
}

export function RequestsHeader({
  crumbs,
  title,
  subtitle,
  actions,
}: {
  crumbs: Array<{ title: string; href?: string }>;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={ps.header}>
      <div style={{ minWidth: 0 }}>
        <nav className={styles.crumbs} aria-label='Ruta'>
          {crumbs.map((c, i) => (
            <span key={c.title} className={styles.crumbs}>
              {i > 0 ? <IconChevronRight size={14} aria-hidden /> : null}
              {c.href ? <Link href={c.href}>{c.title}</Link> : <span>{c.title}</span>}
            </span>
          ))}
        </nav>
        <div className={styles.titleRow} style={{ marginTop: 10 }}>
          <span className={styles.titleIcon} aria-hidden>
            <IconFileDescription size={24} stroke={2} />
          </span>
          <h1 className={ps.largeTitle} style={{ margin: 0 }}>
            {title}
          </h1>
        </div>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={ps.headerControls}>{actions}</div> : null}
    </header>
  );
}

/** Indicador que filtra al tocarlo (queda marcado cuando su filtro está activo). */
export function StatFilterTile({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
  ariaLabel,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  /** 'violet' es un acento extra (no es un estado). */
  tone: StatusTone | 'violet';
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  /** Línea pequeña bajo el número. */
  hint?: ReactNode;
}) {
  const interactive = Boolean(onClick);
  return (
    <button
      type='button'
      className={`${styles.statTile} ${tone === 'violet' ? styles.toneViolet : toneClass(tone)} ${active ? styles.statTileActive : ''} ${
        interactive ? '' : styles.statStatic
      }`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={interactive ? Boolean(active) : undefined}
      disabled={!interactive}
    >
      <span className={styles.statIcon} aria-hidden>
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className={styles.statLabel} style={{ display: 'block' }}>
          {label}
        </span>
        <span className={styles.statValue} style={{ display: 'block' }}>
          {value}
        </span>
        {hint ? <span className={styles.statHint}>{hint}</span> : null}
      </span>
    </button>
  );
}

/** Avance con anillo (estilo de los anillos del Monitor). */
export function ProgressRingTile({
  label,
  done,
  total,
  percent,
}: {
  label: string;
  done: number;
  total: number;
  percent: number;
}) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const tone: StatusTone = total === 0 ? 'idle' : percent === 100 ? 'ok' : 'info';
  return (
    <div className={`${styles.statTile} ${styles.statStatic} ${toneClass(tone)}`}>
      <svg className={styles.ringSvg} viewBox='0 0 48 48' role='img' aria-label={`${label}: ${percent} %`}>
        <circle className={styles.ringTrack} cx='24' cy='24' r={r} fill='none' strokeWidth='5' />
        <circle
          className={styles.ringValue}
          cx='24'
          cy='24'
          r={r}
          fill='none'
          strokeWidth='5'
          strokeLinecap='round'
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          transform='rotate(-90 24 24)'
        />
        <text className={styles.ringText} x='24' y='28.5' textAnchor='middle'>
          {percent}%
        </text>
      </svg>
      <span style={{ minWidth: 0 }}>
        <span className={styles.statLabel} style={{ display: 'block' }}>
          {label}
        </span>
        <span className={styles.statValue} style={{ display: 'block' }}>
          {done}/{total}
        </span>
      </span>
    </div>
  );
}

export function FilterPanel({
  expanded,
  onToggle,
  icon,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={ps.card} style={{ marginTop: 24 }}>
      <button
        type='button'
        className={styles.filterHead}
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid='filter-toggle'
      >
        <h2 className={`${ps.cardTitle} ${styles.filterTitle}`}>
          {icon}
          Filtros de búsqueda
        </h2>
        <IconChevronDown
          size={18}
          className={`${styles.filterChevron} ${expanded ? styles.filterChevronOpen : ''}`}
          aria-hidden
        />
      </button>
      {children}
    </div>
  );
}

/**
 * Barra de avance de tareas que "se rellena": crece desde 0 al cargar y, mientras no
 * termina, un destello la recorre. Completa queda verde y quieta.
 */
export function RequestProgressBar({
  done,
  total,
  percent,
}: {
  done: number;
  total: number;
  percent: number;
}) {
  const complete = percent === 100;
  return (
    <div className={`${styles.progress} ${toneClass(complete ? 'ok' : 'info')} ${complete ? styles.progressDone : ''}`}>
      <span
        className={styles.progressTrack}
        role='progressbar'
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label='Avance de tareas'
      >
        <span className={styles.progressFill} style={{ width: `${percent}%` }} />
      </span>
      {done}/{total}
    </div>
  );
}
