import { prisma } from '../prisma';
import { createSgcMailer, type SgcEmailMessage, type SgcMailer } from '../sgc/email';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import {
  NOTIFY_DAYS_BEFORE,
  daysUntil,
  kindLabel,
  licenseTypeLabel,
  needsExpiryNotice,
  parseEmailList,
} from './software';

/**
 * job_type «it_software_expiry» (Dashboard TI, 2026-11-27), daily at 7:00 a. m.:
 * e-mails the «Correos de notificación» of every software / certificate /
 * domain that expires within NOTIFY_DAYS_BEFORE days, once per expiration date.
 * Uses the shared SynerLink mail service (API_EMAIL, same as the SGC alerts).
 */

type Row = {
  id: number;
  company: string | null;
  kind: string;
  description: string;
  provider: string | null;
  expirationDate: Date | null;
  licenses: number | null;
  assignedTo: string | null;
  licenseType: string | null;
  notifyEmails: string | null;
  noticeSentFor: Date | null;
};

const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  );
}

/** One message per recipient. Exported for the tests. */
export function buildExpiryMessages(r: Row, todayIso: string): SgcEmailMessage[] {
  const exp = day(r.expirationDate);
  const days = daysUntil(exp, todayIso);
  const kind = kindLabel(r.kind) || 'Software';
  const when = days === 0 ? 'vence hoy' : days === 1 ? 'vence mañana' : `vence en ${days} días`;
  const rows = [
    { label: 'Tipo', value: kind },
    { label: 'Descripción', value: r.description },
    { label: 'Empresa', value: cleanLabel(r.company, '—') },
    { label: 'Proveedor', value: r.provider?.trim() || '—' },
    { label: 'Fecha de vencimiento', value: formatLongDate(exp) },
    { label: 'Tipo de licencia', value: licenseTypeLabel(r.licenseType) || '—' },
    { label: 'Número de licencias', value: r.licenses == null ? '—' : String(r.licenses) },
    { label: 'Asignado a', value: r.assignedTo?.trim() || '—' },
  ];
  return parseEmailList(r.notifyEmails ?? '').map((to) => ({
    to,
    title: `${kind} por vencer: ${r.description} (${when})`,
    rows,
    outro: 'Aviso automático del Dashboard TI de SynerLink. Para cambiar los destinatarios, edite el registro en Tecnología → Dashboard TI → Software.',
  }));
}

export async function runSoftwareExpiryJob(
  mailer: SgcMailer = createSgcMailer(),
  todayIso: string = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
): Promise<{ ref: string; detail: string }> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT s.id, c.company, s.kind, s.description, s.provider, s.expiration_date AS expirationDate,
           s.licenses, s.assigned_to AS assignedTo, s.license_type AS licenseType,
           s.notify_emails AS notifyEmails, s.notice_sent_for AS noticeSentFor
    FROM it_software s
    LEFT JOIN company c ON c.id_company = s.id_company
    WHERE s.notify_emails IS NOT NULL AND s.expiration_date IS NOT NULL
      AND s.expiration_date >= CAST(${todayIso} AS date)
      AND s.expiration_date <= DATEADD(day, ${NOTIFY_DAYS_BEFORE}, CAST(${todayIso} AS date))
  `;

  let items = 0;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (isExcludedCompany(r.company)) continue;
    const item = {
      expirationDate: day(r.expirationDate),
      notifyEmails: parseEmailList(r.notifyEmails ?? ''),
      noticeSentFor: r.noticeSentFor ? day(r.noticeSentFor) : null,
    };
    if (!needsExpiryNotice(item, todayIso)) continue;

    const results = await mailer(buildExpiryMessages(r, todayIso));
    const ok = results.filter((x) => x.ok).length;
    sent += ok;
    failed += results.length - ok;
    items++;
    // Marked as notified only when at least one e-mail went out; otherwise it is retried tomorrow.
    if (ok > 0) {
      await prisma.$executeRaw`
        UPDATE it_software SET notice_sent_for = expiration_date, notice_sent_at = SYSUTCDATETIME() WHERE id = ${r.id}
      `;
    } else {
      console.error(`[it_software_expiry] no se pudo notificar el registro ${r.id}:`, results.map((x) => (x.ok ? '' : x.error)).join(' | '));
    }
  }

  return {
    ref: todayIso,
    detail: `Registros por vencer notificados: ${items}. Correos enviados: ${sent}. Fallidos: ${failed}.`,
  };
}
