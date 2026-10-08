import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SGC_SUBPROCESS_URLS } from '../constants';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError, isSgcError } from '../errors';
import { SGC_SIGNATURE_LABELS, type SgcSignatureMeaning } from '../flows/definition';
import type { SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import { buildControlledPdfWithLayout, manifestSha256, readManifest, verifyControlledPdf, type SgcManifest, type SgcManifestMinorRevision, type SgcManifestPlacement, type SgcPdfVerification } from '../pdf/controlledPdf';
import { overflowMeanings, suggestInstitutionalPlacements } from '../pdf/institutional';
import type { SgcDocxToHtml, SgcHtmlToPdf } from '../pdf/render';
import { sgcSignerKey, type SgcPlacedMeaning, type SgcPlacementParticipant } from '../signature/fields';
import { SGC_SIGNATURE_CONSENT_VERSION } from '../signature/consent';
import { consentTextSha256, sha256HexOf, validateSignInput, verifySignatureRow } from '../signature/record';
import { assertReauthNotLocked, type SgcPasswordVerifier } from '../signature/reauth';
import { buildVersionFileName, buildVersionFolderSegments } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import { resolveNewDocumentCode } from './coding';
import { getVersionForViewer, type SgcUploader } from './documents';
import { addInteraction, decideTask, requestOfTask } from './requests';
import { cargoOf, composeContent, effectiveInstitutional, latestLayout, loadVerifiedDraft, personLabel } from './layout';
import { isHeaderMandatory } from './companySettings';
import { minorRevisionChain } from './drafts';
import { withSgcAppLock } from './lock';
import { getReadSignError, type SgcReadStatus } from '../dissemination/scope';
import type { SgcSignatureRow, SgcSignedContent } from '../signature/record';
import { buildVerifyUrl } from '../pdf/qr';
import { signatureInkBounds } from '../pdf/controlledPdf';
import { SGC_SELF_SIGNATURE_DISABLED, masterStatus, normalizeOwnSignature, validationDenial, type SgcCaptureMethod, type SgcMasterOrigin } from '../signature/ownSignature';
import type { Prisma } from '../../../app/generated/prisma';
import { latestTrainingUpload, trainingNeedsJustification, uploadSummary } from './training';

/**
 * FIRMA ELECTRÓNICA PROPIA del SGC y PDF CONTROLADO (Sprint 3).
 *
 * Copia aislada de lo ya validado de GSS Firma/Orión y de la firma corporativa
 * de SynerLink (consentimiento legal, identidad del firmante, trazo, marca y
 * eventos), reescrita para el sistema validado: NO llama a Orión, no usa su
 * tenant ni sus tablas, y guarda las evidencias en el espacio propio de la
 * empresa (<storage_root>/_firmas/). Si Orión está caído o apagado, el SGC
 * firma igual (prueba de independencia).
 *
 * Firmar = reautenticarse con la contraseña de SynerLink + significado +
 * motivo + consentimiento; el servidor pone la hora (UTC), la huella SHA-256
 * del borrador que se firma y la cadena de registros. Tras la última firma de
 * la Aprobación se genera el PDF controlado (portada de control + contenido +
 * manifiesto de firmas verificable).
 */

export interface SgcSignatureDeps {
  verifyPassword: SgcPasswordVerifier;
  upload: SgcUploader;
  /** Descarga el contenido de un item de OneDrive (sin verificar: quien llama compara el hash). */
  download: (itemId: string) => Promise<Uint8Array>;
  htmlToPdf: SgcHtmlToPdf;
  docxToHtml: SgcDocxToHtml;
  notifier: SgcNotifier;
  /** URL pública de SynerLink (para el enlace de verificación del PDF). */
  appUrl: string;
  now?: () => Date;
}

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Firmar una tarea
// ---------------------------------------------------------------------------

export interface SgcSignRawInput {
  meaning?: unknown;
  reason?: unknown;
  consentAccepted?: unknown;
  password?: unknown;
  comment?: unknown;
  idAssignee?: unknown;
  checklist?: unknown;
  /** Borrador que la persona vio al firmar (debe seguir siendo el vigente). */
  draftRef?: unknown;
  draftSha256?: unknown;
}

async function ensureConsent(db: SgcDb, idCompany: number, actor: SgcActor, now: Date) {
  const email = lower(actor.email);
  const existing = await db.sgcSignatureConsent.findUnique({ where: { id_company_user_email_consent_version: { id_company: idCompany, user_email: email, consent_version: SGC_SIGNATURE_CONSENT_VERSION } } });
  if (existing) return;
  await db.$transaction(async (tx) => {
    const row = await tx.sgcSignatureConsent.create({
      data: { id_company: idCompany, user_email: email, consent_version: SGC_SIGNATURE_CONSENT_VERSION, text_sha256: consentTextSha256(), accepted_at: now, ip: actor.ip ?? null, user_agent: actor.userAgent ?? null },
    });
    await writeSgcAudit(tx, { idCompany, actorEmail: email, action: SGC_AUDIT_ACTIONS.firmaConsentimiento, entity: 'signature_consent', entityId: row.id_signature_consent, after: { version: SGC_SIGNATURE_CONSENT_VERSION, sha256: row.text_sha256 }, ip: actor.ip, userAgent: actor.userAgent });
  });
}

/**
 * Firma y aprueba (o envía) una tarea. Orden: validar → bloqueo por intentos
 * → REAUTENTICAR → consentimiento → verificar el borrador → decidir con la
 * firma dentro de la transacción del motor → si se cerró la Aprobación,
 * generar el PDF controlado.
 */
export async function signTask(db: SgcDb, deps: SgcSignatureDeps, idTask: number, raw: SgcSignRawInput, actor: SgcActor) {
  const now = deps.now?.() ?? new Date();
  const email = lower(actor.email);
  const { idRequest, idCompany } = await requestOfTask(db, idTask);
  const task = await db.sgcTask.findUniqueOrThrow({ where: { id_task: idTask }, include: { taskDef: true } });
  const input = validateSignInput(raw, (task.taskDef.signature_meaning as SgcSignatureMeaning | null) ?? null, email);

  // Sprint 6: contar intentos → comparar → registrar el fallo, serializado por persona entre todas las
  // instancias; así una ráfaga en paralelo no se salta el bloqueo de 5 intentos en 15 minutos.
  // Sin espera: un segundo intento de la MISMA persona mientras otro está en curso se rechaza (409) y no cuenta
  // (así ninguna conexión queda retenida esperando el bloqueo). El conteo y el registro van en la misma conexión.
  const ok = await withSgcAppLock(db, `sgc-reautenticacion-${email}`, { waitMs: 0, busyMessage: 'Hay otra firma suya en curso. Espere a que termine e intente de nuevo.', holdMs: 60_000 }, async (tx) => {
    await assertReauthNotLocked(tx, email, now);
    const valid = await deps.verifyPassword(email, input.password);
    if (!valid) {
      await writeSgcAudit(tx, {
        idCompany,
        actorEmail: email,
        action: SGC_AUDIT_ACTIONS.firmaReautenticacionFallida,
        entity: 'task',
        entityId: idTask,
        detail: `Reautenticación fallida al firmar «${SGC_SIGNATURE_LABELS[input.meaning]}» (solicitud #${idRequest}). No se firmó.`,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    return valid;
  });
  if (!ok) {
    throw new SgcError('Contraseña incorrecta: no se firmó. Escriba su contraseña de SynerLink.', 403);
  }

  await ensureConsent(db, idCompany, actor, now);
  // Sprint 4: «Leyó» se firma sobre el PDF controlado que se divulga y «Capacitó» sobre el Excel de resultados.
  const content: SgcSignedContent =
    input.meaning === 'leyo'
      ? await loadReadingContent(db, deps, idRequest, raw.idAssignee, email)
      : input.meaning === 'capacito'
        ? await loadTrainingContent(db, deps, idTask, raw.comment)
        : (await loadVerifiedDraft(db, deps, idRequest)).draft;
  const draft = content;
  if ((raw.draftRef !== undefined && raw.draftRef !== null && raw.draftRef !== draft.ref) || (raw.draftSha256 !== undefined && raw.draftSha256 !== null && raw.draftSha256 !== draft.sha256)) {
    throw new SgcError(input.meaning === 'leyo' ? 'El documento cambió desde que lo abrió: léalo de nuevo antes de firmar.' : input.meaning === 'capacito' ? 'Los resultados cambiaron desde que abrió la tarea: revíselos de nuevo antes de firmar.' : 'El borrador cambió desde que abrió la tarea: revíselo de nuevo antes de firmar.', 409);
  }
  const user = await db.user.findFirst({ where: { email: { equals: email } }, select: { name: true } });
  const idAssignee = Number(raw.idAssignee);
  const result = await decideTask(
    db,
    deps.notifier,
    idTask,
    {
      decision: 'aprobar',
      comment: raw.comment,
      idAssignee: Number.isInteger(idAssignee) && idAssignee > 0 ? idAssignee : null,
      checklist: raw.checklist,
      signature: {
        meaning: input.meaning,
        reason: input.reason,
        signerName: user?.name ?? null,
        verifiedDraft: { kind: draft.kind, ref: draft.ref, name: draft.name, sha256: draft.sha256 },
        uploadEvidence: deps.upload,
        now,
      },
    },
    actor
  );

  let controlledPdf: { status: 'generado' | 'error' | null; error?: string; idDocumentVersion?: number } = { status: null };
  if (result.outcome === 'resuelta' && result.resolvedMeaning === 'aprobo') {
    try {
      const v = await generateControlledVersion(db, deps, result.idRequest, actor);
      controlledPdf = { status: 'generado', idDocumentVersion: v.idDocumentVersion };
    } catch (e) {
      // Sprint 6: el mensaje técnico (Graph, Chrome, base) queda en la auditoría, no en la respuesta.
      controlledPdf = { status: 'error', error: isSgcError(e) ? e.message : PDF_GENERIC_ERROR };
    }
  }
  return { ...result, controlledPdf };
}

/**
 * Sprint 4 — contenido de la firma «Leyó»: el PDF CONTROLADO de la versión
 * que se divulga, descargado y VERIFICADO contra su SHA-256. La persona debe
 * tener su lectura pendiente y haber llegado al final del documento.
 */
async function loadReadingContent(db: SgcDb, deps: SgcSignatureDeps, idRequest: number, rawAssignee: unknown, email: string): Promise<SgcSignedContent> {
  const idAssignee = Number(rawAssignee);
  const rec = Number.isInteger(idAssignee) && idAssignee > 0 ? await db.sgcReadRecord.findUnique({ where: { id_task_assignee: idAssignee } }) : null;
  const mine = rec && rec.id_request === idRequest && lower(rec.user_email) === email ? rec : null;
  const error = getReadSignError(mine ? { status: mine.status as SgcReadStatus, openedAt: mine.first_opened_at, reachedEndAt: mine.reached_end_at, signedAt: mine.signed_at } : null);
  if (error) throw new SgcError(error, 409);
  const request = await db.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest }, select: { id_document_version: true, controlled_pdf_status: true } });
  if (!request.id_document_version || request.controlled_pdf_status !== 'generado') throw new SgcError('El PDF controlado aún no está disponible.', 409);
  const version = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: request.id_document_version } });
  const bytes = await deps.download(version.pdf_item_id);
  if (sha256HexOf(bytes) !== version.pdf_sha256.trim()) throw new SgcError('El PDF controlado no coincide con su huella registrada (SHA-256): no se firma. Avise a Calidad.', 409);
  return { kind: 'pdf_controlado', ref: `version:${version.id_document_version}`, name: version.pdf_file_name, sha256: version.pdf_sha256.trim() };
}

