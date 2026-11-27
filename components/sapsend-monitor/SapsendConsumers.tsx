'use client';

import { useMemo, useState } from 'react';
import { Alert, SegmentedControl, TextInput } from '@mantine/core';
import { IconCrown, IconDeviceDesktop, IconSearch, IconUserExclamation, IconUsers } from '@tabler/icons-react';
import { useTheme } from '../providers';
import { avatarColor } from '../system-metrics/colors';
import { formatAgo, formatInt, formatMs, formatValue, initialsOf, programLabel } from '../system-metrics/format';
import { ToneChip } from '../system-metrics/StatusHero';
import styles from '../system-metrics/monitor.module.css';

/**
 * "Usuarios" de los SAPSEND: quién se conecta a sus bases (equipo + usuario SQL + programa) y
 * cuánto consume. Mismo diseño que "Usuarios" del Monitor del sistema, con datos directos del
 * SQL Server (sys.dm_exec_sessions), no de SynerLink.
 */

export type SapsendLogin = {
  key: string;
  login: string;
  host: string;
  /** servicio = servidor autorizado (SERFARMA); persona = alguien con su propia cuenta; revisar = otro caso. */
  accountType: 'servicio' | 'persona' | 'revisar';
  accountReason: string;
  /** Cuenta de Windows real (solo si entró con autenticación de Windows). */
  windowsUser: string | null;
  /** IP desde donde se conecta. */
  address: string | null;
  /** Persona detrás de la conexión: por su cuenta de Windows o por el inventario de activos. */
  person: { name: string; source: 'windows' | 'inventario'; department: string | null } | null;
  programs: string[];
  kind: string;
  databases: Array<{ name: string; cpuMs: number }>;
  sessions: number;
  running: number;
  cpuMs: number;
  reads: number;
  writes: number;
  cpuMsNow: number;
  readsNow: number;
  writesNow: number;
  lastRequestAt: string | null;
};

const VISIBLE = 10;
const READ_COLOR = 'var(--mantine-color-blue-6)';
const WRITE_COLOR = 'var(--mantine-color-teal-6)';

function StatTile({ icon, label, value, unit, foot, small }: { icon: React.ReactNode; label: string; value: string; unit?: string; foot: string; small?: boolean }) {
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
      <div className={styles.signalFoot}>
        <span>{foot}</span>
      </div>
    </div>
  );
}

