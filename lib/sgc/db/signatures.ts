import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { buildCodeRoot, buildDocumentCode, nextSequence } from '../coding';
import { SGC_SUBPROCESS_URLS } from '../constants';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError } from '../errors';
import { SGC_SIGNATURE_LABELS, type SgcSignatureMeaning } from '../flows/definition';
import type { SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import { buildControlledPdf, manifestSha256, readManifest, verifyControlledPdf, type SgcManifest, type SgcPdfVerification } from '../pdf/controlledPdf';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from '../pdf/render';
import { SGC_SIGNATURE_CONSENT_VERSION } from '../signature/consent';
import { consentTextSha256, sha256HexOf, validateSignInput, verifySignatureChain, verifySignatureRow } from '../signature/record';
import { assertReauthNotLocked, type SgcPasswordVerifier } from '../signature/reauth';
import { buildVersionFileName, buildVersionFolderSegments, isPdf } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import { getVersionForViewer, type SgcUploader } from './documents';
import { addInteraction, decideTask, requestOfTask } from './requests';
import { currentDraftInTx } from './signatureRecord';

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

/** Descarga y VERIFICA el borrador vigente (lo que se va a firmar). */
async function loadVerifiedDraft(db: SgcDb, deps: SgcSignatureDeps, idRequest: number) {
  const draft = await currentDraftInTx(db as never, idRequest);
  if (!draft) throw new SgcError('La solicitud no tiene borrador para firmar.', 409);
  if (draft.kind === 'borrador_adjunto') {
    const bytes = await deps.download(draft.itemId!);
    if (sha256HexOf(bytes) !== draft.sha256) {
      throw new SgcError('El borrador guardado no coincide con su huella registrada (SHA-256): no se puede firmar. Avise a Calidad.', 409);
    }
    return { draft, bytes, html: null as string | null };
  }
  const id = Number(draft.ref.split(':')[1]);
  const rev = await db.sgcDraftRevision.findUniqueOrThrow({ where: { id_draft_revision: id } });
  if (sha256HexOf(rev.content_html) !== draft.sha256) {
    throw new SgcError('La revisión del borrador no coincide con su huella registrada (SHA-256): no se puede firmar. Avise a Calidad.', 409);
  }
  return { draft, bytes: null as Uint8Array | null, html: rev.content_html };
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
  const input = validateSignInput(raw, (task.taskDef.signature_meaning as SgcSignatureMeaning | null) ?? null);

  await assertReauthNotLocked(db, email, now);
  const ok = await deps.verifyPassword(email, input.password);
  if (!ok) {
    await writeSgcAudit(db, {
      idCompany,
      actorEmail: email,
      action: SGC_AUDIT_ACTIONS.firmaReautenticacionFallida,
      entity: 'task',
      entityId: idTask,
      detail: `Reautenticación fallida al firmar «${SGC_SIGNATURE_LABELS[input.meaning]}» (solicitud #${idRequest}). No se firmó.`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    throw new SgcError('Contraseña incorrecta: no se firmó. Escriba su contraseña de SynerLink.', 403);
  }

  await ensureConsent(db, idCompany, actor, now);
  const { draft } = await loadVerifiedDraft(db, deps, idRequest);
  if ((raw.draftRef !== undefined && raw.draftRef !== draft.ref) || (raw.draftSha256 !== undefined && raw.draftSha256 !== draft.sha256)) {
    throw new SgcError('El borrador cambió desde que abrió la tarea: revíselo de nuevo antes de firmar.', 409);
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
      controlledPdf = { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ...result, controlledPdf };
}

// ---------------------------------------------------------------------------
// PDF controlado
// ---------------------------------------------------------------------------

async function finalSignatures(db: SgcDb, idRequest: number) {
  const tasks = await db.sgcTask.findMany({ where: { id_request: idRequest, status: 'resuelta' }, include: { taskDef: true }, orderBy: { id_task: 'asc' } });
  const lastByKey = new Map<string, number>();
  for (const t of tasks) if (t.taskDef.signature_meaning) lastByKey.set(t.task_key, t.id_task);
  const ids = [...lastByKey.values()];
  if (ids.length === 0) return [];
  return db.sgcSignature.findMany({ where: { id_request: idRequest, id_task: { in: ids } }, orderBy: [{ signed_at: 'asc' }, { id_signature: 'asc' }] });
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null;
}

async function markPdfError(db: SgcDb, idRequest: number, idCompany: number, message: string, actor: SgcActor) {
  await db.$transaction(async (tx) => {
    await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { controlled_pdf_status: 'error', controlled_pdf_error: message.slice(0, 1000) } });
    await addInteraction(tx, idRequest, 'sistema', lower(actor.email), `No se pudo generar el PDF controlado: ${message}\nCalidad puede reintentarlo desde la solicitud.`);
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
    const offContent = signatures.filter((s) => s.content_sha256.trim() !== draft.sha256);
    if (offContent.length) throw new SgcError('Hay firmas sobre un contenido distinto del borrador vigente: no se genera el PDF controlado.', 409);
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
      const guide = await db.sgcCodingGuide.findUnique({ where: { id_company: request.id_company } });
      if (!guide) throw new SgcError('La empresa no tiene guía de codificación: configúrela para generar el código del documento nuevo.', 409);
      const g = { prefix: guide.prefix, pattern: guide.pattern, sequenceDigits: guide.sequence_digits };
      const parts = { processTypeCode: request.processMap.processType.code, processCode: request.processMap.code, documentTypeCode: request.documentType.code };
      const existing = await db.sgcDocument.findMany({ where: { id_company: request.id_company, code: { startsWith: buildCodeRoot(g, parts) } }, select: { code: true } });
      sequence = nextSequence(g, parts, existing.map((e) => e.code));
      code = buildDocumentCode(g, parts, sequence);
      title = request.subject.slice(0, 300);
      versionNumber = 1;
    }

    // Contenido → PDF.
    let contentPdf: Uint8Array;
    let source: { bytes: Uint8Array; ext: string; contentType: string } | null = null;
    if (draft.format === 'pdf') {
      if (!bytes || !isPdf(bytes)) throw new SgcError('El borrador PDF no es un PDF válido.', 409);
      contentPdf = bytes;
    } else if (draft.format === 'docx') {
      const converted = await deps.docxToHtml(bytes!);
      contentPdf = await deps.htmlToPdf(wrapDraftForPdf({ title, code, contentHtml: converted }));
      source = { bytes: bytes!, ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    } else if (draft.format === 'html') {
      contentPdf = await deps.htmlToPdf(wrapDraftForPdf({ title, code, contentHtml: html! }));
      source = { bytes: new TextEncoder().encode(html!), ext: 'html', contentType: 'text/html; charset=utf-8' };
    } else {
      throw new SgcError('El borrador debe ser PDF, Word (.docx) o editado en la app.', 409);
    }

    const changeValue = request.formValues.find((v) => v.field.field_key === 'resumen_cambios')?.value_text ?? null;
    const changeDescription = (changeValue || request.description).slice(0, 2000);
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
      approvedAt: approvals.at(-1)!.signed_at.toISOString(),
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
      })),
      verifyUrl: `${deps.appUrl.replace(/\/+$/, '')}/process/sgc-documental/listado?empresa=${request.id_company}&q=${encodeURIComponent(code)}`,
    };
    const masterIds = [...new Set(signatures.map((s) => s.id_signature_master).filter((x): x is number => !!x))];
    const masters = masterIds.length ? await db.sgcSignatureMaster.findMany({ where: { id_signature_master: { in: masterIds } } }) : [];
    const masterPng: Record<string, Uint8Array> = {};
    for (const s of signatures) {
      const m = masters.find((x) => x.id_signature_master === s.id_signature_master);
      const png = m ? dataUrlToBytes(m.image_png) : null;
      if (png) masterPng[s.signature_uid.trim()] = png;
    }
    const controlled = await buildControlledPdf(contentPdf, manifest, masterPng);
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
    await markPdfError(db, idRequest, request.id_company, message, actor).catch((err) => console.error('[sgc/pdf-controlado]', err));
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

/** Verifica la cadena completa de firmas de una empresa. */
export async function verifyCompanySignatureChain(db: SgcDb, idCompany: number) {
  const rows = await db.sgcSignature.findMany({ where: { id_company: idCompany }, orderBy: { id_signature: 'asc' } });
  return verifySignatureChain(rows);
}

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

export async function listSignatureMasters(db: SgcDb, idCompany: number) {
  const rows = await db.sgcSignatureMaster.findMany({ where: { id_company: idCompany }, orderBy: [{ user_email: 'asc' }, { version_number: 'desc' }] });
  const names = await db.user.findMany({ where: { email: { in: [...new Set(rows.map((r) => r.user_email))] } }, select: { email: true, name: true } });
  const nameOf = new Map(names.map((n) => [lower(n.email), n.name]));
  return rows.map((r) => ({
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
  }));
}

export async function registerSignatureMaster(db: SgcDb, idCompany: number, input: { email: unknown; imagePng: unknown; reason: unknown }, actor: SgcActor) {
  const email = lower(typeof input.email === 'string' ? input.email : '');
  if (!email.includes('@')) throw new SgcError('Indique el correo de la persona.');
  const imgError = getMasterImageError(input.imagePng);
  if (imgError) throw new SgcError(imgError);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
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
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
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
