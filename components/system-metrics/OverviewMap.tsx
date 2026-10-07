'use client';

import { useMemo, useState } from 'react';
import {
  IconAppWindow,
  IconBuildingFactory2,
  IconDatabase,
  IconDeviceDesktop,
  IconReportAnalytics,
  IconServer,
  IconServer2,
  IconSettings,
  IconSignature,
  IconUsers,
} from '@tabler/icons-react';
import { THRESHOLDS } from '../../lib/system-metrics/insights';
import type { AppKind, OverviewApp, OverviewEnvironment, OverviewMachine, SystemOverview } from '../../lib/system-metrics/overviewModel';
import { useTheme } from '../providers';
import { avatarColor, type StatusTone } from './colors';
import { FlowLayer, flowWeights, type FlowEdge } from './FlowLayer';
import { formatAgo, formatDateTime, formatInt, formatMs, formatValue, initialsOf, programLabel } from './format';
import { ToneChip } from './StatusHero';
import styles from './monitor.module.css';

const MAX_APPS = 10;
const MAX_MACHINES = 8;
const SQL_NODE = 'ov-sql';
const LOCAL_NODE = 'ov-local';
const appNode = (key: string) => `ov-app-${key}`;
const machineNode = (name: string) => `ov-m-${name}`;

const KIND_ICON: Record<AppKind, typeof IconAppWindow> = {
  kronos: IconServer2,
  orion: IconSignature,
  sapsend: IconAppWindow,
  sap: IconBuildingFactory2,
  reportes: IconReportAnalytics,
  sistema: IconSettings,
  otra: IconAppWindow,
};

type Limits = { warning: number; critical: number };

/** Mismos umbrales que el resumen y el mapa de detalle (THRESHOLDS de insights.ts). */
function usageTone(
  cpu: number | null,
  mem: number | null,
  cpuT: Limits = THRESHOLDS.hostCpu,
  memT: Limits = THRESHOLDS.hostMem
): StatusTone | null {
  if ((mem ?? 0) >= memT.critical || (cpu ?? 0) >= cpuT.critical) return 'critical';
  if ((mem ?? 0) >= memT.warning || (cpu ?? 0) >= cpuT.warning) return 'warning';
  return cpu == null && mem == null ? null : 'ok';
}

function envTone(env: OverviewEnvironment): StatusTone {
  if (env.state === 'sin-datos') return env.label === 'Producción' ? 'critical' : 'warning';
  const log = env.log?.verdict?.severity;
  if ((env.alerts?.critical ?? 0) > 0 || log === 'critical') return 'critical';
  const usage = usageTone(env.host?.cpuPct ?? null, env.host?.memPct ?? null);
  if (usage === 'critical') return 'critical';
  if (usage === 'warning' || (env.errorPct ?? 0) >= 5 || log === 'warning') return 'warning';
  return 'ok';
}

/** Por qué la tarjeta tiene ese color, en pocas palabras. */
function envReason(env: OverviewEnvironment): string | null {
  if (env.state === 'sin-datos') return null;
  const parts: string[] = [];
  const v = env.log?.verdict;
  if (v && v.severity !== 'info') parts.push(v.short);
  const usage = usageTone(env.host?.cpuPct ?? null, env.host?.memPct ?? null);
  if (usage === 'warning' || usage === 'critical') {
    if ((env.host?.memPct ?? 0) >= THRESHOLDS.hostMem.warning) parts.push(`RAM de ${env.host?.name} al ${formatInt(env.host?.memPct)} %`);
    if ((env.host?.cpuPct ?? 0) >= THRESHOLDS.hostCpu.warning) parts.push(`CPU de ${env.host?.name} al ${formatInt(env.host?.cpuPct)} %`);
  }
  if ((env.errorPct ?? 0) >= 5) parts.push(`${formatValue(env.errorPct ?? 0, 1)} % de errores`);
  if ((env.alerts?.critical ?? 0) > 0) parts.push(`${formatInt(env.alerts?.critical)} alertas críticas en 24 h`);
  if (!parts.length && v) parts.push(v.short);
  return parts.length ? parts.join(' · ') : null;
}

