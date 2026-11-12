'use client';

/**
 * Utilidades de presentación del tablero comercial. Las tarjetas y listas usan
 * los componentes de SynerLink (KpiStatCard, ChartCard) y Mantine, para quedar
 * dentro del esquema de diseño de la app (claro y oscuro).
 */
import type { ReactNode } from 'react';
import { Badge, Group, Paper, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconCash,
  IconChartBar,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import { ChartCard, KpiStatCard } from '../../../../../components/dashboard/actividades/ActividadesUi';
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

const AZUL = 'var(--mantine-color-blue-6)';
const MORADO = 'var(--mantine-color-grape-6)';
const VERDE = 'var(--mantine-color-teal-6)';
const ROJO = 'var(--mantine-color-red-6)';

/**
 * KPI del tablero = KpiStatCard de SynerLink. `trend` colorea en verde/rojo
 * (variaciones); `tone` elige azul (venta) o morado (comparativo).
 */
export function Kpi({
  label,
  value,
  sub,
  tone,
  progress,
  trend,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'a' | 'b';
  progress?: number | null;
  trend?: number | null;
  loading?: boolean;
}) {
  const conTrend = trend !== undefined;
  const color = conTrend ? (trend == null ? AZUL : trend >= 0 ? VERDE : ROJO) : tone === 'b' ? MORADO : AZUL;
  const icon = conTrend ? (trend != null && trend < 0 ? IconTrendingDown : IconTrendingUp) : tone === 'a' ? IconCash : IconChartBar;
  return (
    <KpiStatCard
      label={label}
      value={value}
      hint={sub ?? ''}
      color={color}
      icon={icon}
      sharePercent={progress != null ? progress * 100 : undefined}
      refreshing={loading}
    />
  );
}

export interface BarItem {
  key: string;
  name: string;
  value: number;
}

/** Lista con barra (mismo aspecto que RankedListCard), con clic opcional. */
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
  if (!items.length) {
    return (
      <Text size='sm' c='dimmed' ta='center' py='md'>
        {empty}
      </Text>
    );
  }
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <Stack gap='xs'>
      {items.map((i, idx) => {
        const fila = (
          <Paper p='xs' withBorder radius='md'>
            <Group justify='space-between' mb={6} wrap='nowrap'>
              <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                <Badge variant='filled' color={notas ? 'grape' : 'blue'} size='sm' circle>
                  {idx + 1}
                </Badge>
                <Text size='sm' fw={500} truncate='end' c={onPick ? 'blue' : undefined}>
                  {i.name}
                </Text>
              </Group>
              <Badge variant='light' color={notas ? 'grape' : 'blue'}>
                {format(i.value)}
              </Badge>
            </Group>
            <Progress value={(Math.abs(i.value) / max) * 100} size='sm' radius='xl' color={notas ? 'grape' : 'blue'} />
          </Paper>
        );
        return onPick ? (
          <UnstyledButton key={i.key} onClick={() => onPick(i.key)} title={i.name}>
            {fila}
          </UnstyledButton>
        ) : (
          <div key={i.key}>{fila}</div>
        );
      })}
    </Stack>
  );
}

/** Tarjeta de sección = ChartCard de SynerLink. */
export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <ChartCard title={title} description={note} height='auto'>
      {children}
    </ChartCard>
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
