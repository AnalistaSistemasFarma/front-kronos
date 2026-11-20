import 'server-only';
import { alertsToNotify, notificationPayload, type EarlyWarning, type LastAlert } from '../system-metrics/earlyWarnings';
import { insertAlert, readRecentAlerts } from '../system-metrics/store';

/**
 * Sends SAP monitor alerts through the SAME mechanism as the Monitor del sistema: history in
 * dbo.system_metric_alert (also the de-duplication control), bell + push to whoever has the module
 * AND switched on «Recibir alertas» (Nicolás, Ing. Cristian…). One key per incident: the same
 * blocking chain / node / view never repeats inside the cooldown unless it escalates to critical.
 *
 * Optional: SAP_MONITOR_TEAMS_WEBHOOK_URL (Teams «Workflows» incoming webhook) gets the same text.
 */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;

export const SAP_ALERTS_URL = '/process/system-metrics#sap-db';

export function sapAlertsEnabled(): boolean {
  const flag = process.env.SAP_MONITOR_ALERTS_ENABLED ?? process.env.SYSTEM_ALERTS_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

async function postTeams(w: EarlyWarning): Promise<void> {
  const url = process.env.SAP_MONITOR_TEAMS_WEBHOOK_URL?.trim();
  if (!url || !/^https:\/\//i.test(url)) return;
  const { title, body } = notificationPayload(w);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: title, weight: 'Bolder', wrap: true },
                { type: 'TextBlock', text: body, wrap: true },
                { type: 'TextBlock', text: `Qué hacer: ${w.action}`, wrap: true, isSubtle: true },
              ],
            },
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function raiseSapAlerts(pool: Pool, host: string, active: EarlyWarning[], now = new Date()): Promise<EarlyWarning[]> {
  if (!active.length || !sapAlertsEnabled()) return [];
  const last = new Map<string, LastAlert>();
  for (const a of await readRecentAlerts(pool, 24, 500)) {
    if (!last.has(a.key)) last.set(a.key, { severity: a.severity, raisedAt: a.raisedAt });
  }
  const pending = alertsToNotify(active, last, now);
  if (!pending.length) return [];

  const { defaultAlertDeps } = await import('../system-metrics/alertJob');
  const deps = await defaultAlertDeps();
  let emails: string[] = [];
  try {
    emails = await deps.recipients(pool);
  } catch (error) {
    console.warn('[sap-monitor] No se pudo leer quién recibe las alertas:', error);
  }
  for (const w of pending) {
    // Recorded before sending: if sending fails it is not retried every minute.
    await insertAlert(pool, now, host, w, emails.length);
    const { title, body } = notificationPayload(w);
    if (emails.length) {
      await deps
        .notify(emails, { title, body, url: SAP_ALERTS_URL, tag: `sap-alert-${w.rule}` })
        .catch((error) => console.error('[sap-monitor] No se pudo enviar la alerta:', w.key, error));
    }
    await postTeams(w).catch((error) => console.warn('[sap-monitor] Teams:', error instanceof Error ? error.message : error));
  }
  return pending;
}
