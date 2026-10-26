'use client';

import { useMemo, useState } from 'react';
import { useTheme } from '../providers';
import { avatarColor, moduleColor, moduleSlot } from './colors';
import { formatInt, formatMs, formatValue, initialsOf } from './format';
import type { UserRow } from './types';
import styles from './monitor.module.css';

const OTHER_MODULES_KEY = 'Otros módulos';
/** Personas visibles al abrir; el resto con "Ver las N personas". */
const VISIBLE = 15;

/** Los módulos sin color fijo toman uno estable por nombre (si no, todos saldrían grises). */
function moduleBarColor(label: string, isDark: boolean): string {
  if (label === OTHER_MODULES_KEY) return 'var(--sm-idle)';
  return moduleSlot(label) != null ? moduleColor(label, isDark) : avatarColor(label, isDark);
}

/**
 * Comportamiento de las personas: a qué módulos de Kronos va el tiempo de servidor de cada una.
 *
 * Una barra por persona, partida en colores por módulo; su largo es el consumo frente a quien más
 * consume. Antes era un diagrama de líneas animadas persona → módulo: con 70 personas eran cientos
 * de curvas en movimiento y congelaba los equipos sin tarjeta gráfica. Ahora son solo cajas de
 * colores (sin SVG ni animación) y se lee igual o mejor.
 *
 * Tocar un módulo arriba lo resalta en todas las barras y ordena a las personas por ese módulo.
 */
export function UserBehavior({ users }: { users: UserRow[] }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const model = useMemo(() => {
    const moduleOf = (label: string) => label || OTHER_MODULES_KEY;
    const people = users.map((u) => {
      const modules = new Map<string, number>();
      for (const m of u.modules) modules.set(moduleOf(m.label), (modules.get(moduleOf(m.label)) ?? 0) + m.totalMs);
      return {
        email: u.email,
        name: u.name ?? u.email,
        totalMs: u.totalMs,
        modules: Array.from(modules, ([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms),
        /** Datos viejos: cada ventana entera a su módulo principal, el % por módulo no es real. */
        approximate: Boolean(u.modulesApproximate),
      };
    });

    const totals = new Map<string, { label: string; totalMs: number; people: number }>();
    for (const p of people) {
      for (const m of p.modules) {
        const t = totals.get(m.label) ?? { label: m.label, totalMs: 0, people: 0 };
        t.totalMs += m.ms;
        t.people += 1;
        totals.set(m.label, t);
      }
    }
    const modules = Array.from(totals.values()).sort((a, b) =>
      a.label === OTHER_MODULES_KEY ? 1 : b.label === OTHER_MODULES_KEY ? -1 : b.totalMs - a.totalMs
    );
    const maxMs = Math.max(1, ...people.map((p) => p.totalMs));
    return { people, modules, maxMs };
  }, [users]);

  const ordered = useMemo(() => {
    if (!selected) return model.people;
    const msIn = (p: (typeof model.people)[number]) => p.modules.find((m) => m.label === selected)?.ms ?? 0;
    return model.people.filter((p) => msIn(p) > 0).sort((a, b) => msIn(b) - msIn(a));
  }, [model, selected]);

  if (users.length === 0 || model.modules.length === 0) {
    return <div className={styles.empty}>Todavía no hay actividad de usuarios para dibujar su comportamiento.</div>;
  }

  const visible = showAll ? ordered : ordered.slice(0, VISIBLE);
  const anyApproximate = model.people.some((p) => p.approximate);

  return (
    <div>
      <div className={styles.ubLegend} role="group" aria-label="Módulos: toque uno para resaltarlo">
        {model.modules.map((m) => {
          const active = selected === m.label;
          return (
            <button
              key={m.label}
              type="button"
              className={`${styles.ubChip} ${active ? styles.ubChipActive : ''} ${selected && !active ? styles.ubChipDim : ''}`}
              onClick={() => setSelected(active ? null : m.label)}
              aria-pressed={active}
              title={`${m.label}: ${formatMs(m.totalMs)} de servidor de ${formatInt(m.people)} personas`}
            >
              <span className={styles.swatch} style={{ background: moduleBarColor(m.label, isDark) }} aria-hidden />
              <span className={styles.ubChipLabel}>{m.label}</span>
              <span className={styles.ubChipMeta}>
                {formatMs(m.totalMs)} · {formatInt(m.people)}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <p className={styles.cardHint} style={{ margin: '10px 0 0' }}>
          {formatInt(ordered.length)} {ordered.length === 1 ? 'persona usó' : 'personas usaron'} {selected}, de quien
          más a quien menos.{' '}
          <button type="button" className={styles.ubClear} onClick={() => setSelected(null)}>
            Ver todos los módulos
          </button>
        </p>
      )}

      <div className={styles.ubList}>
        {visible.map((p) => {
          const main = p.modules[0];
          const color = avatarColor(p.email, isDark);
          const focusMs = selected ? p.modules.find((m) => m.label === selected)?.ms ?? 0 : null;
          const sub =
            focusMs != null
              ? `${formatMs(focusMs)} en ${selected}`
              : !main
                ? 'sin detalle'
                : p.approximate
                  ? `sobre todo en ${main.label}`
                  : `${formatValue(p.totalMs ? (main.ms / p.totalMs) * 100 : 0, 0)} % en ${main.label}`;
          return (
            <div key={p.email} className={styles.ubRow}>
              <span className={styles.userAvatar} style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }} aria-hidden>
                {initialsOf(p.name === p.email ? null : p.name, p.email)}
              </span>
              <span style={{ minWidth: 0 }}>
                <div className={styles.rowTitle}>{p.name}</div>
                <div className={styles.rowSub}>{sub}</div>
              </span>
              <span
                className={styles.ubTrack}
                role="img"
                aria-label={`${p.name}: ${p.modules.map((m) => `${m.label} ${formatMs(m.ms)}`).join(', ')}`}
              >
                <span className={styles.ubBar} style={{ width: `${(p.totalMs / model.maxMs) * 100}%` }}>
                  {p.modules.map((m) => (
                    <span
                      key={m.label}
                      className={`${styles.ubSeg} ${selected && selected !== m.label ? styles.ubSegDim : ''}`}
                      style={{ flexGrow: m.ms, background: moduleBarColor(m.label, isDark) }}
                      title={
                        p.approximate
                          ? `${m.label}: ${formatMs(m.ms)} (aproximado)`
                          : `${m.label}: ${formatMs(m.ms)} (${formatValue(p.totalMs ? (m.ms / p.totalMs) * 100 : 0, 0)} %)`
                      }
                    />
                  ))}
                </span>
              </span>
              <span className={styles.rowMetric}>{formatMs(p.totalMs)}</span>
            </div>
          );
        })}
      </div>

      {ordered.length > VISIBLE && (
        <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Ver menos' : `Ver las ${formatInt(ordered.length)} personas`}
        </button>
      )}

      <p className={styles.cardHint} style={{ marginTop: 12, marginBottom: 0 }}>
        Cada barra es el tiempo de servidor de una persona, en colores por módulo; la más larga es quien más consume.
        Pase el mouse por un color para ver el detalle.
        {anyApproximate
          ? ' Para datos anteriores al cambio del monitor el reparto es aproximado (cada bloque de 5 minutos se asignaba entero al módulo principal): ahí se muestra "sobre todo en" sin porcentaje.'
          : ''}
      </p>
    </div>
  );
}
