"use client";

import { useState } from "react";
import {
  IconBellRinging,
  IconChevronDown,
  IconShieldCheck,
} from "@tabler/icons-react";
import { ToneChip } from "../system-metrics/StatusHero";
import { formatAgo, formatDateTime } from "../system-metrics/format";
import styles from "../system-metrics/monitor.module.css";

/**
 * Alertas tempranas del Monitor SAPSEND: mismo diseño que las del Monitor del sistema
 * (components/system-metrics/EarlyWarnings), con las reglas de lib/sapsend/earlyWarnings.js.
 * Se guardan en memoria del servidor (48 h) y por ahora no se envían por campana.
 */

export type SapsendAlert = {
  id: number;
  raisedAt: string;
  lastSeenAt: string;
  key: string;
  rule: string;
  severity: "warning" | "critical";
  title: string;
  happening: string;
  why: string;
  risk: string;
  action: string;
};

const COLLAPSED = 5;

const DETAIL_BLOCKS: Array<{
  field: "happening" | "why" | "risk" | "action";
  label: string;
}> = [
  { field: "happening", label: "Qué está pasando" },
  { field: "why", label: "Por qué importa" },
  { field: "risk", label: "Qué puede pasar si sigue" },
  { field: "action", label: "Qué hacer" },
];

export function SapsendEarlyWarnings({
  alerts,
  historyHours,
  watchList,
}: {
  alerts: SapsendAlert[];
  historyHours: number;
  watchList: string[];
}) {
  const [openId, setOpenId] = useState<number | null>(alerts[0]?.id ?? null);
  const [showAll, setShowAll] = useState(false);
  const [showWatch, setShowWatch] = useState(false);

  const visible = showAll ? alerts : alerts.slice(0, COLLAPSED);
  const critical = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className={styles.insightList} style={{ marginTop: 0 }}>
      {alerts.length === 0 ? (
        <div className={`${styles.insightRow} ${styles["tone-ok"]}`}>
          <div className={styles.insightIcon} aria-hidden>
            <IconShieldCheck size={17} stroke={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.insightTitle}>
              Sin alertas en las últimas {historyHours} horas
            </div>
            <div className={styles.insightDetail}>
              El monitor revisa cada 5 segundos las señales que anteceden a una
              lentitud de SAPSEND, Service Layer o SAP.
            </div>
          </div>
          <ToneChip tone="ok" label="Tranquilo" />
        </div>
      ) : (
        <>
          <div className={styles.alertSummary}>
            {alerts.length === 1 ? "1 alerta" : `${alerts.length} alertas`} en
            las últimas {historyHours} horas
            {critical > 0
              ? ` · ${critical === 1 ? "1 crítica" : `${critical} críticas`}`
              : ""}
          </div>
          {visible.map((a) => {
            const open = openId === a.id;
            const stillActive = Date.now() - Date.parse(a.lastSeenAt) < 30_000;
            return (
              <div key={a.id} className={styles.alertItem}>
                <button
                  type="button"
                  className={`${styles.insightRow} ${styles.alertRowButton} ${styles[`tone-${a.severity}`]}`}
                  onClick={() => setOpenId(open ? null : a.id)}
                  aria-expanded={open}
                >
                  <div className={styles.insightIcon} aria-hidden>
                    <IconBellRinging size={17} stroke={2} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.insightTitle}>{a.title}</div>
                    <div className={styles.insightDetail}>
                      {formatDateTime(a.raisedAt)} · {formatAgo(a.raisedAt)} ·{" "}
                      {stillActive
                        ? "sigue activa"
                        : `se apagó ${formatAgo(a.lastSeenAt)}`}
                    </div>
                  </div>
                  <span className={styles.alertChipCell}>
                    <ToneChip tone={a.severity} />
                    <IconChevronDown
                      size={16}
                      className={`${styles.alertChevron} ${open ? styles.alertChevronOpen : ""}`}
                      aria-hidden
                    />
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
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Ver menos" : `Ver las ${alerts.length} alertas`}
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => setShowWatch((v) => !v)}
        aria-expanded={showWatch}
      >
        {showWatch ? "Ocultar qué vigila el monitor" : "Qué vigila el monitor"}
      </button>
      {showWatch && (
        <ul className={styles.watchList}>
          {watchList.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
