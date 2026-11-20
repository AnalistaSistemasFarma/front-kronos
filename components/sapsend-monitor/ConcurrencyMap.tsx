'use client';

import { useMemo, useState } from 'react';
import { IconAppWindow, IconBuildingFactory2, IconDatabase, IconDeviceDesktop, IconServer } from '@tabler/icons-react';
import type { StatusTone } from '../system-metrics/colors';
import { FlowLayer, flowWeights, type FlowEdge } from '../system-metrics/FlowLayer';
import { formatInt, formatMs, programLabel } from '../system-metrics/format';
import { ToneChip } from '../system-metrics/StatusHero';
import styles from '../system-metrics/monitor.module.css';

/**
 * Mapa de concurrencia de los SAPSEND (mismo lenguaje que la vista general del Monitor del
 * sistema): Equipos → SAPSEND de cada empresa → Service Layer → SAP.
 * Todo sale directo de los SAPSEND (sesiones en sus bases) y del pulso del Service Layer;
 * no incluye a SynerLink. Grosor = sesiones; velocidad = consultas activas.
 */

export type MapCompany = {
  idCompany: number | null;
  company: string;
  sapsendDb: string;
  status: 'ok' | 'warning' | 'critical' | 'idle';
  sl: {
    host: string;
    companyDB?: string | null;
    pulse: { ok: boolean; status: number; latencyMs: number | null; error: string | null };
  } | null;
  sapsend: { sessions: number; running: number; blocked: number; hosts: number; logins: number };
  queries: { perMin: number; slowNow: number };
};

export type MapConnection = {
  database: string;
  host: string;
  program: string;
  login: string;
  sessions: number;
  running: number;
};

const MAX_HOSTS = 8;
const hostNode = (h: string) => `sm-h-${h}`;
const ssNode = (db: string) => `sm-ss-${db}`;
const slNode = (host: string) => `sm-sl-${host}`;
const sapNode = (db: string) => `sm-sap-${db}`;

function pulseTone(p: { ok: boolean; latencyMs: number | null }): StatusTone {
  if (!p.ok) return 'critical';
  if ((p.latencyMs ?? 0) >= 3000) return 'warning';
  return 'ok';
}

