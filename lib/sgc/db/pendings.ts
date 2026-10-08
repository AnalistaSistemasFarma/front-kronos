import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import type { SgcEmailMessage, SgcMailer } from '../email';
import { buildDigestMessage, countPendings, pendingGroupOf, type SgcPendingCounts, type SgcPendingGroup } from '../pendings';
import type { SgcCompanyAccess } from '../permissions';
import { formatCalendarDate } from '../review';
import { colombiaToday } from './vigencia';
import type { SgcDb } from './catalogs';
import { listTaskInbox } from './requests';
import { countCopiesToDecide } from './uncontrolledCopies';

/**
 * «MIS PENDIENTES DEL SGC» (tablero de la entrada del módulo) y POLÍTICA DE
 * CORREO por empresa con su RESUMEN DIARIO (Sprint 9).
 */

/** Pendientes de otros módulos del SGC que se suman al tablero (las copias no controladas llegan en el S11). */
export type SgcExtraPendings = (db: SgcDb, email: string, access: SgcCompanyAccess) => Promise<Partial<Record<SgcPendingGroup, number>>>;

export interface SgcMyPendings {
  counts: SgcPendingCounts;
  items: { group: SgcPendingGroup; idTask: number; idRequest: number; subject: string; task: string; createdAt: string }[];
}

/** Lo que le toca HOY a la persona en el SGC de la empresa (tareas en su turno, lecturas, autorizaciones, capacitaciones). */
export async function getMyPendings(db: SgcDb, email: string, access: SgcCompanyAccess, extra?: SgcExtraPendings): Promise<SgcMyPendings> {
  const rows = await listTaskInbox(db, email, [access], { status: 'abierta', idCompany: access.idCompany });
  // Sprint 11: por defecto se suman las copias no controladas que la persona decide (grupo SGC-COPIA-NC).
  const more = extra ? await extra(db, email, access) : { copias: await countCopiesToDecide(db, access.idCompany, email) };
  return {
    counts: countPendings(rows, more),
    items: rows
      .slice(0, 50)
      .map((r) => ({ group: pendingGroupOf(r), idTask: r.idTask, idRequest: r.idRequest, subject: r.subject, task: r.task, createdAt: r.createdAt })),
  };
}

/**
 * RESUMEN DIARIO por correo: solo para las empresas con la política
 * «resumen_diario», una vez al día (la empresa se «toma» el día con una
 * actualización condicionada, así dos corridas no lo repiten) y solo a quien
 * tiene pendientes. Lo llama la corrida diaria de avisos del SGC.
 */
export async function runPendingDigest(
  db: SgcDb,
  deps: { mailer: SgcMailer; appUrl: string },
  opts: { now?: Date; idCompany?: number | null } = {}
): Promise<{ companies: number; emails: number; errors: number }> {
  const today = colombiaToday(opts.now ?? new Date());
  const out = { companies: 0, emails: 0, errors: 0 };
  const companies = await db.sgcCompanyConfig.findMany({
    where: { is_active: true, email_mode: 'resumen_diario', ...(opts.idCompany ? { id_company: opts.idCompany } : {}) },
    include: { company: { select: { company: true } } },
  });
  for (const c of companies) {
    const claimed = await db.sgcCompanyConfig.updateMany({
      where: { id_company: c.id_company, OR: [{ email_digest_last_date: null }, { email_digest_last_date: { lt: today } }] },
      data: { email_digest_last_date: today },
    });
    if (claimed.count === 0) continue;
    out.companies += 1;
    // Personas con algo abierto en la empresa: cupos pendientes con nombre y grupos con cupo pendiente.
    const assignees = await db.sgcTaskAssignee.findMany({
      where: { status: 'pendiente', task: { status: 'abierta', request: { id_company: c.id_company } } },
      select: { user_email: true, pool_type_code: true },
    });
    const emails = new Set(assignees.map((a) => a.user_email?.trim().toLowerCase()).filter((e): e is string => !!e));
    const pools = [...new Set(assignees.filter((a) => !a.user_email && a.pool_type_code).map((a) => a.pool_type_code!))];
    if (pools.length) {
      const members = await db.sgcAuthorizationTypeUser.findMany({ where: { revoked_at: null, type: { id_company: c.id_company, code: { in: pools } } }, select: { user_email: true } });
      for (const m of members) emails.add(m.user_email.trim().toLowerCase());
    }
    const messages: SgcEmailMessage[] = [];
    for (const email of [...emails].sort()) {
      const { counts } = await getMyPendings(db, email, { idCompany: c.id_company, companyName: c.company.company, canRead: true, canManage: true, canQuality: true, canAdminFlows: false });
      const m = buildDigestMessage(email, c.company.company, counts, deps.appUrl, c.id_company);
      if (m) messages.push(m);
    }
    const results = messages.length ? await deps.mailer(messages).catch((e: unknown) => messages.map((m) => ({ to: m.to, ok: false as const, error: e instanceof Error ? e.message : 'Error de correo' }))) : [];
    const sent = results.filter((r) => r.ok).length;
    out.emails += sent;
    out.errors += results.length - sent;
    await writeSgcAudit(db, {
      idCompany: c.id_company,
      actorEmail: 'sistema@sgc',
      action: SGC_AUDIT_ACTIONS.correoResumenDiario,
      entity: 'company_config',
      entityId: `${c.id_company}:${formatCalendarDate(today)}`,
      after: { date: formatCalendarDate(today), recipients: results.map((r) => ({ to: r.to, ok: r.ok })) },
      detail: `Resumen diario de pendientes del ${formatCalendarDate(today)}: ${sent} correo(s) enviado(s), ${results.length - sent} con error.`,
    });
  }
  return out;
}
