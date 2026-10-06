'use client';

import type { CSSProperties } from 'react';
import { IconChevronRight, IconCloud, IconDatabase, IconServer2, IconUsers } from '@tabler/icons-react';
import type { StatusTone } from './colors';
import { formatInt, formatMs, formatValue } from './format';
import { ToneChip } from './StatusHero';
import styles from './monitor.module.css';

export type MapData = {
  users: { reqPerMin: number | null; p95Ms: number | null; tone: StatusTone };
  instances: Array<{ key: string; name: string; cpuPct: number | null; rssMb: number | null; eventLoopMs: number | null; tone: StatusTone }>;
  sql: {
    tone: StatusTone;
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
};

/** Velocidad de la animación según tráfico: más peticiones, puntos más rápidos. */
function flowStyle(perMin: number | null): CSSProperties {
  const v = perMin ?? 0;
  const seconds = v <= 0 ? 4 : Math.max(0.8, 3.2 - Math.log10(v + 1));
  return { ['--flow-speed' as string]: `${seconds.toFixed(2)}s` };
}

function Connector({ perMin, label }: { perMin: number | null; label: string }) {
  return (
    <div className={styles.connector} aria-hidden>
      <div className={styles.connectorLine} style={flowStyle(perMin)}>
        {perMin != null && perMin > 0 && <span className={styles.flowDot} />}
      </div>
      <span className={styles.connectorLabel}>{label}</span>
    </div>
  );
}

export function SystemMap({ data, onSelectExternal }: { data: MapData; onSelectExternal: (key: string, label: string) => void }) {
  const reqLabel = data.users.reqPerMin == null ? 'sin datos' : `${formatValue(data.users.reqPerMin)} pet./min`;

  return (
    <div className={styles.map} role="group" aria-label="Mapa del sistema">
      <div className={styles.mapColumn}>
        <div className={`${styles.node} ${styles[`tone-${data.users.tone}`]}`}>
          <div className={styles.nodeHead}>
            <div className={styles.nodeName}>
              <IconUsers size={18} />
              <span>Usuarios</span>
            </div>
          </div>
          <div className={styles.nodeStats}>
            <span>
              <b>{reqLabel}</b>
            </span>
            <span>
              p95 <b>{formatMs(data.users.p95Ms)}</b>
            </span>
          </div>
        </div>
      </div>

      <Connector perMin={data.users.reqPerMin} label={reqLabel} />

      <div className={styles.mapColumn}>
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
          <div key={inst.key} className={`${styles.node} ${styles[`tone-${inst.tone}`]}`}>
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

      <Connector
        perMin={data.users.reqPerMin}
        label={data.sql.poolInUse == null ? 'conexiones' : `${formatInt(data.sql.poolInUse)} conexiones en uso`}
      />

      <div className={styles.mapColumn}>
        <div className={`${styles.node} ${styles[`tone-${data.sql.tone}`]}`}>
          <div className={styles.nodeHead}>
            <div className={styles.nodeName}>
              <IconDatabase size={18} />
              <span>SQL Server</span>
            </div>
            <ToneChip tone={data.sql.tone} />
          </div>
          <div className={styles.nodeStats}>
            {data.sql.hasServerState === false ? (
              <span>Sin permiso para ver la actividad</span>
            ) : (
              <>
                <span>
                  CPU <b>{data.sql.cpuPct == null ? '–' : `${formatValue(data.sql.cpuPct)} %`}</b>
                </span>
                <span>
                  Sesiones <b>{formatInt(data.sql.sessions)}</b>
                </span>
                <span>
                  Bloqueos <b>{formatInt(data.sql.blocked)}</b>
                </span>
              </>
            )}
          </div>
        </div>

        {data.externals.map((ext) => (
          <button
            key={ext.key}
            type="button"
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
    </div>
  );
}