/**
 * Sprint 4 — contenido de la firma «Capacitó»: la última carga del Excel de
 * resultados, VERIFICADA contra su SHA-256. Si hay personas del alcance que
 * reprobaron o no presentaron, el cierre exige justificación (comentario).
 */
async function loadTrainingContent(db: SgcDb, deps: SgcSignatureDeps, idTask: number, rawComment: unknown): Promise<SgcSignedContent> {
  const latest = await latestTrainingUpload(db, idTask);
  if (!latest) throw new SgcError('Registre la capacitación y cargue el Excel de resultados de Forms antes de cerrarla.', 409);
  const summary = uploadSummary(latest.upload);
  const comment = typeof rawComment === 'string' ? rawComment.trim() : '';
  if (trainingNeedsJustification(summary) && comment.length < 10) {
    throw new SgcError(`Hay ${summary.failed} persona(s) que reprobaron y ${summary.missing.length} sin resultado: escriba la justificación del cierre (mínimo 10 caracteres) en la resolución.`, 409);
  }
  const bytes = await deps.download(latest.upload.item_id);
  if (sha256HexOf(bytes) !== latest.upload.sha256.trim()) throw new SgcError('El Excel de resultados no coincide con su huella registrada (SHA-256): no se firma. Avise a Calidad.', 409);
  return { kind: 'resultados_capacitacion', ref: `training_upload:${latest.upload.id_training_upload}`, name: latest.upload.file_name, sha256: latest.upload.sha256.trim() };
}

