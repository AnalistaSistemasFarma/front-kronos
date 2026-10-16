'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { DraftMark } from '../../../lib/orion/draftBoardDb';

/** Piezas visuales del tablero con estilo macOS / iOS (burbujas y panel de correcciones). */

export const MARK_STYLE: Record<DraftMark['type'] | 'fixed', { label: string; solid: string; fill: string; line: string }> = {
  correccion: { label: 'Corrección', solid: '#ea580c', fill: 'rgba(251, 146, 60, .38)', line: 'rgba(234, 88, 12, .9)' },
  sugerencia: { label: 'Sugerencia', solid: '#2563eb', fill: 'rgba(96, 165, 250, .32)', line: 'rgba(37, 99, 235, .9)' },
  pregunta: { label: 'Pregunta', solid: '#7c3aed', fill: 'rgba(167, 139, 250, .32)', line: 'rgba(124, 58, 237, .9)' },
  fixed: { label: 'Corregida', solid: '#0d9460', fill: 'rgba(45, 212, 140, .35)', line: 'rgba(13, 148, 96, .9)' },
};

export function markStyle(o: { fixed: boolean; type: DraftMark['type'] }) {
  return MARK_STYLE[o.fixed ? 'fixed' : o.type] ?? MARK_STYLE.correccion;
}

export const STATUS_LABEL: Record<DraftMark['status'], { label: string; color: string }> = {
  abierta: { label: 'Abierta', color: '#dc2626' },
  corregida: { label: 'Por confirmar', color: '#d97706' },
  respondida: { label: 'Respondida', color: '#d97706' },
  confirmada: { label: 'Confirmada', color: '#0d9460' },
};

export const EASE = 'cubic-bezier(.2, .8, .2, 1)';
export const SYSTEM_BLUE = 'var(--app-accent, #0a84ff)';
export const SYSTEM_GREEN = '#0d9460';

export function initialsOf(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = (Date.now() - time) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (seconds < 60) return 'hace un momento';
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 7 * 86400) return rtf.format(-Math.round(seconds / 86400), 'day');
  return new Date(time).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type Material = {
  bg: string;
  border: string;
  text: string;
  secondary: string;
  hairline: string;
  well: string;
};

export const LIGHT: Material = {
  bg: '#ffffff',
  border: 'rgba(0, 0, 0, .10)',
  text: '#1d1d1f',
  secondary: '#6e6e73',
  hairline: 'rgba(60, 60, 67, .14)',
  well: '#f2f2f7',
};

/** Colores del tema elegido en SynerLink (claro, oscuro o personalizado). */
export const THEME: Material = {
  bg: 'var(--app-surface, var(--mantine-color-body))',
  border: 'var(--app-border, var(--mantine-color-default-border))',
  text: 'var(--app-text, var(--mantine-color-text))',
  secondary: 'var(--app-text-muted, var(--mantine-color-dimmed))',
  hairline: 'var(--app-border-subtle, var(--mantine-color-default-border))',
  well: 'var(--app-surface-raised, var(--mantine-color-default-hover))',
};

export function useMaterial(): Material {
  return THEME;
}

export function surface(m: Material): CSSProperties {
  return { background: m.bg, border: `0.5px solid ${m.border}` };
}

export function sectionLabel(m: Material): CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: m.secondary,
    marginBottom: 4,
  };
}

export function MacAvatar({ name, color, size }: { name: string; color: string; size: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(145deg, color-mix(in srgb, ${color} 62%, #fff) 0%, ${color} 100%)`,
        boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,.35), 0 1px 2px rgba(0,0,0,.18)',
        color: '#fff',
        fontSize: Math.round(size * 0.4),
        fontWeight: 600,
        letterSpacing: 0.2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}

export function MacPill({ label, color }: { label: ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

/** Botón redondo tipo iOS (relleno = acción principal; tinted = secundaria). */
export function MacButton({
  children,
  onClick,
  color = SYSTEM_BLUE,
  variant = 'filled',
  disabled,
  type = 'button',
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  color?: string;
  variant?: 'filled' | 'tinted' | 'plain';
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 32,
        padding: '0 14px',
        border: 0,
        borderRadius: 999,
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        color: variant === 'filled' ? '#fff' : color,
        background:
          variant === 'filled'
            ? color
            : variant === 'tinted'
              ? `color-mix(in srgb, ${color} 14%, transparent)`
              : 'transparent',
        transition: `transform .15s ${EASE}, opacity .15s`,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Botón circular pequeño (cerrar, anterior, siguiente). */
export function MacIconButton({
  label,
  onClick,
  disabled,
  material,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  material: Material;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        width: 26,
        height: 26,
        borderRadius: '50%',
        border: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: material.well,
        color: material.secondary,
      }}
    >
      {children}
    </button>
  );
}
