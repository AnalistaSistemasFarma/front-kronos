'use client';

/**
 * Piezas visuales del Tablero Comercial (tema «Insight»). Son propias de este
 * tablero y viven en su carpeta: no se comparten ni reemplazan componentes del
 * sistema. Las gráficas usan el ChartBox compartido.
 */
import type { ReactNode } from 'react';
import s from './tablero.module.css';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export const money = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`;

export const mm = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const millones = v / 1_000_000;
  if (Math.abs(millones) >= 1000) return `$ ${(millones / 1000).toLocaleString('es-CO', { maximumFractionDigits: 2 })} MM`;
  return `$ ${millones.toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
};

export const pct = (v: number | null | undefined, signo = true) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${signo && v > 0 ? '+' : ''}${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

export const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('es-CO'));

export const fecha = (f: string | null | undefined) => {
  if (!f) return '—';
  const [y, m, d] = f.split('-');
  return d && m && y ? `${d}/${m}/${y}` : f;
};

/** Días entre dos fechas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

export function Var({ v }: { v: number | null }) {
  if (v == null) return <span className={s.dim}>—</span>;
  return <span className={v >= 0 ? s.up : s.down}>{v >= 0 ? '▲' : '▼'} {pct(v)}</span>;
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  progress,
  selected,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'a' | 'b';
  progress?: number | null;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cx(s.kpi, tone === 'a' && s.kpiA, tone === 'b' && s.kpiB, selected && s.kpiSel)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <span className={s.kpiL}>{label}</span>
      <span className={s.kpiV}>{value}</span>
      {progress != null && (
        <div className={s.prog}>
          <i style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </div>
      )}
      {sub != null && <span className={s.kpiS}>{sub}</span>}
    </div>
  );
}

export interface BarItem {
  key: string;
  name: string;
  value: number;
}

export function HBars({
  items,
  format = mm,
  notas = false,
  onPick,
  empty = 'Sin datos con los filtros actuales.',
}: {
  items: BarItem[];
  format?: (v: number) => string;
  notas?: boolean;
  onPick?: (key: string) => void;
  empty?: string;
}) {
  if (!items.length) return <div className={s.empty}>{empty}</div>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className={s.hb}>
      {items.map((i) => (
        <button
          key={i.key}
          type='button'
          className={cx(s.hbRow, onPick && s.hbClick)}
          onClick={onPick ? () => onPick(i.key) : undefined}
          title={i.name}
        >
          <span className={s.hbN}>{i.name}</span>
          <span className={s.hbV}>{format(i.value)}</span>
          <span className={cx(s.hbBar, notas && s.hbBarN)}>
            <i style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={s.card}>
      <h3>{title}</h3>
      {note && <p className={s.note}>{note}</p>}
      {children}
    </div>
  );
}

export function EstadoCliente({ dias }: { dias: number | null }) {
  if (dias == null) return <span className={s.dim}>—</span>;
  if (dias <= 45) return <span className={cx(s.st, s.stOk)}>Activo</span>;
  if (dias <= 90) return <span className={cx(s.st, s.stWarn)}>En riesgo</span>;
  return <span className={cx(s.st, s.stCrit)}>Inactivo</span>;
}

/** Descarga una tabla como CSV (separador «;», abre en Excel). */
export function descargarCsv(nombre: string, encabezados: string[], filas: Array<Array<string | number | null>>) {
  const esc = (v: string | number | null) => {
    const t = v == null ? '' : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [encabezados, ...filas].map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Icono({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    pulse: <path d='M3 12h4l3-8 4 16 3-8h4' />,
    grid: <path d='M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' />,
    flag: <path d='M5 21V4h11l-2 4 2 4H5' />,
    users: <path d='M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8' />,
    box: <path d='M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8' />,
    user: <path d='M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' />,
    truck: <path d='M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4' />,
    table: <path d='M3 5h18v14H3zM3 10h18M3 15h18M9 5v14' />,
    menu: <path d='M4 6h16M4 12h16M4 18h16' />,
    spark: <path d='M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6' />,
    focus: <path d='M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' />,
    shield: <path d='M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z M9 12l2 2 4-4' />,
    chart: <path d='M4 19V9M10 19V5M16 19v-7M22 19H2' />,
    cal: <path d='M4 5h16v15H4zM4 9h16M8 3v4M16 3v4' />,
  };
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      {p[name] ?? null}
    </svg>
  );
}
