import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import { computeReviewDueDate, formatCalendarDate, toCalendarDate } from '../review';
import type { SgcActor } from './catalogs';

/**
 * VIGENCIA del SGC (Sprint 4): al cerrar el flujo documental («completada»)
 * la versión aprobada pasa AUTOMÁTICAMENTE a vigente y la anterior a
 * OBSOLETA, en la MISMA transacción del motor (o pasan las dos o ninguna).
 * Mientras la divulgación y la capacitación no terminan, la versión anterior
 * sigue vigente (el documento conserva su versión actual).
 *
 * Si la solicitud se cancela en la divulgación o la capacitación, la versión
 * aprobada se ANULA (nunca llegó a vigente) y la anterior sigue vigente.
 */

type Tx = Prisma.TransactionClient;

/** Fecha de hoy en Colombia (UTC−5) como fecha de calendario. */
export function colombiaToday(now: Date): Date {
  return toCalendarDate(new Date(now.getTime() - 5 * 60 * 60 * 1000));
}

export interface SgcPublishResult {
  idDocument: number;
  code: string;
  idVersion: number;
  versionNumber: number;
  effectiveDate: string;
  reviewDueDate: string;
  obsolete: { idVersion: number; versionNumber: number } | null;
}

/**
 * Publica la versión aprobada de la solicitud: vigente desde hoy, próxima
 * revisión según el tipo documental (36 meses por defecto); la vigente
 * anterior queda obsoleta con fecha y apunta a la que la reemplazó.
 */
export async function publishApprovedVersion(tx: Tx, request: { id_request: number; id_company: number; id_document_version: number | null; controlled_pdf_status: string | null }, actor: SgcActor, now: Date): Promise<SgcPublishResult> {
  if (!request.id_document_version || request.controlled_pdf_status !== 'generado') {
    throw new SgcError('La solicitud no tiene PDF controlado generado: no puede pasar a vigente.', 409);
  }
  const version = await tx.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: request.id_document_version }, include: { document: { include: { documentType: true } } } });
  if (version.status !== 'borrador') throw new SgcError(`La versión ya está ${version.status}: no se vuelve a publicar.`, 409);
  const doc = version.document;
  if (doc.status === 'anulado') throw new SgcError('El documento está anulado: la versión no puede pasar a vigente.', 409);
  const effective = colombiaToday(now);
  const reviewDue = computeReviewDueDate(effective, doc.documentType.review_months);
  const previous = doc.current_version_id && doc.current_version_id !== version.id_document_version
    ? await tx.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id } })
    : null;
  let obsolete: SgcPublishResult['obsolete'] = null;
  if (previous && previous.status === 'vigente') {
    await tx.sgcDocumentVersion.update({ where: { id_document_version: previous.id_document_version }, data: { status: 'obsoleto', obsolete_date: effective, id_superseded_by: version.id_document_version } });
    obsolete = { idVersion: previous.id_document_version, versionNumber: previous.version_number };
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.versionObsoleta,
      entity: 'document_version',
      entityId: previous.id_document_version,
      before: { status: 'vigente' },
      after: { status: 'obsoleto', obsoleteDate: formatCalendarDate(effective), supersededBy: version.id_document_version },
      detail: `${doc.code} V${previous.version_number} queda obsoleta: la reemplaza la V${version.version_number} (solicitud #${request.id_request}).`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
  await tx.sgcDocumentVersion.update({ where: { id_document_version: version.id_document_version }, data: { status: 'vigente', effective_date: effective, review_due_date: reviewDue } });
  await tx.sgcDocument.update({ where: { id_document: doc.id_document }, data: { status: 'vigente', current_version_id: version.id_document_version, next_review_date: reviewDue } });
  await writeSgcAudit(tx, {
    idCompany: request.id_company,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.documentoVigente,
    entity: 'document_version',
    entityId: version.id_document_version,
    before: { status: 'borrador', documentStatus: doc.status, currentVersion: doc.current_version_id },
    after: { status: 'vigente', effectiveDate: formatCalendarDate(effective), reviewDueDate: formatCalendarDate(reviewDue), obsolete },
    detail: `${doc.code} V${version.version_number} vigente automáticamente al cerrar la solicitud #${request.id_request}.`,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return {
    idDocument: doc.id_document,
    code: doc.code,
    idVersion: version.id_document_version,
    versionNumber: version.version_number,
    effectiveDate: formatCalendarDate(effective)!,
    reviewDueDate: formatCalendarDate(reviewDue)!,
    obsolete,
  };
}

/**
 * Cancelación en la divulgación o la capacitación: la versión aprobada se
 * ANULA (no llegó a vigente). Si el documento era nuevo (nunca tuvo vigente),
 * el documento también queda anulado. La vigente anterior no se toca.
 */
export async function annulUnpublishedVersion(tx: Tx, request: { id_request: number; id_company: number; id_document_version: number | null }, reason: string, actor: SgcActor, now: Date): Promise<{ idVersion: number; code: string } | null> {
  if (!request.id_document_version) return null;
  const version = await tx.sgcDocumentVersion.findUnique({ where: { id_document_version: request.id_document_version }, include: { document: true } });
  if (!version || version.status !== 'borrador') return null;
  const today = colombiaToday(now);
  await tx.sgcDocumentVersion.update({ where: { id_document_version: version.id_document_version }, data: { status: 'anulado', obsolete_date: today } });
  if (version.document.status === 'borrador' && !version.document.current_version_id) {
    await tx.sgcDocument.update({ where: { id_document: version.id_document }, data: { status: 'anulado', annulled_at: now, annulled_by: actor.email, annul_reason: `Solicitud #${request.id_request} cancelada antes de la vigencia: ${reason}`.slice(0, 1000) } });
  }
  await writeSgcAudit(tx, {
    idCompany: request.id_company,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.versionAnuladaSinVigencia,
    entity: 'document_version',
    entityId: version.id_document_version,
    before: { status: 'borrador' },
    after: { status: 'anulado' },
    detail: `${version.document.code} V${version.version_number} anulada: la solicitud #${request.id_request} se canceló antes de la vigencia. ${reason}`.slice(0, 1000),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { idVersion: version.id_document_version, code: version.document.code };
}