// ---------------------------------------------------------------------------
// PDF controlado
// ---------------------------------------------------------------------------

async function finalSignatures(db: SgcDb, idRequest: number) {
  const tasks = await db.sgcTask.findMany({ where: { id_request: idRequest, status: 'resuelta' }, include: { taskDef: true }, orderBy: { id_task: 'asc' } });
  const lastByKey = new Map<string, number>();
  // Solo las firmas de elaboración, revisión y aprobación van en el PDF controlado (no las de lectura ni capacitación).
  for (const t of tasks) if (t.taskDef.signature_meaning && ['elaboro', 'reviso', 'aprobo'].includes(t.taskDef.signature_meaning)) lastByKey.set(t.task_key, t.id_task);
  const ids = [...lastByKey.values()];
  if (ids.length === 0) return [];
  return db.sgcSignature.findMany({ where: { id_request: idRequest, id_task: { in: ids } }, orderBy: [{ signed_at: 'asc' }, { id_signature: 'asc' }] });
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null;
}

const PDF_GENERIC_ERROR = 'No se pudo generar el PDF controlado por un error técnico. Calidad puede reintentarlo desde la solicitud.';

async function markPdfError(db: SgcDb, idRequest: number, idCompany: number, message: string, actor: SgcActor, publicMessage: string = message) {
  await db.$transaction(async (tx) => {
    // Sprint 6: si otra ejecución ya lo generó (carrera), no se pisa el estado «generado».
    const current = await tx.sgcRequest.findUnique({ where: { id_request: idRequest }, select: { controlled_pdf_status: true, id_document_version: true } });
    if (current?.controlled_pdf_status === 'generado' && current.id_document_version) return;
    await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { controlled_pdf_status: 'error', controlled_pdf_error: message.slice(0, 1000) } });
    await addInteraction(tx, idRequest, 'sistema', lower(actor.email), `No se pudo generar el PDF controlado: ${publicMessage}\nCalidad puede reintentarlo desde la solicitud.`);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.pdfControladoError, entity: 'request', entityId: idRequest, detail: message, ip: actor.ip, userAgent: actor.userAgent });
  });
}

/**
 * Genera el PDF CONTROLADO de la versión aprobada: toma el borrador que
 * firmaron todos, lo convierte a PDF si hace falta, le pone la portada de
 * control, el encabezado/pie en cada página y el manifiesto de firmas, lo
 * sube a <raíz>/<TIPO>/<CODIGO>/v<n>/ y registra la versión (estado
 * «borrador»: aprobada, pendiente de divulgación — pasa a vigente en el S4).
 * Idempotente: si ya se generó, devuelve la versión existente.
 */
export async function generateControlledVersion(db: SgcDb, deps: SgcSignatureDeps, idRequest: number, actor: SgcActor): Promise<{ idDocument: number; idDocumentVersion: number; pdfSha256: string; created: boolean }> {
  // Sprint 6: una sola generación a la vez por solicitud (la última firma y un reintento de Calidad
  // podían correr juntas, subir el mismo archivo dos veces y dejar el PDF distinto de su huella).
  return withSgcAppLock(db, `sgc-pdf-controlado-${idRequest}`, { waitMs: 0, busyMessage: 'El PDF controlado de esta solicitud ya se está generando. Espere un momento y recargue.', holdMs: 180_000 }, () =>
    generateControlledVersionUnlocked(db, deps, idRequest, actor)
  );
}

