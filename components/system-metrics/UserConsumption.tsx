'use client';

import { useMemo, useState } from 'react';
import { TextInput } from '@mantine/core';
import { IconCrown, IconSearch, IconUsers, IconUserBolt, IconUsersGroup } from '@tabler/icons-react';
import { useTheme } from '../providers';
import { avatarColor } from './colors';
import { formatAgo, formatInt, formatMs, formatValue, initialsOf, percentChange } from './format';
import { SignalTile, Sparkline } from './SignalTile';
import { ToneChip } from './StatusHero';
import type { ActiveUsers, UserRow } from './types';
import styles from './monitor.module.css';

const VISIBLE = 10;

/** Tarjeta de dato sin comparación con el periodo anterior (no aplica para estos datos). */
function StatTile({
  icon,
  label,
  value,
  unit,
  foot,
  trend,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  foot: string;
  trend?: Array<number | null>;
  /** Texto largo (un nombre): letra más chica y con puntos suspensivos. */
  small?: boolean;
}) {
  return (
    <div className={styles.signal}>
      <div className={styles.signalLabel}>
        {icon}
        {label}
      </div>
      <div
        className={styles.signalValue}
        style={small ? { fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}
        title={small ? value : undefined}
      >
        {value}
        {unit && <span className={styles.signalUnit}>{unit}</span>}
      </div>
      {trend && <Sparkline values={trend} label={`Tendencia de ${label.toLowerCase()}`} />}
      <div className={styles.signalFoot}>
        <span>{foot}</span>
      </div>
    </div>
  );
}

/**
 * "Usuarios": cuántas personas usan Kronos y cuánto servidor consume cada una.
 * Consumo = tiempo que el servidor pasó atendiendo sus peticiones (incluye lo que esperó a SQL
 * Server y a servicios externos). SQL no se puede separar por persona porque todos entran con
 * el mismo usuario de base de datos.
 */
export function UserConsumption({
  users,
  activeUsers,
  rangeSpan,
}: {
  users: UserRow[];
  activeUsers: ActiveUsers | null;
  rangeSpan: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const totalMs = users.reduce((acc, u) => acc + u.totalMs, 0);
  const top = users[0] ?? null;
  const topShare = top && totalMs ? (top.totalMs / totalMs) * 100 : null;
  const top5Share = totalMs ? (users.slice(0, 5).reduce((acc, u) => acc + u.totalMs, 0) / totalMs) * 100 : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const indexed = users.map((u, i) => ({ user: u, rank: i + 1 }));
    if (!q) return indexed;
    return indexed.filter(
      ({ user }) => user.email.includes(q) || (user.name ?? '').toLowerCase().includes(q)
    );
  }, [users, query]);
  const visible = showAll || query ? filtered : filtered.slice(0, VISIBLE);

  const trend = activeUsers?.series.map((s) => s.users) ?? [];

  return (
    <>
      <div className={styles.grid4}>
        <StatTile
          icon={<IconUsers size={15} />}
          label="Activos ahora"
          value={activeUsers ? formatInt(activeUsers.activeNow) : '–'}
          unit={activeUsers?.activeNow === 1 ? 'persona' : 'personas'}
          trend={trend}
          foot="Con actividad en los últimos 15 min"
        />
        <SignalTile
          icon={<IconUsersGroup size={15} />}
          label="Usuarios en el rango"
          value={activeUsers ? formatInt(activeUsers.inRange) : '–'}
          unit={activeUsers?.inRange === 1 ? 'persona' : 'personas'}
          change={
            activeUsers && activeUsers.previousRange > 0
              ? percentChange(activeUsers.inRange, activeUsers.previousRange)
              : null
          }
          polarity="neutral"
          trend={[]}
          foot={`distintos en ${rangeSpan}`}
        />
        <StatTile
          icon={<IconCrown size={15} />}
          label="Mayor consumo"
          value={top ? top.name ?? top.email : '–'}
          small
          foot={
            top && topShare != null
              ? `${formatValue(topShare, 0)} % del tiempo de servidor (${formatMs(top.totalMs)})`
              : 'Sin actividad en el rango'
          }
        />
        <StatTile
          icon={<IconUserBolt size={15} />}
          label="Concentración"
          value={top5Share == null ? '–' : formatValue(top5Share, 0)}
          unit="%"
          foot={
            users.length > 5
              ? 'Del tiempo de servidor es de las 5 personas que más consumen'
              : 'Hay 5 personas o menos en el rango'
          }
        />
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h3 className={styles.cardTitle}>Quién consume más</h3>
            <p className={styles.cardHint}>
              Ordenado por tiempo de servidor: lo que Kronos tardó atendiendo a cada persona, incluida la espera a
              la base de datos y a servicios externos
            </p>
          </div>
          {users.length > 5 && (
            <TextInput
              size="xs"
              radius="xl"
              placeholder="Buscar persona"
              leftSection={<IconSearch size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              aria-label="Buscar persona"
              w={220}
            />
          )}
        </div>

        {users.length === 0 ? (
          <div className={styles.empty}>Todavía no hay actividad de usuarios registrada en este rango.</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>Nadie coincide con “{query}”.</div>
        ) : (
          <div className={styles.list} style={{ marginTop: 14 }}>
            {visible.map(({ user, rank }) => {
              const share = totalMs ? (user.totalMs / totalMs) * 100 : 0;
              const color = avatarColor(user.email, isDark);
              const errorPct = user.requests ? (user.errors / user.requests) * 100 : 0;
              return (
                <div key={user.email} className={`${styles.userRow} ${rank === 1 ? styles.userTop : ''}`}>
                  <span className={styles.userRank}>{rank}</span>
                  <span
                    className={styles.userAvatar}
                    style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }}
                    aria-hidden
                  >
                    {initialsOf(user.name, user.email)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div className={styles.rowTitle} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{user.name ?? user.email}</span>
                      {rank === 1 && <ToneChip tone="warning" label="Mayor consumo" />}
                      {errorPct >= 5 && user.errors >= 3 && (
                        <ToneChip tone="critical" label={`${formatInt(user.errors)} errores`} />
                      )}
                    </div>
                    <div className={styles.rowSub}>
                      {user.name ? `${user.email} · ` : ''}
                      {formatInt(user.requests)} peticiones · promedio {formatMs(user.avgMs)} · p95 {formatMs(user.p95Ms)}
                    </div>
                    <div className={styles.rowSub}>
                      {user.topModuleLabel ? `Más usa: ${user.topModuleLabel} · ` : ''}
                      última actividad {formatAgo(user.lastSeen)}
                    </div>
                  </span>
                  <span className={styles.userShare}>
                    <span className={styles.shareTrack} aria-hidden>
                      <span className={styles.shareFill} style={{ width: `${share}%`, background: color, display: 'block' }} />
                    </span>
                    <span className={styles.userShareLabel}>{formatValue(share, share < 1 ? 1 : 0)} % del total</span>
                  </span>
                  <span className={styles.rowMetric}>
                    {formatMs(user.totalMs)}
                    <div className={styles.rowMetricSub}>de servidor</div>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!query && users.length > VISIBLE && (
          <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ver menos' : `Ver las ${users.length} personas`}
          </button>
        )}
      </div>
    </>
  );
}