function appTone(app: OverviewApp): StatusTone {
  if (app.environment && app.environment.state !== 'sin-metricas') return envTone(app.environment);
  return app.active ? 'info' : 'idle';
}

function machineTone(m: OverviewMachine): StatusTone {
  return usageTone(m.cpuPct, m.memPct) ?? (m.sessions > 0 ? 'info' : 'idle');
}

function uniquePrograms(programs: string[]): string[] {
  return Array.from(new Set(programs.map(programLabel)));
}

/**
 * Vista general: todo lo que comparte el SQL Server en un solo dibujo.
 * Personas (Kronos de cada entorno y Orion) → aplicaciones (una por base de Kronos/Orion,
 * agrupadas para las demás) → máquinas desde donde se conectan → SQL Server.
 * Pasar el mouse sobre una tarjeta resalta solo sus conexiones.
 */
export function OverviewMap({ data }: { data: SystemOverview }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const totalSessions = data.apps.reduce((s, a) => s + a.sessions, 0);
  const memUsedPct =
    data.sqlServer.memTotalMb && data.sqlServer.memAvailableMb != null
      ? ((data.sqlServer.memTotalMb - data.sqlServer.memAvailableMb) / data.sqlServer.memTotalMb) * 100
      : null;
  const sqlCpu = data.sqlServer.sqlCpuPct != null ? data.sqlServer.sqlCpuPct + (data.sqlServer.otherCpuPct ?? 0) : null;
  const minDiskFreePct = data.sqlServer.disks.length
    ? Math.min(...data.sqlServer.disks.map((d) => (d.totalMb ? (d.freeMb / d.totalMb) * 100 : 100)))
    : null;
  const diskTone: StatusTone | null = minDiskFreePct == null ? null : minDiskFreePct < 5 ? 'critical' : minDiskFreePct < 10 ? 'warning' : null;
  const usage = usageTone(sqlCpu, memUsedPct, THRESHOLDS.sqlCpu);
  const sqlTone: StatusTone = !data.sqlServer.hasServerState
    ? 'idle'
    : usage === 'critical' || diskTone === 'critical'
      ? 'critical'
      : usage === 'warning' || diskTone === 'warning'
        ? 'warning'
        : usage ?? 'info';

  const { sqlKey, apps, machines, localApps, edges } = useMemo(() => {
    const sqlKey = data.sqlServer.machine.toUpperCase();
    const apps = data.apps.slice(0, MAX_APPS);
    const machines = data.machines.slice(0, MAX_MACHINES);
    const appKeys = new Set(apps.map((a) => a.key));
    const machineNames = new Set(machines.map((m) => m.name));
    const localApps = apps.filter((a) => a.machines.some((m) => m.name === sqlKey));
    const list: FlowEdge[] = [];

    const people = data.people.filter((g) => appKeys.has(g.appKey));
    const peopleW = flowWeights(people.map((g) => g.count ?? 0));
    people.forEach((g, i) => {
      list.push({
        id: `p-${g.key}`,
        from: `ov-${g.key}`,
        to: appNode(g.appKey),
        weight: Math.max(0.1, peopleW[i]),
        rate: g.count ? g.count * 10 : 0,
        tone: g.count ? 'info' : 'idle',
        title: `${g.label}: ${g.count == null ? g.caption.toLowerCase() : `${formatInt(g.count)} ${g.caption}`}`,
      });
    });

    type Link = { app: OverviewApp; target: string; targetLabel: string; sessions: number; rate: number };
    const links: Link[] = [];
    for (const app of apps) {
      const env = app.environment;
      app.machines.forEach((m, idx) => {
        const target = m.name === sqlKey ? LOCAL_NODE : machineNames.has(m.name) ? machineNode(m.name) : null;
        if (!target) return;
        const isEnvHost = env?.state === 'activo' && env.host?.name.toUpperCase() === m.name;
        const rate = isEnvHost ? env.reqPerMin ?? 0 : m.running > 0 ? m.running * 20 : idx === 0 && app.active && !env?.host ? 3 : 0;
        links.push({ app, target, targetLabel: m.name, sessions: m.sessions, rate });
      });
    }
    const linkW = flowWeights(links.map((l) => l.sessions));
    const incoming = new Map<string, { sessions: number; rate: number }>();
    links.forEach((l, i) => {
      const tone = appTone(l.app);
      list.push({
        id: `a-${l.app.key}-${l.target}`,
        from: appNode(l.app.key),
        to: l.target,
        weight: Math.max(0.12, linkW[i] * 0.85),
        rate: l.rate,
        tone: tone === 'ok' ? 'info' : tone,
        title: `${l.app.label} ↔ ${l.targetLabel}: ${formatInt(l.sessions)} sesiones${l.rate > 0 ? ' con actividad' : ''}`,
      });
      const acc = incoming.get(l.target) ?? { sessions: 0, rate: 0 };
      acc.sessions += l.sessions;
      acc.rate += l.rate;
      incoming.set(l.target, acc);
    });

    const outs = [...machines.map((m) => machineNode(m.name)), ...(localApps.length ? [LOCAL_NODE] : [])];
    const outW = flowWeights(outs.map((id) => incoming.get(id)?.sessions ?? 0));
    outs.forEach((id, i) => {
      const acc = incoming.get(id) ?? { sessions: 0, rate: 0 };
      list.push({
        id: `s-${id}`,
        from: id,
        to: SQL_NODE,
        weight: Math.max(0.12, outW[i]),
        rate: acc.rate,
        tone: acc.rate > 0 ? 'info' : 'idle',
        title: `${id === LOCAL_NODE ? sqlKey : id.replace('ov-m-', '')} → SQL Server: ${formatInt(acc.sessions)} sesiones`,
      });
    });
    return { sqlKey, apps, machines, localApps, edges: list };
  }, [data]);

  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((h) => (h === id ? null : h)),
    onFocus: () => setHover(id),
    onBlur: () => setHover((h) => (h === id ? null : h)),
    tabIndex: 0,
  });

  return (
    <div ref={setStage} className={styles.flowStage} role="group" aria-label="Vista general del sistema">
      <FlowLayer container={stage} edges={edges} highlight={hover} />
      <div className={styles.flowGrid}>
        {/* Personas */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Personas</div>
          {data.people.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconUsers size={18} />
                <span>Sin conteo de personas</span>
              </div>
            </div>
          )}
          {data.people.map((g) => (
            <div
              key={g.key}
              data-flow-node={`ov-${g.key}`}
              className={`${styles.node} ${styles[g.count ? 'tone-info' : 'tone-idle']} ${g.count ? '' : styles.nodeIdle}`}
              {...hoverProps(`ov-${g.key}`)}
            >
              <div className={styles.nodeName}>
                <IconUsers size={18} />
                <span>{g.label}</span>
              </div>
              <div className={styles.ovCount}>
                {g.count != null && <b>{formatInt(g.count)}</b>}
                <span>{g.caption}</span>
              </div>
              {g.note && (
                <div className={styles.nodeSub} title={g.note}>
                  {g.note}
                </div>
              )}
              {g.top.length > 0 && (
                <div className={styles.miniAvatars} aria-label="Algunas de esas personas">
                  {g.top.slice(0, 5).map((u) => (
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
          ))}
        </div>

        {/* Aplicaciones */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Aplicaciones</div>
          {apps.map((app) => {
            const Icon = KIND_ICON[app.kind];
            const env = app.environment;
            const tone = appTone(app);
            const withMetrics = env != null && env.state !== 'sin-metricas';
            const idle = tone === 'idle';
            return (
              <div
                key={app.key}
                data-flow-node={appNode(app.key)}
                className={`${styles.node} ${styles[`tone-${tone}`]} ${idle ? styles.nodeIdle : ''}`}
                {...hoverProps(appNode(app.key))}
              >
                <div className={styles.nodeHead}>
                  <div className={styles.nodeName}>
                    <Icon size={18} />
                    <span>{app.label}</span>
                  </div>
                  {withMetrics && <ToneChip tone={tone} />}
                </div>
                <div
                  className={styles.nodeSub}
                  title={`${app.databases.map((d) => d.name).join(', ')}${app.programs.length ? ` · ${uniquePrograms(app.programs).join(', ')}` : ''}`}
                >
                  <span className={`${styles.activityDot} ${app.active ? '' : styles.activityDotIdle}`} aria-hidden />
                  {env?.state === 'sin-datos'
                    ? `Sin métricas ${env.lastSampleAt ? formatAgo(env.lastSampleAt) : 'recientes'}`
                    : app.active
                      ? 'Activa'
                      : `En espera · ${formatAgo(app.lastActivity)}`}
                  {env?.isCurrent ? ' · este entorno' : ''}
                </div>
                <div className={styles.nodeStats}>
                  {withMetrics && env.state === 'activo' ? (
                    <>
                      <span>
                        <b>{env.reqPerMin == null ? '–' : formatValue(env.reqPerMin)}</b> pet./min
                      </span>
                      <span>
                        p95 <b>{formatMs(env.p95Ms)}</b>
                      </span>
                      {(env.errorPct ?? 0) > 0 && (
                        <span>
                          Errores <b>{formatValue(env.errorPct ?? 0, 2)} %</b>
                        </span>
                      )}
                      <span>
                        Procesos <b>{formatInt(env.processes.length)}</b>
                      </span>
                      {env.alerts && env.alerts.last24h > 0 && (
                        <span>
                          Alertas 24 h <b>{formatInt(env.alerts.last24h)}</b>
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span>
                        Sesiones <b>{formatInt(app.sessions)}</b>
                      </span>
                      {app.running > 0 && (
                        <span>
                          Ejecutando <b>{formatInt(app.running)}</b>
                        </span>
                      )}
                      <span>
                        {app.databases.length === 1 ? 'Base' : 'Bases'}{' '}
                        <b>{app.databases.length === 1 ? app.databases[0].name : formatInt(app.databases.length)}</b>
                      </span>
                    </>
                  )}
                </div>
                {env && envReason(env) && (
                  <div className={styles.nodeReason} title={env.log?.verdict?.title}>
                    {envReason(env)}
                  </div>
                )}
                {env?.state === 'sin-metricas' && app.kind === 'kronos' && (
                  <div className={styles.nodeSub}>Sin monitor instalado en esta base</div>
                )}
              </div>
            );
          })}
          {data.apps.length > apps.length && (
            <div className={styles.nodeSub} style={{ paddingLeft: 4 }}>
              y {formatInt(data.apps.length - apps.length)} aplicaciones más con poco uso
            </div>
          )}
        </div>

        {/* Máquinas */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Máquinas</div>
          {machines.map((m) => {
            const tone = machineTone(m);
            const progs = uniquePrograms(m.programs);
            return (
              <div
                key={m.name}
                data-flow-node={machineNode(m.name)}
                className={`${styles.node} ${styles[`tone-${tone}`]}`}
                {...hoverProps(machineNode(m.name))}
              >
                <div className={styles.nodeHead}>
                  <div className={styles.nodeName}>
                    {m.role === 'aplicaciones' ? <IconServer size={18} /> : <IconDeviceDesktop size={18} />}
                    <span>{m.name}</span>
                  </div>
                  {m.cpuPct != null && <ToneChip tone={tone} />}
                </div>
                <div className={styles.nodeSub} title={progs.join(', ')}>
                  {m.role === 'aplicaciones' ? 'Corre aplicaciones' : 'Equipo de una persona'}
                  {progs.length ? ` · ${progs.slice(0, 2).join(', ')}` : ''}
                </div>
                <div className={styles.nodeStats}>
                  {m.cpuPct != null && (
                    <span>
                      CPU <b>{formatValue(m.cpuPct)} %</b>
                    </span>
                  )}
                  {m.memPct != null && (
                    <span>
                      RAM <b>{formatValue(m.memPct)} %</b>
                      {m.memTotalMb ? ` de ${formatValue(m.memTotalMb / 1024, 0)} GB` : ''}
                    </span>
                  )}
                  <span>
                    Sesiones <b>{formatInt(m.sessions)}</b>
                  </span>
                </div>
              </div>
            );
          })}
          {localApps.length > 0 && (
            <div data-flow-node={LOCAL_NODE} className={`${styles.node} ${styles['tone-info']}`} {...hoverProps(LOCAL_NODE)}>
              <div className={styles.nodeName}>
                <IconServer size={18} />
                <span>{data.sqlServer.machine}</span>
              </div>
              <div className={styles.nodeSub} title={localApps.map((a) => a.label).join(', ')}>
                Mismo servidor de SQL · {localApps.length} {localApps.length === 1 ? 'servicio' : 'servicios'}
              </div>
            </div>
          )}
          {data.machines.length > machines.length && (
            <div className={styles.nodeSub} style={{ paddingLeft: 4 }}>
              y {formatInt(data.machines.length - machines.length)} máquinas más
            </div>
          )}
        </div>

        {/* SQL Server */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>SQL Server</div>
          <div data-flow-node={SQL_NODE} className={`${styles.node} ${styles[`tone-${sqlTone}`]}`} {...hoverProps(SQL_NODE)}>
            <div className={styles.nodeHead}>
              <div className={styles.nodeName}>
                <IconDatabase size={18} />
                <span>{data.sqlServer.machine}</span>
              </div>
              {data.sqlServer.hasServerState && <ToneChip tone={sqlTone} />}
            </div>
            <div className={styles.nodeSub}>
              {data.sqlServer.startedAt ? `Encendido desde ${formatDateTime(data.sqlServer.startedAt)}` : 'SQL Server compartido'}
            </div>
            {data.sqlServer.hasServerState ? (
              <div className={styles.nodeStats}>
                <span>
                  CPU SQL <b>{data.sqlServer.sqlCpuPct == null ? '–' : `${formatInt(data.sqlServer.sqlCpuPct)} %`}</b>
                </span>
                {(data.sqlServer.otherCpuPct ?? 0) > 0 && (
                  <span>
                    Otros <b>{formatInt(data.sqlServer.otherCpuPct)} %</b>
                  </span>
                )}
                <span>
                  RAM <b>{memUsedPct == null ? '–' : `${formatInt(memUsedPct)} %`}</b>
                  {data.sqlServer.memTotalMb ? ` de ${formatValue(data.sqlServer.memTotalMb / 1024, 0)} GB` : ''}
                </span>
                {data.sqlServer.sqlMemoryMb != null && (
                  <span>
                    SQL usa <b>{formatValue(data.sqlServer.sqlMemoryMb / 1024, 1)} GB</b>
                  </span>
                )}
                <span>
                  Sesiones en total <b>{formatInt(totalSessions)}</b>
                </span>
                {data.sqlServer.disks.map((d) => (
                  <span key={d.mount} title={`${formatValue(d.totalMb / 1024, 0)} GB en total`}>
                    Disco {d.mount.replace(/\\$/, '')} <b>{formatValue(d.freeMb / 1024, 0)} GB</b> libres
                  </span>
                ))}
                {data.sqlServer.cpus != null && (
                  <span>
                    Núcleos <b>{formatInt(data.sqlServer.cpus)}</b>
                  </span>
                )}
              </div>
            ) : (
              <div className={styles.nodeStats}>Sin permiso para ver la actividad del servidor</div>
            )}
            {data.inaccessible.length > 0 && (
              <div className={styles.nodeSub} title={data.inaccessible.join(', ')} style={{ marginTop: 8 }}>
                {formatInt(data.inaccessible.length)} bases sin acceso para Kronos (se ven solo sus conexiones)
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.flowLegend} aria-hidden>
        <span>
          <i className={styles.flowLegendLine} /> Más grueso = más sesiones o personas; más rápido = más actividad
        </span>
        <span>
          <i className={`${styles.flowLegendLine} ${styles.flowLegendIdle}`} /> Punteada y quieta = conectada sin actividad
        </span>
        <span>Pase el mouse por una tarjeta para ver solo sus conexiones</span>
      </div>
    </div>
  );
}
