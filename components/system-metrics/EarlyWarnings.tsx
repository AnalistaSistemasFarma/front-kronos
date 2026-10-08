'use client';

import { useState } from 'react';
import { Alert, Code } from '@mantine/core';
import { IconBellRinging, IconChevronDown, IconDatabase, IconShieldCheck } from '@tabler/icons-react';
import { WATCH_LIST } from '../../lib/system-metrics/earlyWarnings';
import { ToneChip } from './StatusHero';
import { formatAgo, formatDateTime } from './format';
import type { AlertRow } from './types';
import styles from './monitor.module.css';

const COLLAPSED = 5;

const DETAIL_BLOCKS: Array<{ field: 'happening' | 'why' | 'risk' | 'action'; label: string }> = [
  { field: 'happening', label: 'Qué está pasando' },
  { field: 'why', label: 'Por qué suele pasar' },
  { field: 'risk', label: 'Qué puede pasar si sigue' },
  { field: 'action', label: 'Qué hacer' },
];

/**
 * Historial de alertas tempranas (lib/system-metrics/earlyWarnings.ts). Cada alerta se envió por
 * campana y push a quienes tienen el módulo; aquí se lee el detalle completo.
 */
export function EarlyWarnings({
  alerts,
  tableMissing,
  historyHours,
}: {
  alerts: AlertRow[];
  tableMissing: boolean;
  historyHours: number;
}) {
  const [openId, setOpenId] = useState<number | null>(alerts[0]?.id ?? null);
  const [showAll, setShowAll] = useState(false);
  const [showWatch, setShowWatch] = useState(false);

  if (tableMissing) {
    return (
      <Alert color="yellow" icon={<IconDatabase size={16} />} title="Las alertas tempranas están apagadas" radius="lg">
        Falta correr <Code>prisma/manual/2026-10-07-system-metrics-alertas.sql</Code> en esta base. Sin esa tabla no se envían
        avisos (para no repetirlos sin control). El resto del monitor funciona normal.
      </Alert>
    );
  }

  const visible = showAll ? alerts : alerts.slice(0, COLLAPSED);
  const critical = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className={styles.insightList} style={{ marginTop: 0 }}>
      {alerts.length === 0 ? (
        <div className={`${styles.insightRow} ${styles['tone-ok']}`}>
          <div className={styles.insightIcon} aria-hidden>
            <IconShieldCheck size={17} stroke={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.insightTitle}>Sin alertas en las últimas {historyHours} horas</div>
            <div className={styles.insightDetail}>
              El monitor revisa cada minuto las señales que anteceden a una caída y avisa por la campana y con notificación push.
            </div>
          </div>
          <ToneChip tone="ok" label="Tranquilo" />
        </div>
      ) : (
        <>
          <div className={styles.alertSummary}>
            {alerts.length === 1 ? '1 alerta' : `${alerts.length} alertas`} en las últimas {historyHours} horas
            {critical > 0 ? ` · ${critical === 1 ? '1 crítica' : `${critical} críticas`}` : ''}
          </div>
          {visible.map((a) => {
            const open = openId === a.id;
            const tone = a.severity;
            return (
              <div key={a.id} className={styles.alertItem}>
                <button
                  type="button"
                  className={`${styles.insightRow} ${styles.alertRowButton} ${styles[`tone-${tone}`]}`}
                  onClick={() => setOpenId(open ? null : a.id)}
                  aria-expanded={open}
                >
                  <div className={styles.insightIcon} aria-hidden>
                    <IconBellRinging size={17} stroke={2} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.insightTitle}>{a.title}</div>
                    <div className={styles.insightDetail}>
                      {formatDateTime(a.raisedAt)} · {formatAgo(a.raisedAt)} ·{' '}
                      {a.notified === 0
                        ? 'nadie tiene el módulo asignado para recibirla'
                        : a.notified === 1
                          ? 'enviada a 1 persona'
                          : `enviada a ${a.notified} personas`}
                    </div>
                  </div>
                  <span className={styles.alertChipCell}>
                    <ToneChip tone={tone} />
                    <IconChevronDown size={16} className={`${styles.alertChevron} ${open ? styles.alertChevronOpen : ''}`} aria-hidden />
                  </span>
                </button>
                {open && (
                  <div className={styles.alertBody}>
                    {DETAIL_BLOCKS.map((b) => (
                      <div key={b.field}>
                        <div className={styles.alertLabel}>{b.label}</div>
                        <div className={styles.alertText}>{a[b.field]}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {alerts.length > COLLAPSED && (
            <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Ver menos' : `Ver las ${alerts.length} alertas`}
            </button>
          )}
        </>
      )}
      <button type="button" className={styles.linkButton} onClick={() => setShowWatch((v) => !v)} aria-expanded={showWatch}>
        {showWatch ? 'Ocultar qué vigila el monitor' : 'Qué vigila el monitor'}
      </button>
      {showWatch && (
        <ul className={styles.watchList}>
          {WATCH_LIST.map((w) => (
            <li key={w.rule}>{w.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
