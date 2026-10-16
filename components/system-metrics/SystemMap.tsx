'use client';

import { useMemo, useState } from 'react';
import { IconAppWindow, IconChevronRight, IconCloud, IconDatabase, IconServer2, IconUsers } from '@tabler/icons-react';
import { useTheme } from '../providers';
import { avatarColor, type StatusTone } from './colors';
import { FlowLayer, flowWeights, type FlowEdge } from './FlowLayer';
import { formatAgo, formatInt, formatMs, formatValue, initialsOf } from './format';
import { ToneChip } from './StatusHero';
import styles from './monitor.module.css';

export type MapData = {
  users: {
    reqPerMin: number | null;
    p95Ms: number | null;
    tone: StatusTone;
    activeNow: number | null;
    top: Array<{ email: string; name: string | null }>;
  };
  instances: Array<{
    key: string;
    name: string;
    cpuPct: number | null;
    rssMb: number | null;
    eventLoopMs: number | null;
    reqPerMin: number | null;
    sqlInUse: number | null;
    tone: StatusTone;
  }>;
  sql: {
    tone: StatusTone;
    /** Base de este Kronos (el estado es de esa base y del servidor). */
    database: string | null;
    /** Por qué tiene ese color: el hallazgo más grave de la base. */
    reason: string | null;
    cpuPct: number | null;
    sessions: number | null;
    blocked: number | null;
    poolInUse: number | null;
    hasServerState: boolean | null;
  };
  externals: Array<{
    key: string;
    label: string;
    callsPerMin: number;
    p95Ms: number;
    throttled: number;
    errors: number;
    tone: StatusTone;
  }>;
  /** Otras aplicaciones conectadas al mismo SQL Server (no Kronos). */
  apps: Array<{
    key: string;
    label: string;
    host: string;
    logins: string[];
    databases: string[];
    sessions: number;
    running: number;
    cpuMs: number;
    lastActivity: string | null;
    active: boolean;
  }>;
  /** Aplicaciones conectadas que no caben en el mapa. */
  moreApps: number;
};

const SQL_NODE = 'sql';
const USERS_NODE = 'users';

/**
 * Mapa del sistema como diagrama de flujo: Personas → Kronos → SQL Server y servicios externos,
 * y a la derecha las otras aplicaciones que también usan el mismo SQL Server. Las curvas
 * crecen con el tráfico y sus puntos se mueven más rápido cuanto más carga llevan; una curva
 * punteada y quieta es una conexión abierta sin actividad.
 */
