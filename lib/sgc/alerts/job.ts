import { prisma } from '../../prisma';
import type { SgcAlertDeps, SgcAlertRunSummary } from '../db/reviewAlerts';
import { runDailySgcJob } from '../db/reviewAlerts';
import { createSgcMailer } from '../email';
import { sgcNotifier } from '../notifications';

/**
 * Job `sgc_review_alerts` del programador CENTRAL de SynerLink
 * (lib/scheduler, tablas scheduled_job/scheduled_job_run): lo registra
 * lib/scheduler/handlers.js y corre una vez al día (cron del job, 6:00 a. m.
 * de Colombia por defecto). El SGC solo aporta esta función; la toma
 * atómica del job y su registro de ejecución son del programador.
 */

export function sgcAlertDeps(): SgcAlertDeps {
  return { notifier: sgcNotifier, mailer: createSgcMailer(), appUrl: process.env.NEXTAUTH_URL || 'https://synerlink' };
}

/** Texto corto para scheduled_job_run.detail. */
export function summarizeRun(s: SgcAlertRunSummary): string {
  return `SGC ${s.runDate}: ${s.sent} aviso(s) de vencimiento, ${s.omitted} omitido(s), ${s.notified} notificación(es), ${s.emails} correo(s) (${s.emailErrors} con error), ${s.readingReminders} recordatorio(s) de lectura.`;
}

export async function runSgcScheduledJob(payload: { company?: number } | null, deps: SgcAlertDeps = sgcAlertDeps()): Promise<{ ref: string; detail: string }> {
  const summary = await runDailySgcJob(prisma, deps, { idCompany: payload?.company ?? null, source: 'programador' });
  return { ref: summary.runDate, detail: summarizeRun(summary) };
}