async function generateControlledVersionUnlocked(db: SgcDb, deps: SgcSignatureDeps, idRequest: number, actor: SgcActor): Promise<{ idDocument: number; idDocumentVersion: number; pdfSha256: string; created: boolean }> {
  const request = await db.sgcRequest.findUniqueOrThrow({
    where: { id_request: idRequest },
    include: { documentType: true, processMap: { include: { processType: true } }, document: true, companyConfig: { include: { company: { select: { company: true } } } }, formValues: { include: { field: true } } },
  });
  if (request.controlled_pdf_status === 'generado' && request.id_document_version) {
    const v = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: request.id_document_version } });
    return { idDocument: v.id_document, idDocumentVersion: v.id_document_version, pdfSha256: v.pdf_sha256.trim(), created: false };
  }
  try {
    const now = deps.now?.() ?? new Date();
    const signatures = await finalSignatures(db, idRequest);
    const approvals = signatures.filter((s) => s.meaning === 'aprobo');
    if (approvals.length === 0) throw new SgcError('La solicitud no tiene firmas de aprobación.', 409);
    const { draft, bytes, html } = await loadVerifiedDraft(db, deps, idRequest);
    // 2026-10-03: una REVISIÓN MENOR de Calidad (con motivo) deja válidas las firmas hechas sobre el
    // contenido que corrigió; la aprobación de Calidad va sobre el contenido final.
    const chain = await minorRevisionChain(db, idRequest, draft.sha256);
    const accepted = new Set([draft.sha256, ...chain.map((r) => r.baseSha256)]);
    const offContent = signatures.filter((s) => !accepted.has(s.content_sha256.trim()));
    if (offContent.length) throw new SgcError('Hay firmas sobre un contenido distinto del borrador vigente: no se genera el PDF controlado.', 409);
    if (chain.length && !approvals.some((s) => s.content_sha256.trim() === draft.sha256)) {
      throw new SgcError('Hubo una revisión menor de Calidad y ninguna aprobación quedó sobre el contenido final: no se genera el PDF controlado.', 409);
    }
    const broken = signatures.filter((s) => !verifySignatureRow(s));
    if (broken.length) throw new SgcError('Un registro de firma no coincide con su huella: no se genera el PDF controlado. Avise a Calidad.', 409);
    if (!request.documentType || !request.processMap) throw new SgcError('La solicitud no tiene tipo documental o proceso.', 409);

    // Documento y número de versión.
    let code: string;
    let title: string;
    let sequence: number | null = null;
    let versionNumber: number;
    if (request.document) {
      code = request.document.code;
      title = request.document.title;
      const last = await db.sgcDocumentVersion.findFirst({ where: { id_document: request.document.id_document }, orderBy: { version_number: 'desc' }, select: { version_number: true } });
      versionNumber = (last?.version_number ?? 0) + 1;
    } else {
      // Sprint 8: con la guía de la empresa; un formato o instructivo hereda el número de su documento padre.
      const resolved = await resolveNewDocumentCode(db, {
        idCompany: request.id_company,
        processTypeCode: request.processMap.processType.code,
        processCode: request.processMap.code,
        documentTypeCode: request.documentType.code,
        idParentDocument: request.id_parent_document,
      });
      sequence = resolved.sequence;
      code = resolved.code;
      title = request.subject.slice(0, 300);
      versionNumber = 1;
    }

    const changeValue = request.formValues.find((v) => v.field.field_key === 'resumen_cambios')?.value_text ?? null;
    const changeDescription = (changeValue || request.description).slice(0, 2000);

    // 2026-10-03: composición — encabezado institucional (si el documento lo usa), campos de sistema,
    // historial de cambios y firmas DENTRO del documento en la posición que ubicó el elaborador.
    const layout = await latestLayout(db, idRequest);
    // Sprint 8: encabezado obligatorio por configuración de la empresa (salvo un borrador PDF anterior a la regla).
    const institutional = effectiveInstitutional(layout.institutionalHeader, await isHeaderMandatory(db, request.id_company), draft.format);
    const signerRows = await db.sgcTaskAssignee.findMany({ where: { id_task_assignee: { in: signatures.map((s) => s.id_task_assignee) } }, select: { id_task_assignee: true, user_email: true, pool_type_code: true, sign_order: true, task: { select: { task_key: true } } } });
    const keyOfAssignee = new Map(signerRows.map((a) => [a.id_task_assignee, sgcSignerKey(a.task.task_key, a.user_email, a.pool_type_code)]));
    const cargos = await cargoOf(db, request.id_company, signatures.map((s) => s.signer_email));
    const signOrderOf = new Map(signerRows.map((a) => [a.id_task_assignee, a.user_email ? a.sign_order : Number.MAX_SAFE_INTEGER]));
    // Sprint 12: la firma de un sustituto queda «en sustitución de» el titular también en el encabezado.
    const namesFor = (m: SgcPlacedMeaning) => [
      ...new Set(
        [...signatures]
          .sort((a, b) => (signOrderOf.get(a.id_task_assignee) ?? 0) - (signOrderOf.get(b.id_task_assignee) ?? 0))
          .filter((s) => s.meaning === m)
          .map((s) => {
            const label = personLabel(s.signer_name, s.signer_email, cargos.get(s.signer_email.trim().toLowerCase()));
            return s.on_behalf_of ? `${label} (en sustitución de ${s.on_behalf_of.trim()})` : label;
          })
      ),
    ];
    const approvedAt = approvals.at(-1)!.signed_at;
    const composed = await composeContent(db, deps, {
      idCompany: request.id_company,
      idDocument: request.document?.id_document ?? null,
      draft: { format: draft.format, bytes, html },
      institutional,
      code,
      title,
      versionNumber,
      company: request.companyConfig.company.company,
      process: `${request.processMap.code} · ${request.processMap.name}`,
      documentType: request.documentType.name,
      elaboro: namesFor('elaboro'),
      reviso: namesFor('reviso'),
      aprobo: namesFor('aprobo'),
      changeDate: new Date(approvedAt.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10),
      changeReason: changeDescription,
      emissionText: 'Al quedar vigente',
    });
    const contentPdf = composed.contentPdf;
    const source: { bytes: Uint8Array; ext: string; contentType: string } | null =
      draft.format === 'docx'
        ? { bytes: bytes!, ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
        : draft.format === 'html'
          ? { bytes: new TextEncoder().encode(html!), ext: 'html', contentType: 'text/html; charset=utf-8' }
          : null;
    const explicit = new Map(layout.fields.map((f) => [f.signerKey, f]));
    const signedParticipants: SgcPlacementParticipant[] = [];
    // Sprint 13: en el orden de firma que se confirmó (el cupo de grupo al final): el primero es el TITULAR del recuadro.
    const orderOf = new Map(signerRows.map((a) => [a.id_task_assignee, a.user_email ? a.sign_order : Number.MAX_SAFE_INTEGER]));
    const inOrder = [...signatures].sort((a, b) => (orderOf.get(a.id_task_assignee) ?? 0) - (orderOf.get(b.id_task_assignee) ?? 0));
    for (const s of inOrder) {
      const key = keyOfAssignee.get(s.id_task_assignee);
      if (key && !signedParticipants.some((p) => p.key === key)) signedParticipants.push({ key, meaning: s.meaning as SgcPlacedMeaning, name: s.signer_name ?? s.signer_email, email: s.signer_email, role: SGC_SIGNATURE_LABELS[s.meaning as SgcSignatureMeaning] });
    }
    // Sprint 13 (R14): con 3 o más firmantes de un significado, todos van a la página «Registro de firmas».
    const overflow = new Set<string>(overflowMeanings(signedParticipants));
    const signatureRegister = inOrder.filter((s) => overflow.has(s.meaning)).map((s) => s.signature_uid.trim());
    const registerCargos: Record<string, string> = {};
    for (const s of inOrder) {
      const c = cargos.get(s.signer_email.trim().toLowerCase());
      if (c && overflow.has(s.meaning)) registerCargos[s.signature_uid.trim()] = c;
    }
    // Con plantilla institucional, la firma que no se ubicó va en su recuadro «Firma» del encabezado.
    const suggested = institutional ? new Map(suggestInstitutionalPlacements(signedParticipants, layout.fields).map((f) => [f.signerKey, f])) : new Map();
    const placements: SgcManifestPlacement[] = [];
    for (const s of signatures) {
      const key = keyOfAssignee.get(s.id_task_assignee);
      const f = key ? explicit.get(key) ?? suggested.get(key) : undefined;
      if (f) placements.push({ uid: s.signature_uid.trim(), page: f.page, x: f.x, y: f.y, width: f.width, height: f.height });
    }
    const minorRevisions: SgcManifestMinorRevision[] = chain.map((r) => ({ revision: r.revision, baseSha256: r.baseSha256, newSha256: r.newSha256, reason: r.reason, by: r.by, at: r.at.toISOString() }));
    const manifest: SgcManifest = {
      schema: 'sgc-manifiesto-firmas/v1',
      company: request.companyConfig.company.company,
      idCompany: request.id_company,
      code,
      title,
      versionNumber,
      idRequest,
      documentType: `${request.documentType.code} · ${request.documentType.name}`,
      process: `${request.processMap.code} · ${request.processMap.name}`,
      statusLabel: 'Aprobado — pendiente de divulgación',
      approvedAt: approvedAt.toISOString(),
      generatedAt: now.toISOString(),
      changeDescription,
      signedContent: { name: draft.name, sha256: draft.sha256 },
      signatures: signatures.map((s) => ({
        uid: s.signature_uid.trim(),
        meaning: s.meaning,
        meaningLabel: SGC_SIGNATURE_LABELS[s.meaning as SgcSignatureMeaning] ?? s.meaning,
        signerName: s.signer_name,
        signerEmail: s.signer_email,
        signedAt: s.signed_at.toISOString(),
        reason: s.reason,
        authMethod: s.auth_method,
        contentSha256: s.content_sha256.trim(),
        recordHash: s.record_hash.trim(),
        ...(s.on_behalf_of?.trim() ? { onBehalfOf: s.on_behalf_of.trim() } : {}),
      })),
      // Sprint 4: el QR de la portada abre esta verificación de vigencia de la versión.
      verifyUrl: buildVerifyUrl(deps.appUrl, request.id_company, code, versionNumber),
      ...(placements.length ? { placements } : {}),
      ...(institutional ? { institutionalHeader: true } : {}),
      ...(minorRevisions.length ? { minorRevisions } : {}),
      ...(signatureRegister.length ? { signatureRegister } : {}),
    };
    const masterIds = [...new Set(signatures.map((s) => s.id_signature_master).filter((x): x is number => !!x))];
    const masters = masterIds.length ? await db.sgcSignatureMaster.findMany({ where: { id_signature_master: { in: masterIds } } }) : [];
    const masterPng: Record<string, Uint8Array> = {};
    for (const s of signatures) {
      const m = masters.find((x) => x.id_signature_master === s.id_signature_master);
      const png = m ? dataUrlToBytes(m.image_png) : null;
      if (png) masterPng[s.signature_uid.trim()] = png;
    }
    const built = await buildControlledPdfWithLayout(contentPdf, manifest, masterPng, { header: composed.header, registerCargos });
    const controlled = built.bytes;
    const pdfSha256 = sha256HexOf(controlled);

    const segments = buildVersionFolderSegments({ storageRoot: request.companyConfig.storage_root, documentTypeCode: request.documentType.code, code, versionNumber });
    const pdfName = buildVersionFileName(code, versionNumber, 'x.pdf', 'pdf');
    const pdfItem = await deps.upload(segments, pdfName, controlled, 'application/pdf');
    let sourceItem: { id: string } | null = null;
    let sourceName: string | null = null;
    if (source) {
      sourceName = buildVersionFileName(code, versionNumber, `x.${source.ext}`, source.ext);
      sourceItem = await deps.upload(segments, sourceName, source.bytes, source.contentType);
    }
    const folder = segments.join('/');

    const saved = await db.$transaction(async (tx) => {
      const locked = await tx.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } });
      if (locked.controlled_pdf_status === 'generado' && locked.id_document_version) throw new SgcError('El PDF controlado ya se generó.', 409);
      let idDocument = request.document?.id_document ?? null;
      if (!idDocument) {
        const doc = await tx.sgcDocument.create({
          data: {
            id_company: request.id_company,
            code,
            title,
            id_document_type: request.documentType!.id_document_type,
            id_process_map: request.processMap!.id_process_map,
            id_owner_department: request.processMap!.id_department,
            // Supuesto S3 (el más seguro): por departamento si el proceso tiene dueño; si no, confidencial. Calidad lo ajusta en la ficha.
            confidentiality: request.processMap!.id_department ? 'departamento' : 'confidencial',
            status: 'borrador',
            sequence_number: sequence,
            created_by: lower(actor.email),
          },
        });
        idDocument = doc.id_document;
      }
      const version = await tx.sgcDocumentVersion.create({
        data: {
          id_document: idDocument,
          version_number: versionNumber,
          status: 'borrador',
          pdf_item_id: pdfItem.id,
          pdf_path: `${folder}/${pdfName}`,
          pdf_file_name: pdfName,
          pdf_sha256: pdfSha256,
          pdf_size: controlled.length,
          source_item_id: sourceItem?.id ?? null,
          source_path: sourceItem && sourceName ? `${folder}/${sourceName}` : null,
          source_file_name: sourceName,
          change_description: changeDescription,
          created_by: lower(actor.email),
          id_request: idRequest,
          signed_content_sha256: draft.sha256,
          manifest_json: JSON.stringify(manifest),
          layout_json: JSON.stringify(built.layout),
        },
      });
      await tx.sgcRequest.update({
        where: { id_request: idRequest },
        data: { id_document: idDocument, id_document_version: version.id_document_version, controlled_pdf_status: 'generado', controlled_pdf_error: null },
      });
      await addInteraction(tx, idRequest, 'sistema', lower(actor.email), `PDF controlado generado: ${code} V${versionNumber} (aprobado, pendiente de divulgación).\nSHA-256 del PDF: ${pdfSha256}\nFirmas en el manifiesto: ${signatures.length}.`, {
        meta: { idDocument, idDocumentVersion: version.id_document_version, pdfSha256, manifestSha256: manifestSha256(manifest) },
      });
      await writeSgcAudit(tx, {
        idCompany: request.id_company,
        actorEmail: actor.email,
        action: SGC_AUDIT_ACTIONS.pdfControladoGenerado,
        entity: 'document_version',
        entityId: version.id_document_version,
        after: { idDocument, code, versionNumber, idRequest, pdfSha256, signedContentSha256: draft.sha256, signatures: manifest.signatures.map((s) => s.uid), path: `${folder}/${pdfName}` },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return { idDocument, idDocumentVersion: version.id_document_version };
    });
    return { ...saved, pdfSha256, created: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markPdfError(db, idRequest, request.id_company, message, actor, isSgcError(e) ? message : PDF_GENERIC_ERROR).catch((err) => console.error('[sgc/pdf-controlado]', err));
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Verificación del PDF controlado y de la cadena de firmas
// ---------------------------------------------------------------------------

export async function verifyDocumentVersion(
  db: SgcDb,
  deps: Pick<SgcSignatureDeps, 'download'>,
  access: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  idDocument: number,
  idVersion: number,
  actor: SgcActor
): Promise<SgcPdfVerification & { hasManifest: boolean; code: string; versionNumber: number }> {
  const found = await getVersionForViewer(db, access, subject, idDocument, idVersion);
  if (!found) throw new SgcError('Documento no encontrado.', 404);
  const bytes = await deps.download(found.version.pdf_item_id);
  let result: SgcPdfVerification;
  if (!found.version.manifest_json) {
    // Vigente cargado en el S1 (carga inicial): solo se verifica la huella del PDF.
    const sha = sha256HexOf(bytes);
    const pdfMatches = sha === found.version.pdf_sha256.trim();
    result = { ok: pdfMatches, pdfSha256: sha, pdfMatches, manifestFound: Boolean(await readManifest(bytes)), manifestSha256: null, manifestMatches: false, signatures: [], problems: pdfMatches ? [] : ['El PDF no coincide con la huella SHA-256 registrada.'] };
  } else {
    const manifest = JSON.parse(found.version.manifest_json) as SgcManifest;
    const rows = await db.sgcSignature.findMany({ where: { signature_uid: { in: manifest.signatures.map((s) => s.uid) } } });
    result = await verifyControlledPdf(bytes, {
      pdfSha256: found.version.pdf_sha256,
      manifestJson: found.version.manifest_json,
      signatures: rows.map((r) => ({ uid: r.signature_uid.trim(), recordHash: r.record_hash.trim(), contentSha256: r.content_sha256.trim(), intact: verifySignatureRow(r) })),
    });
  }
  await writeSgcAudit(db, {
    idCompany: found.document.idCompany,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.pdfControladoVerificado,
    entity: 'document_version',
    entityId: idVersion,
    after: { ok: result.ok, pdfMatches: result.pdfMatches, manifestMatches: result.manifestMatches, problems: result.problems },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ...result, hasManifest: Boolean(found.version.manifest_json), code: found.document.code, versionNumber: found.version.version_number };
}

/**
 * Verifica la cadena completa de firmas de una empresa. Sprint 6: por páginas
 * y solo con las columnas que entran en la huella, para que el costo en
 * memoria no crezca con los años (cada «Leyó» es una firma). Mismo resultado
 * que verifySignatureChain sobre todas las filas.
 */
export async function verifyCompanySignatureChain(db: SgcDb, idCompany: number, pageSize = 2000) {
  let prev: string | null = null;
  let checked = 0;
  let after = 0;
  for (;;) {
    const rows: (SgcSignatureRow & { id_signature: number })[] = await db.sgcSignature.findMany({
      where: { id_company: idCompany, id_signature: { gt: after } },
      orderBy: { id_signature: 'asc' },
      take: pageSize,
      select: SIGNATURE_ROW_SELECT,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      checked += 1;
      const uid = r.signature_uid.trim();
      if (!verifySignatureRow(r)) return { ok: false, checked, brokenAt: uid, problem: 'El registro no coincide con su huella (fue alterado).' };
      if ((r.prev_record_hash?.trim() ?? null) !== prev) return { ok: false, checked, brokenAt: uid, problem: 'La cadena de firmas está rota (falta o sobra un registro).' };
      prev = r.record_hash.trim();
    }
    after = rows[rows.length - 1].id_signature;
    if (rows.length < pageSize) break;
  }
  return { ok: true, checked, brokenAt: null, problem: null };
}

const SIGNATURE_ROW_SELECT = {
  id_signature: true,
  signature_uid: true,
  id_company: true,
  id_request: true,
  id_task: true,
  id_task_assignee: true,
  signer_email: true,
  signer_name: true,
  meaning: true,
  reason: true,
  signed_at: true,
  content_kind: true,
  content_ref: true,
  content_name: true,
  content_sha256: true,
  auth_method: true,
  consent_version: true,
  master_sha256: true,
  ip: true,
  user_agent: true,
  on_behalf_of: true,
  evidence_sha256: true,
  prev_record_hash: true,
  record_hash: true,
} as const;

// ---------------------------------------------------------------------------
// Maestro de firmas (Calidad, en la inducción)
// ---------------------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_MASTER_BYTES = 300 * 1024;

export function getMasterImageError(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string') return 'Dibuje la firma.';
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes) return 'La firma debe ser una imagen PNG.';
  if (bytes.length > MAX_MASTER_BYTES) return 'La imagen de la firma supera 300 KB.';
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'La firma debe ser una imagen PNG.';
  return null;
}

/**
 * Revoca una fila del maestro con un UPDATE simple (sin OUTPUT): la tabla tiene
 * un trigger que solo admite cambiar las columnas de revocación, una vez.
 */
async function revokeRow(tx: Pick<SgcDb, '$executeRaw'>, idMaster: number, at: Date, by: string, reason: string) {
  const n = await tx.$executeRaw`UPDATE [sgc].[signature_master] SET revoked_at = ${at}, revoked_by = ${by}, revoke_reason = ${reason.slice(0, 1000)} WHERE id_signature_master = ${idMaster} AND revoked_at IS NULL`;
  if (n !== 1) throw new SgcError('La firma ya estaba revocada.', 409);
}

/** Sprint 13: ¿la empresa tiene la FIRMA PROPIA encendida? (apagada por defecto; requiere el aval de Adriana Cárdenas). */
export async function isSelfSignatureEnabled(db: Pick<SgcDb, 'sgcCompanyConfig'>, idCompany: number): Promise<boolean> {
  const c = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { self_signature_enabled: true } });
  return Boolean(c?.self_signature_enabled);
}

function masterView(r: Prisma.SgcSignatureMasterGetPayload<object>, nameOf: Map<string, string | null>) {
  return {
    id: r.id_signature_master,
    email: r.user_email,
    name: nameOf.get(lower(r.user_email)) ?? null,
    versionNumber: r.version_number,
    imagePng: r.revoked_at ? null : r.image_png,
    imageSha256: r.image_sha256.trim(),
    registeredBy: r.registered_by,
    registeredAt: r.registered_at.toISOString(),
    reason: r.reason,
    revokedAt: r.revoked_at?.toISOString() ?? null,
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    // Sprint 13: origen, método y validación.
    origin: r.origin as SgcMasterOrigin,
    captureMethod: r.capture_method as SgcCaptureMethod | null,
    status: masterStatus(r),
    validatedBy: r.validated_by,
    validatedAt: r.validated_at?.toISOString() ?? null,
  };
}

export async function listSignatureMasters(db: SgcDb, idCompany: number) {
  const rows = await db.sgcSignatureMaster.findMany({ where: { id_company: idCompany }, orderBy: [{ user_email: 'asc' }, { version_number: 'desc' }] });
  const names = await db.user.findMany({ where: { email: { in: [...new Set(rows.map((r) => r.user_email))] } }, select: { email: true, name: true } });
  const nameOf = new Map(names.map((n) => [lower(n.email), n.name]));
  return rows.map((r) => masterView(r, nameOf));
}

export async function registerSignatureMaster(db: SgcDb, idCompany: number, input: { email: unknown; imagePng: unknown; reason: unknown }, actor: SgcActor) {
  // Sprint 13 (D10): con la firma propia encendida, Calidad ya no registra firmas de otros: solo valida o revoca.
  if (await isSelfSignatureEnabled(db, idCompany)) throw new SgcError('Con la firma propia activa, cada persona registra la suya en «Mi firma»; Aseguramiento de Calidad solo la valida o la revoca.', 409);
  const email = lower(typeof input.email === 'string' ? input.email : '');
  if (!email.includes('@')) throw new SgcError('Indique el correo de la persona.');
  const imgError = getMasterImageError(input.imagePng);
  if (imgError) throw new SgcError(imgError);
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
  if (reason.length < 5) throw new SgcError('Escriba el motivo (p. ej. «Inducción del 2026-10-01»), mínimo 5 caracteres.');
  const eligible = await db.subprocessUserCompany.count({
    where: { subprocess: { subprocess_url: { in: Object.values(SGC_SUBPROCESS_URLS) } }, companyUser: { company: { id_company: idCompany }, user: { email, isActive: true } } },
  });
  if (eligible === 0) throw new SgcError('La persona no tiene permisos del SGC en esta empresa.');
  const image = String(input.imagePng).trim();
  const sha = sha256HexOf(dataUrlToBytes(image)!);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const last = await tx.sgcSignatureMaster.findFirst({ where: { id_company: idCompany, user_email: email }, orderBy: { version_number: 'desc' } });
    if (last && !last.revoked_at) await revokeRow(tx, last.id_signature_master, now, lower(actor.email), `Reemplazada por la versión ${last.version_number + 1}: ${reason}`);
    const row = await tx.sgcSignatureMaster.create({
      data: { id_company: idCompany, user_email: email, version_number: (last?.version_number ?? 0) + 1, image_png: image, image_sha256: sha, registered_by: lower(actor.email), registered_at: now, reason },
    });
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.firmaMaestroRegistrado, entity: 'signature_master', entityId: row.id_signature_master, after: { email, version: row.version_number, sha256: sha }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: row.id_signature_master, versionNumber: row.version_number, sha256: sha };
  });
}

