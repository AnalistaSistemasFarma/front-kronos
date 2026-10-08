import { getSgcAccessForUser } from '../access';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import { buildIcalendar, icalTokenHash, isIcalTokenShape, newIcalToken, type SgcIcalEvent } from '../ical';
import type { SgcCompanyAccess } from '../permissions';
import { SGC_CALENDAR_STATE_LABELS } from '../reviewAlerts';
import type { SgcActor, SgcDb } from './catalogs';
import { getAccessSubject } from './documents';
import { listReviewCalendar } from './reviewAlerts';

/**
 * Enlace iCal privado por persona (Sprint 5). La persona crea su enlace (se
 * le muestra UNA vez; se guarda solo su SHA-256) y lo suscribe en Outlook. Al
 * consultarlo, el calendario se arma con los permisos ACTUALES de esa persona:
 * si pierde el acceso al SGC o el enlace se revoca, deja de recibir datos.
 */

export function icalFeedPath(token: string): string {
  return `/api/sgc/ical/${token}`;
}

/** Crea (o reemplaza) el enlace de la persona en la empresa; revoca el anterior. */
export async function createIcalToken(db: SgcDb, access: SgcCompanyAccess, actor: SgcActor, now: Date = new Date()): Promise<{ token: string; path: string }> {
  if (!access.canRead) throw new SgcError('Sin acceso al SGC de la empresa.', 403);
  const email = actor.email.toLowerCase();
  const token = newIcalToken();
  await db.$transaction(async (tx) => {
    const revoked = await tx.sgcIcalToken.updateMany({ where: { id_company: access.idCompany, user_email: email, revoked_at: null }, data: { revoked_at: now, revoked_by: email } });
    const saved = await tx.sgcIcalToken.create({ data: { id_company: access.idCompany, user_email: email, token_sha256: icalTokenHash(token) } });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: email,
      action: SGC_AUDIT_ACTIONS.icalCreado,
      entity: 'ical_token',
      entityId: saved.id_ical_token,
      after: { id: saved.id_ical_token, replaced: revoked.count },
      detail: `Enlace iCal privado creado${revoked.count ? ' (el anterior quedó revocado)' : ''}.`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return { token, path: icalFeedPath(token) };
}

export async function getIcalStatus(db: SgcDb, access: SgcCompanyAccess, email: string) {
  const row = await db.sgcIcalToken.findFirst({ where: { id_company: access.idCompany, user_email: email.toLowerCase(), revoked_at: null } });
  return row ? { active: true, createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null, useCount: row.use_count } : { active: false, createdAt: null, lastUsedAt: null, useCount: 0 };
}

export async function revokeIcalToken(db: SgcDb, access: SgcCompanyAccess, actor: SgcActor, now: Date = new Date()): Promise<{ revoked: number }> {
  const email = actor.email.toLowerCase();
  const rows = await db.sgcIcalToken.findMany({ where: { id_company: access.idCompany, user_email: email, revoked_at: null } });
  if (rows.length === 0) throw new SgcError('No tiene un enlace iCal activo.', 404);
  await db.$transaction(async (tx) => {
    await tx.sgcIcalToken.updateMany({ where: { id_ical_token: { in: rows.map((r) => r.id_ical_token) } }, data: { revoked_at: now, revoked_by: email } });
    await writeSgcAudit(tx, { idCompany: access.idCompany, actorEmail: email, action: SGC_AUDIT_ACTIONS.icalRevocado, entity: 'ical_token', entityId: rows[0].id_ical_token, detail: 'Enlace iCal privado revocado.', ip: actor.ip, userAgent: actor.userAgent });
  });
  return { revoked: rows.length };
}

/**
 * Calendario iCal del enlace (sin sesión: Outlook no la tiene). Devuelve null
 * si el token no existe, está revocado o la persona ya no tiene acceso (la
 * ruta responde 404 sin decir por qué).
 */
export async function getIcalFeed(db: SgcDb, token: string, meta: { ip?: string | null; userAgent?: string | null; appUrl: string }, now: Date = new Date()): Promise<string | null> {
  if (!isIcalTokenShape(token)) return null;
  const row = await db.sgcIcalToken.findUnique({ where: { token_sha256: icalTokenHash(token) } });
  if (!row || row.revoked_at) return null;
  const access = (await getSgcAccessForUser(db, row.user_email)).find((a) => a.idCompany === row.id_company);
  const user = await db.user.findFirst({ where: { email: row.user_email }, select: { isActive: true } });
  if (!access?.canRead || !user?.isActive) return null;
  const subject = await getAccessSubject(db, row.user_email);
  const { items } = await listReviewCalendar(db, access, subject, now);
  const base = meta.appUrl.replace(/\/+$/, '');
  const events: SgcIcalEvent[] = items
    .filter((i) => i.dueDate && i.idVersion)
    .map((i) => ({
      uid: `sgc-${row.id_company}-doc${i.idDocument}-v${i.idVersion}@synerlink`,
      date: i.dueDate!,
      summary: `Vence revisión: ${i.code} V${i.versionNumber}${i.confidentiality === 'confidencial' ? '' : ` · ${i.title}`}`,
      description: `${SGC_CALENDAR_STATE_LABELS[i.state]}. ${i.process}. Avisos: ${i.offsets.join(', ')} días antes.${i.openRequestId ? ` Solicitud #${i.openRequestId} en curso.` : ''}`,
      url: `${base}/process/sgc-documental/documentos/${i.idDocument}?empresa=${row.id_company}`,
    }));
  await db.$transaction(async (tx) => {
    await tx.sgcIcalToken.update({ where: { id_ical_token: row.id_ical_token }, data: { last_used_at: now, use_count: { increment: 1 } } });
    await writeSgcAudit(tx, {
      idCompany: row.id_company,
      actorEmail: row.user_email,
      action: SGC_AUDIT_ACTIONS.icalConsulta,
      entity: 'ical_token',
      entityId: row.id_ical_token,
      detail: `Consulta del calendario iCal (${events.length} vencimientos).`,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  });
  return buildIcalendar(events, { calendarName: 'Documentos · vencimientos', now });
}
