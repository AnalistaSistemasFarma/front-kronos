import 'server-only';
import {
  alertsToNotify,
  evaluateEarlyWarnings,
  notificationPayload,
  type EarlyWarning,
  type LastAlert,
} from './earlyWarnings';
import { LOG_THRESHOLDS, type LogContext } from './logHealth';
import { insertAlert, readAlertSubscribers, readRecentAlerts, readWatchWindow } from './store';

/**
 * Corre las alertas tempranas (lib/system-metrics/earlyWarnings.ts) y avisa por campana + push a
 * quienes tienen el módulo Y activaron «Recibir alertas» (nadie por defecto). La llama el colector cada minuto, solo en la instancia 0 y después
 * de guardar su muestra, así que mira datos de hace segundos.
 *
 * El historial (system_metric_alert) es también el control de repetición: sin esa tabla la
 * consulta falla con 208 y el colector pausa las alertas en vez de enviarlas sin control.
 *
 * Activación: SYSTEM_ALERTS_ENABLED=true|false; por defecto, igual que el colector (solo en
 * producción). SYSTEM_ALERTS_EXPECTED_PROCESSES = copias de Kronos que deberían correr (2).
 */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;

export type AlertNotification = { title: string; body: string; url: string; tag: string };

export type AlertJobDeps = {
  /** Quién recibe: tiene el módulo Y activó «Recibir alertas» (por defecto, nadie). */
  recipients: (pool: Pool) => Promise<string[]>;
  notify: (emails: string[], payload: AlertNotification) => Promise<void>;
  /** Estado del log de la base para juzgarlo bien (logHealth.ts); sin él se usan umbrales fijos. */
  logContext?: (pool: Pool) => Promise<LogContext | null>;
};

export const ALERTS_URL = '/process/system-metrics#alertas';
const WINDOW_MIN = 75;

export function isEarlyWarningEnabled(): boolean {
  const flag = process.env.SYSTEM_ALERTS_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function expectedProcesses(): number {
  const n = Number(process.env.SYSTEM_ALERTS_EXPECTED_PROCESSES);
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : 2;
}

export async function defaultAlertDeps(): Promise<AlertJobDeps> {
  const [{ listSystemMetricsRecipients }, { createAndSendNotifications }, { readLogContext }] = await Promise.all([
    import('./access'),
    import('../notifications.js'),
    import('./dbProbe'),
  ]);
  return {
    recipients: async (pool) => {
      // Sin la tabla de suscriptores (2026-10-09-...-suscriptores.sql) no se avisa a nadie.
      const [withModule, subscribers] = await Promise.all([
        listSystemMetricsRecipients(),
        readAlertSubscribers(pool),
      ]);
      return withModule.filter((email) => subscribers.has(email));
    },
    notify: async (emails, payload) => {
      await createAndSendNotifications(emails, payload);
    },
    logContext: (pool) => readLogContext(pool),
  };
}

export async function runEarlyWarnings(
  pool: Pool,
  host: string,
  deps: AlertJobDeps,
  now: Date = new Date()
): Promise<{ active: EarlyWarning[]; notified: EarlyWarning[] }> {
  const { samples, db } = await readWatchWindow(pool, WINDOW_MIN);
  // El contexto del log solo cambia el veredicto desde el umbral de aviso: no se consulta antes.
  const lastLog = [...db].sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt)).pop()?.logUsedPct ?? null;
  const logContext =
    deps.logContext && lastLog != null && lastLog >= LOG_THRESHOLDS.warningPct
      ? await deps.logContext(pool).catch(() => null)
      : null;
  const active = evaluateEarlyWarnings({ now, samples, db, expectedProcesses: expectedProcesses(), logContext });
  if (!active.length) return { active, notified: [] };

  const last = new Map<string, LastAlert>();
  for (const a of await readRecentAlerts(pool, 24, 500)) {
    if (!last.has(a.key)) last.set(a.key, { severity: a.severity, raisedAt: a.raisedAt });
  }
  const pending = alertsToNotify(active, last, now);
  if (!pending.length) return { active, notified: [] };

  let emails: string[] = [];
  try {
    emails = await deps.recipients(pool);
  } catch (error) {
    console.warn('[system-metrics] No se pudo leer quién recibe las alertas:', error);
  }

  for (const w of pending) {
    // Se registra antes de enviar: si el envío falla, no se reintenta en cada minuto.
    await insertAlert(pool, now, host, w, emails.length);
    if (!emails.length) continue;
    const { title, body } = notificationPayload(w);
    try {
      await deps.notify(emails, { title, body, url: ALERTS_URL, tag: `system-alert-${w.rule}` });
    } catch (error) {
      console.error('[system-metrics] No se pudo enviar la alerta:', w.key, error);
    }
  }
  return { active, notified: pending };
}