export async function revokeSignatureMaster(db: SgcDb, idCompany: number, idMaster: number, input: { reason: unknown }, actor: SgcActor) {
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
  if (reason.length < 5) throw new SgcError('Escriba el motivo de la revocación (mínimo 5 caracteres).');
  const row = await db.sgcSignatureMaster.findUnique({ where: { id_signature_master: idMaster } });
  if (!row || row.id_company !== idCompany) throw new SgcError('Firma registrada no encontrada.', 404);
  if (row.revoked_at) throw new SgcError('La firma ya estaba revocada.', 409);
  await db.$transaction(async (tx) => {
    await revokeRow(tx, idMaster, new Date(), lower(actor.email), reason);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.firmaMaestroRevocado, entity: 'signature_master', entityId: idMaster, before: { revoked: false }, after: { revoked: true }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sprint 13 (R13): FIRMA PROPIA con validación de Calidad
// ---------------------------------------------------------------------------

async function hasSgcPermission(db: SgcDb, idCompany: number, email: string): Promise<boolean> {
  return (
    (await db.subprocessUserCompany.count({
      where: { subprocess: { subprocess_url: { in: Object.values(SGC_SUBPROCESS_URLS) } }, companyUser: { company: { id_company: idCompany }, user: { email, isActive: true } } },
    })) > 0
  );
}

/** «Mi firma»: si la empresa la tiene encendida, la firma con la que firma hoy y la pendiente de validación. */
export async function getMySignature(db: SgcDb, idCompany: number, email: string) {
  const me = lower(email);
  const enabled = await isSelfSignatureEnabled(db, idCompany);
  const rows = await db.sgcSignatureMaster.findMany({ where: { id_company: idCompany, user_email: me }, orderBy: { version_number: 'desc' }, take: 10 });
  const nameOf = new Map<string, string | null>();
  const views = rows.map((r) => masterView(r, nameOf));
  return {
    enabled,
    active: views.find((v) => v.status === 'validada') ?? null,
    pending: views.find((v) => v.status === 'pendiente') ?? null,
    history: views,
  };
}

/**
 * La persona registra SU firma (correo de la sesión). Queda PENDIENTE: no
 * firma hasta que Calidad la valide; mientras tanto sigue firmando con la
 * validada anterior (si la tiene). Una pendiente anterior se reemplaza.
 */
export async function registerOwnSignature(db: SgcDb, idCompany: number, raw: unknown, actor: SgcActor) {
  const me = lower(actor.email);
  const input = normalizeOwnSignature(raw, me);
  if (!(await isSelfSignatureEnabled(db, idCompany))) throw new SgcError(SGC_SELF_SIGNATURE_DISABLED, 409);
  const imgError = getMasterImageError(input.imagePng);
  if (imgError) throw new SgcError(imgError);
  const bytes = dataUrlToBytes(input.imagePng)!;
  if (!signatureInkBounds(bytes)) throw new SgcError('La imagen no tiene trazo: dibuje su firma o suba una foto clara de ella.');
  if (!(await hasSgcPermission(db, idCompany, me))) throw new SgcError('Usted no tiene permisos del SGC en esta empresa.', 403);
  const sha = sha256HexOf(bytes);
  const now = new Date();
  const reason = `Firma propia registrada por su titular (${input.method === 'dibujada' ? 'dibujada' : 'imagen subida y recortada a la tinta'}).`;
  return db.$transaction(async (tx) => {
    const pending = await tx.sgcSignatureMaster.findMany({ where: { id_company: idCompany, user_email: me, revoked_at: null, validation_status: 'pendiente' } });
    for (const p of pending) await revokeRow(tx, p.id_signature_master, now, me, 'Reemplazada por una nueva firma propia antes de su validación.');
    const last = await tx.sgcSignatureMaster.findFirst({ where: { id_company: idCompany, user_email: me }, orderBy: { version_number: 'desc' } });
    const row = await tx.sgcSignatureMaster.create({
      data: { id_company: idCompany, user_email: me, version_number: (last?.version_number ?? 0) + 1, image_png: input.imagePng, image_sha256: sha, registered_by: me, registered_at: now, reason, origin: 'propia', capture_method: input.method, validation_status: 'pendiente' },
    });
    await writeSgcAudit(tx, { idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.firmaPropiaRegistrada, entity: 'signature_master', entityId: row.id_signature_master, after: { email: me, version: row.version_number, sha256: sha, method: input.method, status: 'pendiente' }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: row.id_signature_master, versionNumber: row.version_number, sha256: sha, status: 'pendiente' as const };
  });
}

/**
 * Calidad VALIDA una firma propia pendiente (una vez; nunca la suya). Las
 * versiones validadas anteriores de esa persona quedan revocadas.
 */
export async function validateSignatureMaster(db: SgcDb, idCompany: number, idMaster: number, input: { reason?: unknown }, actor: SgcActor) {
  const me = lower(actor.email);
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
  if (reason.length < 5) throw new SgcError('Escriba cómo la validó (p. ej. «Comparada con la cédula en la inducción»), mínimo 5 caracteres.');
  const row = await db.sgcSignatureMaster.findUnique({ where: { id_signature_master: idMaster } });
  if (!row || row.id_company !== idCompany) throw new SgcError('Firma registrada no encontrada.', 404);
  const denial = validationDenial(row, me);
  if (denial) throw new SgcError(denial, denial.startsWith('Nadie') ? 403 : 409);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const n = await tx.$executeRaw`UPDATE [sgc].[signature_master] SET validation_status = N'validada', validated_by = ${me}, validated_at = ${now} WHERE id_signature_master = ${idMaster} AND validation_status = N'pendiente' AND revoked_at IS NULL`;
    if (n !== 1) throw new SgcError('La firma ya no está pendiente de validación.', 409);
    const older = await tx.sgcSignatureMaster.findMany({ where: { id_company: idCompany, user_email: row.user_email, revoked_at: null, validation_status: 'validada', version_number: { lt: row.version_number } } });
    for (const o of older) await revokeRow(tx, o.id_signature_master, now, me, `Reemplazada por la versión ${row.version_number} validada.`);
    await writeSgcAudit(tx, { idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.firmaPropiaValidada, entity: 'signature_master', entityId: idMaster, before: { status: 'pendiente' }, after: { status: 'validada', email: row.user_email, version: row.version_number }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
  });
  return { ok: true, status: 'validada' as const };
}
