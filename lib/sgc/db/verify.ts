import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { formatCalendarDate } from '../review';
import type { SgcActor, SgcDb } from './catalogs';
import { canViewDocument } from './documents';

/**
 * VERIFICACIÓN POR QR del PDF controlado (Sprint 4). El QR de la portada
 * abre /process/sgc-documental/verificar?empresa=&codigo=&version= y esta
 * función responde si ESA versión sigue vigente. Exige sesión y acceso al SGC
 * de la empresa (fail-closed); el título solo se muestra si la persona puede
 * consultar el documento. Cada verificación queda en la auditoría.
 */

export type SgcVerifyVerdict = 'vigente' | 'obsoleta' | 'en_divulgacion' | 'anulada' | 'no_encontrada';

export const SGC_VERIFY_MESSAGES: Record<SgcVerifyVerdict, string> = {
  vigente: 'Esta versión está VIGENTE: es la versión oficial del documento.',
  obsoleta: 'Esta versión está OBSOLETA: no la use. Consulte la versión vigente en el listado maestro.',
  en_divulgacion: 'Esta versión está aprobada pero en divulgación: AÚN NO es vigente (sigue vigente la versión anterior, si existe).',
  anulada: 'Esta versión está ANULADA: no la use.',
  no_encontrada: 'No existe esa versión del documento en el SGC de la empresa.',
};

export interface SgcVerifyResult {
  verdict: SgcVerifyVerdict;
  message: string;
  company: string | null;
  code: string;
  versionNumber: number;
  title: string | null;
  idDocument: number | null;
  effectiveDate: string | null;
  obsoleteDate: string | null;
  currentVersionNumber: number | null;
  pdfSha256: string | null;
}

export async function verifyVersionByCode(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  query: { idCompany: unknown; code: unknown; versionNumber: unknown },
  actor: SgcActor
): Promise<SgcVerifyResult> {
  const idCompany = Number(query.idCompany);
  const versionNumber = Number(query.versionNumber);
  const code = typeof query.code === 'string' ? query.code.trim().toUpperCase().slice(0, 60) : '';
  if (!Number.isInteger(idCompany) || idCompany < 1 || !code || !Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new SgcError('El enlace de verificación está incompleto (empresa, código y versión).');
  }
  const access = accessByCompany.find((a) => a.idCompany === idCompany && a.canRead);
  if (!access) throw new SgcError('No tiene acceso al SGC de esa empresa.', 404);
  const doc = await db.sgcDocument.findUnique({ where: { id_company_code: { id_company: idCompany, code } }, include: { companyConfig: { include: { company: { select: { company: true } } } } } });
  const version = doc ? await db.sgcDocumentVersion.findUnique({ where: { id_document_version_number: { id_document: doc.id_document, version_number: versionNumber } } }) : null;
  const current = doc?.current_version_id ? await db.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id }, select: { version_number: true, status: true } }) : null;
  let verdict: SgcVerifyVerdict = 'no_encontrada';
  if (doc && version) {
    if (doc.status === 'anulado' || version.status === 'anulado') verdict = 'anulada';
    else if (version.status === 'vigente' && doc.current_version_id === version.id_document_version) verdict = 'vigente';
    else if (version.status === 'obsoleto' || (version.status === 'vigente' && doc.current_version_id !== version.id_document_version)) verdict = 'obsoleta';
    else verdict = 'en_divulgacion';
  }
  const canSee = doc ? await canViewDocument(db, accessByCompany, subject, doc.id_document) : false;
  await writeSgcAudit(db, {
    idCompany,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.verificacionQr,
    entity: 'document_version',
    entityId: version?.id_document_version ?? null,
    after: { code, versionNumber, verdict },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return {
    verdict,
    message: SGC_VERIFY_MESSAGES[verdict],
    company: doc?.companyConfig.company.company ?? null,
    code,
    versionNumber,
    title: canSee ? doc!.title : null,
    idDocument: canSee ? doc!.id_document : null,
    effectiveDate: formatCalendarDate(version?.effective_date ?? null),
    obsoleteDate: formatCalendarDate(version?.obsolete_date ?? null),
    currentVersionNumber: current && current.status === 'vigente' ? current.version_number : null,
    pdfSha256: version ? version.pdf_sha256.trim() : null,
  };
}