export function ConcurrencyMap({ companies, connections }: { companies: MapCompany[]; connections: MapConnection[] }) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const model = useMemo(() => {
    const dbs = new Set(companies.map((c) => c.sapsendDb.toLowerCase()));
    const conns = connections.filter((x) => dbs.has(x.database.toLowerCase()));

    // Equipos (los que más sesiones tienen en las bases SAPSEND)
    const hostMap = new Map<string, { host: string; sessions: number; running: number; programs: Set<string>; logins: Set<string> }>();
    for (const x of conns) {
      const h = hostMap.get(x.host) ?? { host: x.host, sessions: 0, running: 0, programs: new Set(), logins: new Set() };
      h.sessions += x.sessions;
      h.running += x.running;
      if (x.program) h.programs.add(programLabel(x.program));
      if (x.login) h.logins.add(x.login);
      hostMap.set(x.host, h);
    }
    const hosts = [...hostMap.values()].sort((a, b) => b.sessions - a.sessions).slice(0, MAX_HOSTS);
    const hostSet = new Set(hosts.map((h) => h.host));

    // Servidores de Service Layer (varias empresas comparten uno)
    const slMap = new Map<string, { host: string; companies: MapCompany[] }>();
    for (const c of companies) {
      if (!c.sl) continue;
      const s = slMap.get(c.sl.host) ?? { host: c.sl.host, companies: [] };
      s.companies.push(c);
      slMap.set(c.sl.host, s);
    }
    const sls = [...slMap.values()];

    const edges: FlowEdge[] = [];
    // Equipo → SAPSEND
    const links = new Map<string, { host: string; db: string; sessions: number; running: number }>();
    for (const x of conns) {
      if (!hostSet.has(x.host)) continue;
      const k = `${x.host}|${x.database.toLowerCase()}`;
      const l = links.get(k) ?? { host: x.host, db: x.database, sessions: 0, running: 0 };
      l.sessions += x.sessions;
      l.running += x.running;
      links.set(k, l);
    }
    const linkList = [...links.values()];
    const lw = flowWeights(linkList.map((l) => l.sessions));
    linkList.forEach((l, i) => {
      const company = companies.find((c) => c.sapsendDb.toLowerCase() === l.db.toLowerCase());
      if (!company) return;
      edges.push({
        id: `h-${l.host}-${l.db}`,
        from: hostNode(l.host),
        to: ssNode(company.sapsendDb),
        weight: Math.max(0.12, lw[i]),
        rate: l.running > 0 ? l.running * 20 : 0,
        tone: l.running > 0 ? 'info' : 'idle',
        title: `${l.host} → ${company.sapsendDb}: ${formatInt(l.sessions)} sesiones${l.running ? `, ${formatInt(l.running)} activas` : ''}`,
      });
    });
    // SAPSEND → Service Layer de su empresa
    const sw = flowWeights(companies.map((c) => c.sapsend.sessions));
    companies.forEach((c, i) => {
      if (!c.sl) return;
      const tone = c.sapsend.blocked > 0 ? 'critical' : pulseTone(c.sl.pulse);
      edges.push({
        id: `s-${c.sapsendDb}`,
        from: ssNode(c.sapsendDb),
        to: slNode(c.sl.host),
        weight: Math.max(0.12, sw[i]),
        rate: c.queries.perMin > 0 ? c.queries.perMin : c.sapsend.running * 20,
        tone: tone === 'ok' ? 'info' : tone,
        title: `SAPSEND ${c.company} → Service Layer ${c.sl.host}`,
      });
    });

    // Service Layer → base de la empresa en SAP
    const saps = companies.filter((c) => c.sl?.companyDB);
    saps.forEach((c) => {
      const tone = pulseTone(c.sl!.pulse);
      edges.push({
        id: `sap-${c.sapsendDb}`,
        from: slNode(c.sl!.host),
        to: sapNode(c.sl!.companyDB!),
        weight: 0.3,
        rate: c.sl!.pulse.ok ? 2 : 0,
        tone: tone === 'ok' ? 'info' : tone,
        title: `Service Layer ${c.sl!.host} → ${c.sl!.companyDB}`,
      });
    });

    return { hosts, sls, saps, edges, extraHosts: Math.max(0, hostMap.size - hosts.length) };
  }, [companies, connections]);

  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((h) => (h === id ? null : h)),
    onFocus: () => setHover(id),
    onBlur: () => setHover((h) => (h === id ? null : h)),
    tabIndex: 0,
  });

  return (
    <div ref={setStage} className={styles.flowStage} role="group" aria-label="Mapa de concurrencia de los SAPSEND">
      <FlowLayer container={stage} edges={model.edges} highlight={hover} />
      <div className={styles.flowGrid}>
        {/* Equipos */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Equipos conectados</div>
          {model.hosts.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconDeviceDesktop size={18} />
                <span>Sin conexiones ahora</span>
              </div>
            </div>
          )}
          {model.hosts.map((h) => (
            <div
              key={h.host}
              data-flow-node={hostNode(h.host)}
              className={`${styles.node} ${styles[h.running > 0 ? 'tone-info' : 'tone-idle']}`}
              {...hoverProps(hostNode(h.host))}
            >
              <div className={styles.nodeName}>
                <IconServer size={18} />
                <span>{h.host}</span>
              </div>
              <div className={styles.nodeSub} title={[...h.programs].join(', ')}>
                {[...h.programs].slice(0, 2).join(', ') || 'Programa desconocido'}
              </div>
              <div className={styles.nodeStats}>
                <span>
                  Sesiones <b>{formatInt(h.sessions)}</b>
                </span>
                {h.running > 0 && (
                  <span>
                    Activas <b>{formatInt(h.running)}</b>
                  </span>
                )}
                <span>
                  Usuarios SQL <b>{formatInt(h.logins.size)}</b>
                </span>
              </div>
            </div>
          ))}
          {model.extraHosts > 0 && (
            <div className={styles.nodeSub} style={{ paddingLeft: 4 }}>
              y {formatInt(model.extraHosts)} equipos más
            </div>
          )}
        </div>

        {/* SAPSEND por empresa */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>SAPSEND por empresa</div>
          {companies.map((c) => {
            const tone: StatusTone = c.sapsend.blocked > 0 ? 'critical' : c.queries.slowNow > 0 ? 'warning' : c.sapsend.sessions > 0 ? 'info' : 'idle';
            return (
              <div
                key={c.sapsendDb}
                data-flow-node={ssNode(c.sapsendDb)}
                className={`${styles.node} ${styles[`tone-${tone}`]} ${tone === 'idle' ? styles.nodeIdle : ''}`}
                {...hoverProps(ssNode(c.sapsendDb))}
              >
                <div className={styles.nodeHead}>
                  <div className={styles.nodeName}>
                    <IconAppWindow size={18} />
                    <span>{c.company}</span>
                  </div>
                  {(tone === 'critical' || tone === 'warning') && <ToneChip tone={tone} />}
                </div>
                <div className={styles.nodeSub} title={c.sapsendDb}>
                  <span className={`${styles.activityDot} ${c.sapsend.running > 0 ? '' : styles.activityDotIdle}`} aria-hidden />
                  {c.sapsendDb}
                </div>
                <div className={styles.nodeStats}>
                  <span>
                    Sesiones <b>{formatInt(c.sapsend.sessions)}</b>
                  </span>
                  <span>
                    Activas <b>{formatInt(c.sapsend.running)}</b>
                  </span>
                  {c.queries.perMin > 0 && (
                    <span>
                      Consultas <b>{formatInt(Math.round(c.queries.perMin))}/min</b>
                    </span>
                  )}
                  {c.sapsend.blocked > 0 && (
                    <span>
                      Bloqueadas <b>{formatInt(c.sapsend.blocked)}</b>
                    </span>
                  )}
                  <span>
                    Equipos <b>{formatInt(c.sapsend.hosts)}</b>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Service Layer */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Service Layer</div>
          {model.sls.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconBuildingFactory2 size={18} />
                <span>Sin Service Layer configurado</span>
              </div>
            </div>
          )}
          {model.sls.map((s) => {
            const pulses = s.companies.map((c) => c.sl!.pulse);
            const down = pulses.some((p) => !p.ok);
            const ms = Math.max(0, ...pulses.map((p) => p.latencyMs ?? 0));
            const tone: StatusTone = down ? 'critical' : ms >= 3000 ? 'warning' : 'ok';
            return (
              <div
                key={s.host}
                data-flow-node={slNode(s.host)}
                className={`${styles.node} ${styles[`tone-${tone}`]}`}
                {...hoverProps(slNode(s.host))}
              >
                <div className={styles.nodeHead}>
                  <div className={styles.nodeName}>
                    <IconBuildingFactory2 size={18} />
                    <span>{s.host}</span>
                  </div>
                  <ToneChip tone={tone} />
                </div>
                <div className={styles.nodeSub} title={s.companies.map((c) => c.company).join(', ')}>
                  {s.companies.length} {s.companies.length === 1 ? 'empresa' : 'empresas'} ·{' '}
                  {s.companies.map((c) => c.company).join(', ')}
                </div>
                <div className={styles.nodeStats}>
                  <span>
                    Pulso <b>{down ? 'Sin respuesta' : formatMs(ms)}</b>
                  </span>
                </div>
                {down && <div className={styles.nodeReason}>{pulses.find((p) => !p.ok)?.error}</div>}
              </div>
            );
          })}
        </div>

        {/* SAP */}
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>SAP (base de cada empresa)</div>
          {model.saps.length === 0 && (
            <div className={`${styles.node} ${styles['tone-idle']}`}>
              <div className={styles.nodeName}>
                <IconDatabase size={18} />
                <span>Sin bases SAP configuradas</span>
              </div>
            </div>
          )}
          {model.saps.map((c) => {
            const tone = pulseTone(c.sl!.pulse);
            return (
              <div
                key={c.sapsendDb}
                data-flow-node={sapNode(c.sl!.companyDB!)}
                className={`${styles.node} ${styles[`tone-${tone}`]}`}
                {...hoverProps(sapNode(c.sl!.companyDB!))}
              >
                <div className={styles.nodeName}>
                  <IconDatabase size={18} />
                  <span>{c.company}</span>
                </div>
                <div className={styles.nodeSub} title={c.sl!.companyDB ?? ''}>
                  {c.sl!.companyDB}
                </div>
                <div className={styles.nodeStats}>
                  <span>{c.sl!.pulse.ok ? 'Alcanzable por Service Layer' : 'Sin acceso: Service Layer caído'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.flowLegend} aria-hidden>
        <span>
          <i className={styles.flowLegendLine} /> Más grueso = más sesiones; más rápido = más consultas
        </span>
        <span>
          <i className={`${styles.flowLegendLine} ${styles.flowLegendIdle}`} /> Punteada y quieta = conectada sin actividad
        </span>
        <span>Pase el mouse por una tarjeta para ver solo sus conexiones</span>
      </div>
    </div>
  );
}