export function SystemMap({ data, onSelectExternal }: { data: MapData; onSelectExternal: (key: string, label: string) => void }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const reqLabel = data.users.reqPerMin == null ? 'sin datos' : `${formatValue(data.users.reqPerMin)} pet./min`;

  const edges = useMemo<FlowEdge[]>(() => {
    const list: FlowEdge[] = [];
    const instReq = data.instances.map((i) => i.reqPerMin ?? 0);
    const extCalls = data.externals.map((e) => e.callsPerMin / Math.max(1, data.instances.length));
    // Sesiones no son peticiones/min: las aplicaciones se escalan aparte y un poco más finas.
    const appWeights = flowWeights(data.apps.map((a) => a.sessions)).map((w) => w * 0.7);
    // Un solo máximo para el tráfico de Kronos: esos grosores se pueden comparar entre sí.
    const weights = flowWeights([...instReq, ...instReq, ...extCalls]);
    const n = data.instances.length;

    data.instances.forEach((inst, i) => {
      list.push({
        id: `u-${inst.key}`,
        from: USERS_NODE,
        to: inst.key,
        weight: weights[i],
        rate: inst.reqPerMin,
        tone: data.users.tone === 'idle' ? 'info' : data.users.tone,
        title: `Personas → ${inst.name}: ${formatValue(inst.reqPerMin ?? 0)} peticiones por minuto`,
      });
      list.push({
        id: `${inst.key}-sql`,
        from: inst.key,
        to: SQL_NODE,
        weight: weights[n + i],
        rate: inst.reqPerMin,
        tone: data.sql.tone === 'idle' ? 'info' : data.sql.tone,
        title: `${inst.name} → SQL Server: ${inst.sqlInUse == null ? '–' : formatInt(inst.sqlInUse)} conexiones en uso`,
      });
      data.externals.forEach((ext, j) => {
        list.push({
          id: `${inst.key}-${ext.key}`,
          from: inst.key,
          to: `ext-${ext.key}`,
          weight: weights[2 * n + j],
          rate: ext.callsPerMin / Math.max(1, n),
          tone: ext.tone === 'idle' ? 'info' : ext.tone,
          title: `${inst.name} → ${ext.label}: ${formatValue(ext.callsPerMin / Math.max(1, n))} llamadas por minuto`,
        });
      });
    });

    data.apps.forEach((app, k) => {
      list.push({
        id: `app-${app.key}`,
        from: `app-${app.key}`,
        to: SQL_NODE,
        weight: appWeights[k],
        // Sin una tasa real por aplicación: se anima si tiene consultas corriendo ahora.
        rate: app.active ? Math.max(1, app.running * 20) : 0,
        tone: app.active ? 'info' : 'idle',
        title: `${app.label} (${app.host}) → SQL Server: ${formatInt(app.sessions)} sesiones, ${formatInt(app.running)} ejecutando`,
      });
    });
    return list;
  }, [data]);

  return (
    <div ref={setStage} className={styles.flowStage} role="group" aria-label="Mapa del sistema">
      <FlowLayer container={stage} edges={edges} />
      <div className={styles.flowGrid}>
        {/* Personas */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Personas</div>
          <div data-flow-node={USERS_NODE} className={`${styles.node} ${styles[`tone-${data.users.tone}`]}`}>
            <div className={styles.nodeName}>
              <IconUsers size={18} />
              <span>
                {data.users.activeNow == null
                  ? 'Usuarios'
                  : `${formatInt(data.users.activeNow)} ${data.users.activeNow === 1 ? 'persona activa' : 'personas activas'}`}
              </span>
            </div>
            <div className={styles.nodeStats}>
              <span>
                <b>{reqLabel}</b>
              </span>
              <span>
                p95 <b>{formatMs(data.users.p95Ms)}</b>
              </span>
            </div>
            {data.users.top.length > 0 && (
              <div className={styles.miniAvatars} aria-label="Quienes más consumen">
                {data.users.top.slice(0, 5).map((u) => (
                  <span
                    key={u.email}
                    title={u.name ?? u.email}
                    style={{ background: `color-mix(in srgb, ${avatarColor(u.email, isDark)} 30%, var(--sm-card-solid, var(--sm-card-raised)))` }}
                  >
                    {initialsOf(u.name, u.email)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Kronos */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Kronos</div>
          {data.instances.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconServer2 size={18} />
                <span>Kronos</span>
              </div>
              <div className={styles.nodeStats}>Sin muestras todavía</div>
            </div>
          )}
          {data.instances.map((inst) => (
            <div key={inst.key} data-flow-node={inst.key} className={`${styles.node} ${styles[`tone-${inst.tone}`]}`}>
              <div className={styles.nodeHead}>
                <div className={styles.nodeName}>
                  <IconServer2 size={18} />
                  <span>{inst.name}</span>
                </div>
                <ToneChip tone={inst.tone} />
              </div>
              <div className={styles.nodeStats}>
                <span>
                  CPU <b>{inst.cpuPct == null ? '–' : `${formatValue(inst.cpuPct)} %`}</b>
                </span>
                <span>
                  RAM <b>{inst.rssMb == null ? '–' : `${formatInt(inst.rssMb)} MB`}</b>
                </span>
                <span>
                  Retraso <b>{formatMs(inst.eventLoopMs)}</b>
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* SQL Server y servicios externos */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Su base de datos y servicios</div>
          <div data-flow-node={SQL_NODE} className={`${styles.node} ${styles[`tone-${data.sql.tone}`]}`}>
            <div className={styles.nodeHead}>
              <div className={styles.nodeName}>
                <IconDatabase size={18} />
                <span>{data.sql.database ? `Base ${data.sql.database}` : 'SQL Server'}</span>
              </div>
              <ToneChip tone={data.sql.tone} />
            </div>
            <div className={styles.nodeStats}>
              {data.sql.hasServerState === false ? (
                <span>Sin permiso para ver la actividad</span>
              ) : (
                <>
                  <span>
                    CPU de SQL <b>{data.sql.cpuPct == null ? '–' : `${formatValue(data.sql.cpuPct)} %`}</b>
                  </span>
                  <span>
                    Sesiones en esta base <b>{formatInt(data.sql.sessions)}</b>
                  </span>
                  <span>
                    Bloqueos <b>{formatInt(data.sql.blocked)}</b>
                  </span>
                </>
              )}
            </div>
            {data.sql.reason && <div className={styles.nodeReason}>{data.sql.reason}</div>}
          </div>

          {data.externals.map((ext) => (
            <button
              key={ext.key}
              type="button"
              data-flow-node={`ext-${ext.key}`}
              className={`${styles.node} ${styles.nodeButton} ${styles[`tone-${ext.tone}`]}`}
              onClick={() => onSelectExternal(ext.key, ext.label)}
              aria-label={`Ver detalle de ${ext.label}`}
            >
              <div className={styles.nodeHead}>
                <div className={styles.nodeName}>
                  <IconCloud size={18} />
                  <span>{ext.label}</span>
                </div>
                <IconChevronRight size={16} className={styles.chevron} />
              </div>
              <div className={styles.nodeStats}>
                <span>
                  <b>{formatValue(ext.callsPerMin)}</b> llamadas/min
                </span>
                <span>
                  p95 <b>{formatMs(ext.p95Ms)}</b>
                </span>
                {ext.throttled > 0 && (
                  <span>
                    429 <b>{formatInt(ext.throttled)}</b>
                  </span>
                )}
                {ext.errors > 0 && (
                  <span>
                    Fallas <b>{formatInt(ext.errors)}</b>
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Otras aplicaciones en el mismo SQL Server */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Otras aplicaciones en SQL</div>
          {data.apps.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconAppWindow size={18} />
                <span>{data.sql.hasServerState === false ? 'Sin permiso para verlas' : 'Ninguna conectada'}</span>
              </div>
            </div>
          )}
          {data.apps.map((app) => (
            <div
              key={app.key}
              data-flow-node={`app-${app.key}`}
              className={`${styles.node} ${styles[app.active ? 'tone-info' : 'tone-idle']} ${app.active ? '' : styles.nodeIdle}`}
            >
              <div className={styles.nodeName}>
                <IconAppWindow size={18} />
                <span>{app.label}</span>
              </div>
              <div className={styles.nodeSub} title={`${app.host} · ${app.logins.join(', ')} · ${app.databases.join(', ')}`}>
                <span className={`${styles.activityDot} ${app.active ? '' : styles.activityDotIdle}`} aria-hidden />
                {app.active ? 'Activa' : `En espera · ${formatAgo(app.lastActivity)}`} · {app.host}
              </div>
              <div className={styles.nodeStats}>
                <span>
                  Sesiones <b>{formatInt(app.sessions)}</b>
                </span>
                {app.running > 0 && (
                  <span>
                    Ejecutando <b>{formatInt(app.running)}</b>
                  </span>
                )}
                <span>
                  Base <b>{app.databases.slice(0, 2).join(', ') || '–'}</b>
                  {app.databases.length > 2 ? ` +${app.databases.length - 2}` : ''}
                </span>
              </div>
            </div>
          ))}
          {data.moreApps > 0 && (
            <div className={styles.nodeSub} style={{ paddingLeft: 4 }}>
              y {formatInt(data.moreApps)} {data.moreApps === 1 ? 'conexión más' : 'conexiones más'} con poco uso
            </div>
          )}
        </div>
      </div>

      <div className={styles.flowLegend} aria-hidden>
        <span>
          <i className={styles.flowLegendLine} /> Más grueso y más rápido = más tráfico
        </span>
        <span>
          <i className={`${styles.flowLegendLine} ${styles.flowLegendIdle}`} /> Punteada y quieta = conectada sin actividad
        </span>
      </div>
    </div>
  );
}