export function SapsendConsumers({ logins, companyByDb }: { logins: SapsendLogin[]; companyByDb: Record<string, string> }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [measure, setMeasure] = useState<'total' | 'now'>('total');
  const [accountFilter, setAccountFilter] = useState<'todas' | 'persona' | 'servicio' | 'revisar'>('todas');

  const dbLabel = (db: string) => companyByDb[db.toLowerCase()] ?? db;
  /** Nombre a mostrar: la persona si se sabe; si es un servidor, el equipo. */
  const titleOf = (l: SapsendLogin) => l.person?.name ?? (l.accountType === 'servicio' ? l.host : `Persona sin identificar (${l.host})`);
  const personSource = (l: SapsendLogin) =>
    l.person?.source === 'windows'
      ? 'por su cuenta de Windows'
      : l.person?.source === 'inventario'
        ? `según el inventario de activos (equipo ${l.host}${l.person.department ? ` · ${l.person.department}` : ''})`
        : l.accountType === 'servicio'
          ? null
          : `el equipo ${l.host} no está en el inventario de activos`;
  const cpuOf = (l: SapsendLogin) => (measure === 'now' ? l.cpuMsNow : l.cpuMs);
  const personal = logins.filter((l) => l.accountType === 'persona');
  const toReview = logins.filter((l) => l.accountType === 'revisar');

  const ordered = useMemo(
    () =>
      [...logins]
        .filter((l) => accountFilter === 'todas' || l.accountType === accountFilter)
        .sort((a, b) => (measure === 'now' ? b.cpuMsNow - a.cpuMsNow : b.cpuMs - a.cpuMs)),
    [logins, measure, accountFilter]
  );
  const totalCpu = ordered.reduce((a, l) => a + cpuOf(l), 0);
  const top = ordered[0] ?? null;
  const topShare = top && totalCpu ? (cpuOf(top) / totalCpu) * 100 : null;
  const hosts = new Set(logins.map((l) => l.host)).size;
  const sqlUsers = new Set(logins.map((l) => l.login)).size;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const indexed = ordered.map((l, i) => ({ l, rank: i + 1 }));
    if (!q) return indexed;
    return indexed.filter(({ l }) => `${l.host} ${l.login} ${l.programs.join(' ')}`.toLowerCase().includes(q));
  }, [ordered, query]);
  const visible = showAll || query ? filtered : filtered.slice(0, VISIBLE);

  const maxRw = Math.max(1, ...ordered.map((l) => (measure === 'now' ? l.readsNow + l.writesNow : l.reads + l.writes)));

  return (
    <>
      <div className={styles.grid4}>
        <StatTile icon={<IconDeviceDesktop size={15} />} label="Equipos conectados" value={formatInt(hosts)} unit={hosts === 1 ? 'equipo' : 'equipos'} foot="Máquinas con sesiones abiertas en las bases SAPSEND" />
        <StatTile icon={<IconUsers size={15} />} label="Usuarios SQL" value={formatInt(sqlUsers)} unit={sqlUsers === 1 ? 'usuario' : 'usuarios'} foot={`${formatInt(logins.reduce((a, l) => a + l.sessions, 0))} sesiones en total`} />
        <StatTile
          icon={<IconCrown size={15} />}
          label="Mayor consumo"
          value={top ? titleOf(top) : '–'}
          small
          foot={top && topShare != null ? `${formatValue(topShare, 0)} % de la CPU de los SAPSEND (${formatMs(cpuOf(top))})` : 'Sin actividad'}
        />
        <StatTile
          icon={<IconUserExclamation size={15} />}
          label="Personas con su cuenta"
          value={formatInt(personal.length)}
          unit={personal.length === 1 ? 'conexión' : 'conexiones'}
          foot={
            personal.length
              ? `${[...new Set(personal.map((l) => l.person?.name ?? l.host))].slice(0, 3).join(', ')}${toReview.length ? ` · ${toReview.length} por revisar` : ''}`
              : toReview.length
                ? `Ninguna · ${toReview.length} conexión(es) por revisar`
                : 'Solo servidores autorizados (SERFARMA)'
          }
        />
      </div>

      {personal.length > 0 && (
        <Alert color="red" radius="lg" mt="md" icon={<IconUserExclamation size={16} />} title="Hay personas entrando a SAPSEND con su propia cuenta">
          {personal.slice(0, 6).map((l) => (
            <div key={l.key}>
              <b>{l.person?.name ?? 'Persona sin identificar'}</b>
              {l.databases[0] ? (
                <>
                  {' '}
                  está entrando a <b>SAPSEND de {dbLabel(l.databases[0].name)}</b>
                </>
              ) : null}{' '}
              desde el equipo <b>{l.host}</b> — {l.accountReason}
              {personSource(l) ? ` (${personSource(l)})` : ''}
            </div>
          ))}
          {personal.length > 6 && <div>y {personal.length - 6} más (filtre por Personas).</div>}
        </Alert>
      )}

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h3 className={styles.cardTitle}>Quién consume más</h3>
            <p className={styles.cardHint}>
              Ordenado por CPU del SQL Server que gastan sus sesiones en las bases SAPSEND (equipo + usuario SQL).
              Acumulado cuenta desde que cada sesión se conectó; Ahora solo desde la actualización anterior.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <SegmentedControl
              size="xs"
              radius="xl"
              value={accountFilter}
              onChange={(v) => setAccountFilter(v as typeof accountFilter)}
              data={[
                { value: 'todas', label: 'Todas' },
                { value: 'persona', label: `Personas (${personal.length})` },
                { value: 'servicio', label: 'Servidores' },
                { value: 'revisar', label: `Revisar (${toReview.length})` },
              ]}
            />
            <SegmentedControl
              size="xs"
              radius="xl"
              value={measure}
              onChange={(v) => setMeasure(v as 'total' | 'now')}
              data={[
                { value: 'total', label: 'Acumulado' },
                { value: 'now', label: 'Ahora' },
              ]}
            />
            {logins.length > 5 && (
              <TextInput
                size="xs"
                radius="xl"
                placeholder="Buscar equipo o usuario"
                leftSection={<IconSearch size={14} />}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                aria-label="Buscar equipo o usuario"
                w={220}
              />
            )}
          </div>
        </div>

        {logins.length === 0 ? (
          <div className={styles.empty}>No hay sesiones abiertas en las bases SAPSEND en este momento.</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>Nadie coincide con “{query}”.</div>
        ) : (
          <div className={styles.list} style={{ marginTop: 14 }}>
            {visible.map(({ l, rank }) => {
              const share = totalCpu ? (cpuOf(l) / totalCpu) * 100 : 0;
              const color = avatarColor(l.key, isDark);
              const mainDb = l.databases[0]?.name;
              return (
                <div key={l.key} className={`${styles.userRow} ${rank === 1 ? styles.userTop : ''}`}>
                  <span className={styles.userRank}>{rank}</span>
                  <span className={styles.userAvatar} style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }} aria-hidden>
                    {initialsOf(l.person?.name ?? l.host, l.login)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div className={styles.rowTitle} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{titleOf(l)}</span>
                      {l.accountType === 'persona' && <ToneChip tone="critical" label="Cuenta personal" />}
                      {l.accountType === 'revisar' && <ToneChip tone="warning" label="Revisar" />}
                      {rank === 1 && cpuOf(l) > 0 && <ToneChip tone="warning" label="Mayor consumo" />}
                      {l.running > 0 && <ToneChip tone="info" label={`${formatInt(l.running)} activas`} />}
                    </div>
                    <div className={styles.rowSub}>
                      Equipo {l.host}
                      {l.address ? ` (${l.address})` : ''} · usuario SQL {l.login} ·{' '}
                      {l.programs.map(programLabel).slice(0, 2).join(', ') || 'programa desconocido'} · {formatInt(l.sessions)}{' '}
                      {l.sessions === 1 ? 'sesión' : 'sesiones'}
                    </div>
                    {personSource(l) && <div className={styles.rowSub}>Persona {personSource(l)}</div>}
                    <div className={styles.rowSub}>
                      {mainDb ? `Más usa: ${dbLabel(mainDb)} (${mainDb}) · ` : ''}
                      última actividad {formatAgo(l.lastRequestAt)}
                    </div>
                    {l.accountType !== 'servicio' && (
                      <div className={styles.rowSub} style={{ color: l.accountType === 'persona' ? 'var(--sm-critical)' : 'var(--sm-warning)' }}>
                        {l.accountReason}
                      </div>
                    )}
                  </span>
                  <span className={styles.userShare}>
                    <span className={styles.shareTrack} aria-hidden>
                      <span className={styles.shareFill} style={{ width: `${share}%`, background: color, display: 'block' }} />
                    </span>
                    <span className={styles.userShareLabel}>{formatValue(share, share < 1 ? 1 : 0)} % del total</span>
                  </span>
                  <span className={styles.rowMetric}>
                    {formatMs(cpuOf(l))}
                    <div className={styles.rowMetricSub}>de CPU</div>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!query && logins.length > VISIBLE && (
          <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ver menos' : `Ver las ${logins.length} conexiones`}
          </button>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <h3 className={styles.cardTitle}>Lecturas y escrituras</h3>
        <p className={styles.cardHint}>
          Quién solo consulta y quién escribe en las bases SAPSEND: azul = páginas leídas, verde = páginas escritas
          ({measure === 'now' ? 'desde la actualización anterior' : 'desde que se conectó'}).
        </p>
        {ordered.length === 0 ? (
          <div className={styles.empty}>Sin datos.</div>
        ) : (
          <div className={styles.ubList}>
            {ordered.slice(0, 15).map((l) => {
              const r = measure === 'now' ? l.readsNow : l.reads;
              const w = measure === 'now' ? l.writesNow : l.writes;
              const total = r + w;
              const color = avatarColor(l.key, isDark);
              return (
                <div key={l.key} className={styles.ubRow}>
                  <span className={styles.userAvatar} style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }} aria-hidden>
                    {initialsOf(l.person?.name ?? l.host, l.login)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div className={styles.rowTitle}>{titleOf(l)}</div>
                    <div className={styles.rowSub}>
                      {total ? `${formatValue((w / total) * 100, 0)} % escrituras` : 'sin lecturas ni escrituras'} · {l.login}
                    </div>
                  </span>
                  <span className={styles.ubTrack} role="img" aria-label={`${l.host}: ${formatInt(r)} lecturas, ${formatInt(w)} escrituras`}>
                    <span className={styles.ubBar} style={{ width: `${(total / maxRw) * 100}%` }}>
                      {r > 0 && <span className={styles.ubSeg} style={{ flexGrow: r, background: READ_COLOR }} title={`Lecturas: ${formatInt(r)} páginas`} />}
                      {w > 0 && <span className={styles.ubSeg} style={{ flexGrow: w, background: WRITE_COLOR }} title={`Escrituras: ${formatInt(w)} páginas`} />}
                    </span>
                  </span>
                  <span className={styles.rowMetric}>{formatInt(total)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
