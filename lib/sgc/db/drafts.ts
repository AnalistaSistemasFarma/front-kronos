import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { getDraftHtmlError, sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';
import { SGC_NOTIFICATION_TITLES, noopNotifier, recipients, requestUrl, type SgcNotifier } from '../notifications';
import type { SgcDocxToHtml } from '../pdf/render';
import { sha256HexOf } from '../signature/record';
import { isWord } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import { addInteraction, assertCanView, type SgcViewer } from './requests';
import { currentDraftInTx } from './signatureRecord';

/**
 * EDICIÓN EN LA APP del borrador (Sprint 3; pasó del S2 al S3).
 *
 * El elaborador puede, durante la Elaboración, editar el borrador con el
 * editor de la app (Tiptap): partiendo de la versión VIGENTE (su Word fuente
 * convertido con mammoth), de un Word que sube, o en blanco. CONTROL DE
 * VERSIONES: cada guardado es una revisión NUEVA en sgc.draft_revision (solo
 * inserción) con su SHA-256, quién y cuándo; nada se sobrescribe. La última
 * revisión (o el último archivo cargado, lo más reciente) es el borrador que
 * se firma y del que sale el PDF controlado.
 */

const ORIGINS = ['blanco', 'vigente', 'word', 'revision', 'plantilla'] as const;
type Origin = (typeof ORIGINS)[number];

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * REVISIÓN MENOR de Calidad (correcciones 2026-10-02/03): durante la
 * APROBACIÓN, Aseguramiento de Calidad puede corregir la forma (una margen,
 * una coma) sin devolver el documento. Nunca en silencio: es una revisión
 * NUEVA del borrador con motivo obligatorio (mín. 10 caracteres), la huella
 * del contenido que corrige y su propia huella; queda en el historial, la
 * auditoría y el manifiesto del PDF controlado, y se avisa al elaborador y a
 * quienes ya firmaron. Las firmas hechas antes siguen valiendo sobre el
 * contenido que corrigió; la aprobación de Calidad va sobre el contenido final.
 */
function qualityMinorWindow(row: { status: string; elaborator_email: string; tasks: { status: string; taskDef: { assignment: string; signature_meaning: string | null } }[] }, access: { canQuality: boolean }, email: string): boolean {
  return (
    row.status === 'abierta' &&
    access.canQuality &&
    lower(row.elaborator_email) !== lower(email) &&
    row.tasks.some((t) => t.status === 'abierta' && t.taskDef.assignment === 'firmantes' && t.taskDef.signature_meaning === 'aprobo')
  );
}

export interface SgcMinorRevisionLink {
  revision: number;
  baseSha256: string;
  newSha256: string;
  reason: string;
  by: string;
  at: Date;
}

/**
 * Cadena de revisiones menores que termina en el contenido actual (de la más
 * antigua a la más reciente). Vacía si el borrador vigente no es una revisión menor.
 */
export async function minorRevisionChain(db: SgcDb | Prisma.TransactionClient, idRequest: number, currentSha: string): Promise<SgcMinorRevisionLink[]> {
  const minors = await db.sgcDraftRevision.findMany({ where: { id_request: idRequest, minor_reason: { not: null } }, orderBy: { revision_number: 'desc' }, select: { revision_number: true, sha256: true, base_sha256: true, minor_reason: true, saved_by: true, saved_at: true } });
  const out: SgcMinorRevisionLink[] = [];
  let sha = currentSha;
  for (const m of minors) {
    if (m.sha256.trim() !== sha || !m.base_sha256) continue;
    out.unshift({ revision: m.revision_number, baseSha256: m.base_sha256.trim(), newSha256: sha, reason: m.minor_reason ?? '', by: m.saved_by, at: m.saved_at });
    sha = m.base_sha256.trim();
  }
  return out;
}

async function assertElaborating(db: SgcDb, idRequest: number, viewer: SgcViewer, actor: SgcActor) {
  const { row } = await assertCanView(db, idRequest, viewer);
  if (row.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
  if (lower(row.elaborator_email) !== lower(actor.email)) throw new SgcError('Solo el elaborador edita el borrador del documento.', 403);
  const open = row.tasks.find((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador');
  if (!open) throw new SgcError('El borrador se edita durante la elaboración.', 409);
  return row;
}

export async function listDraftRevisions(db: SgcDb, idRequest: number, viewer: SgcViewer) {
  const { row } = await assertCanView(db, idRequest, viewer);
  const revs = await db.sgcDraftRevision.findMany({ where: { id_request: idRequest }, orderBy: { revision_number: 'desc' }, select: { id_draft_revision: true, revision_number: true, origin: true, origin_ref: true, sha256: true, size_bytes: true, note: true, saved_by: true, saved_at: true } });
  const doc = row.id_document ? await db.sgcDocument.findUnique({ where: { id_document: row.id_document }, select: { code: true, title: true, current_version_id: true } }) : null;
  const vigente = doc?.current_version_id ? await db.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id }, select: { version_number: true, source_item_id: true, source_file_name: true } }) : null;
  const access = viewer.access.find((a) => a.idCompany === row.id_company);
  const minorInfo = await db.sgcDraftRevision.findMany({ where: { id_request: idRequest, minor_reason: { not: null } }, select: { id_draft_revision: true, minor_reason: true, base_sha256: true } });
  const minorById = new Map(minorInfo.map((m) => [m.id_draft_revision, m]));
  return {
    request: { id: row.id_request, subject: row.subject, status: row.status, elaboratorEmail: row.elaborator_email, idCompany: row.id_company },
    // 2026-10-03: Calidad puede hacer una REVISIÓN MENOR durante la aprobación (con motivo).
    canMinorRevise: Boolean(access && qualityMinorWindow(row, access, viewer.email)),
    document: doc ? { code: doc.code, title: doc.title } : null,
    vigente: vigente ? { versionNumber: vigente.version_number, hasWord: Boolean(vigente.source_item_id && /\.docx$/i.test(vigente.source_file_name ?? '')) } : null,
    canEdit:
      row.status === 'abierta' &&
      lower(row.elaborator_email) === lower(viewer.email) &&
      row.tasks.some((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador'),
    revisions: revs.map((r) => ({ id: r.id_draft_revision, number: r.revision_number, origin: r.origin, originRef: r.origin_ref, sha256: r.sha256.trim(), sizeBytes: r.size_bytes, note: r.note, savedBy: r.saved_by, savedAt: r.saved_at.toISOString(), minorReason: minorById.get(r.id_draft_revision)?.minor_reason ?? null, baseSha256: minorById.get(r.id_draft_revision)?.base_sha256?.trim() ?? null })),
  };
}

/** Contenido de una revisión (verificando su huella: si no coincide, no se muestra). */
export async function getDraftRevision(db: SgcDb, idRequest: number, idRevision: number | 'ultima', viewer: SgcViewer) {
  await assertCanView(db, idRequest, viewer);
  const rev =
    idRevision === 'ultima'
      ? await db.sgcDraftRevision.findFirst({ where: { id_request: idRequest }, orderBy: { revision_number: 'desc' } })
      : await db.sgcDraftRevision.findFirst({ where: { id_request: idRequest, id_draft_revision: idRevision } });
  if (!rev) throw new SgcError('Revisión no encontrada.', 404);
  if (sha256HexOf(rev.content_html) !== rev.sha256.trim()) throw new SgcError('La revisión no coincide con su huella registrada (SHA-256). Avise a Calidad.', 409);
  return { id: rev.id_draft_revision, number: rev.revision_number, origin: rev.origin, html: rev.content_html, sha256: rev.sha256.trim(), savedBy: rev.saved_by, savedAt: rev.saved_at.toISOString(), note: rev.note };
}

export async function saveDraftRevision(
  db: SgcDb,
  idRequest: number,
  input: { html: unknown; note?: unknown; origin?: unknown; originRef?: unknown; minor?: unknown; minorReason?: unknown },
  viewer: SgcViewer,
  actor: SgcActor,
  notifier: SgcNotifier = noopNotifier
) {
  const error = getDraftHtmlError(input.html);
  if (error) throw new SgcError(error);
  if (input.minor === true) return saveMinorRevision(db, idRequest, input, viewer, actor, notifier);
  const row = await assertElaborating(db, idRequest, viewer, actor);
  const html = sanitizeDraftHtml(String(input.html));
  const origin: Origin = (ORIGINS as readonly string[]).includes(String(input.origin)) ? (input.origin as Origin) : 'revision';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null;
  const originRef = typeof input.originRef === 'string' ? input.originRef.trim().slice(0, 200) || null : null;
  const sha = sha256HexOf(html);
  const size = new TextEncoder().encode(html).length;
  return db.$transaction(async (tx) => {
    const last = await tx.sgcDraftRevision.findFirst({ where: { id_request: idRequest }, orderBy: { revision_number: 'desc' }, select: { revision_number: true, sha256: true } });
    if (last && last.sha256.trim() === sha) return { id: null, number: last.revision_number, sha256: sha, unchanged: true };
    const rev = await tx.sgcDraftRevision.create({
      data: { id_request: idRequest, revision_number: (last?.revision_number ?? 0) + 1, origin, origin_ref: originRef, content_html: html, sha256: sha, size_bytes: size, note, saved_by: lower(actor.email), saved_at: new Date() },
    });
    await addInteraction(tx, idRequest, 'adjunto', lower(actor.email), `Guardó la revisión ${rev.revision_number} del borrador en el editor de la app${note ? `: ${note}` : '.'}\nSHA-256: ${sha}`, { meta: { idDraftRevision: rev.id_draft_revision, sha256: sha, origin } });
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.borradorGuardado, entity: 'draft_revision', entityId: rev.id_draft_revision, after: { idRequest, revision: rev.revision_number, sha256: sha, size, origin }, ip: actor.ip, userAgent: actor.userAgent });
    // Partir de la plantilla institucional deja el documento con el encabezado del sistema (el elaborador lo puede quitar).
    if (origin === 'plantilla') {
      const last = await tx.sgcDocumentLayout.findFirst({ where: { id_request: idRequest }, orderBy: { id_document_layout: 'desc' } });
      if (!last || !last.institutional_header) {
        await tx.sgcDocumentLayout.create({ data: { id_request: idRequest, institutional_header: true, fields_json: last?.fields_json ?? '[]', content_sha256: sha, saved_by: lower(actor.email), saved_at: new Date(), change_reason: 'El borrador parte de la plantilla institucional: el sistema pone el encabezado.' } });
      }
    }
    return { id: rev.id_draft_revision, number: rev.revision_number, sha256: sha, unchanged: false };
  });
}

async function saveMinorRevision(
  db: SgcDb,
  idRequest: number,
  input: { html: unknown; minorReason?: unknown },
  viewer: SgcViewer,
  actor: SgcActor,
  notifier: SgcNotifier
) {
  const { row, access } = await assertCanView(db, idRequest, viewer);
  if (!qualityMinorWindow(row, access, actor.email)) {
    throw new SgcError('La revisión menor la hace Aseguramiento de Calidad mientras el documento está en aprobación (y no puede ser el elaborador).', 403);
  }
  const reason = typeof input.minorReason === 'string' ? input.minorReason.trim() : '';
  if (reason.length < 10) throw new SgcError('Escriba el motivo de la revisión menor (mínimo 10 caracteres): qué corrigió y por qué.');
  const html = sanitizeDraftHtml(String(input.html));
  const sha = sha256HexOf(html);
  const size = new TextEncoder().encode(html).length;
  const result = await db.$transaction(async (tx) => {
    const current = await currentDraftInTx(tx, idRequest);
    if (!current) throw new SgcError('La solicitud no tiene borrador.', 409);
    if (current.sha256 === sha) throw new SgcError('No hay cambios frente al borrador vigente.', 409);
    const last = await tx.sgcDraftRevision.findFirst({ where: { id_request: idRequest }, orderBy: { revision_number: 'desc' }, select: { revision_number: true } });
    const rev = await tx.sgcDraftRevision.create({
      data: { id_request: idRequest, revision_number: (last?.revision_number ?? 0) + 1, origin: 'revision', origin_ref: current.name.slice(0, 200), content_html: html, sha256: sha, size_bytes: size, note: 'Revisión menor de Calidad', saved_by: lower(actor.email), saved_at: new Date(), minor_reason: reason.slice(0, 1000), base_sha256: current.sha256 },
    });
    await addInteraction(tx, idRequest, 'adjunto', lower(actor.email), `Revisión menor de Calidad (revisión ${rev.revision_number} del borrador) sin devolver el documento.\nMotivo: ${reason}\nContenido corregido: ${current.name} · SHA-256 ${current.sha256}\nNuevo contenido: SHA-256 ${sha}`, {
      meta: { idDraftRevision: rev.id_draft_revision, minor: true, baseSha256: current.sha256, sha256: sha },
    });
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.revisionMenorCalidad, entity: 'draft_revision', entityId: rev.id_draft_revision, before: { sha256: current.sha256, ref: current.ref }, after: { idRequest, revision: rev.revision_number, sha256: sha, size }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    const signed = await tx.sgcSignature.findMany({ where: { id_request: idRequest, meaning: { in: ['elaboro', 'reviso', 'aprobo'] } }, select: { signer_email: true } });
    return { id: rev.id_draft_revision, number: rev.revision_number, emails: [row.elaborator_email, row.requester_email, ...signed.map((s) => s.signer_email)] };
  });
  const people = recipients(result.emails, actor.email);
  if (people.length) {
    await notifier([{ emails: people, payload: { title: SGC_NOTIFICATION_TITLES.revisionMenor, body: `#${idRequest} · Calidad hizo una revisión menor: ${reason}`.slice(0, 300), url: requestUrl(idRequest), tag: `sgc-request-${idRequest}` } }]).catch((e) => console.error('[sgc/revision-menor] aviso', e));
  }
  return { id: result.id, number: result.number, sha256: sha, unchanged: false, minor: true };
}

/** HTML del borrador VIGENTE (para que Calidad haga la revisión menor sobre él): revisión del editor o Word convertido. */
export async function getCurrentDraftHtml(db: SgcDb, deps: { download: (itemId: string) => Promise<Uint8Array>; docxToHtml: SgcDocxToHtml }, idRequest: number, viewer: SgcViewer) {
  const { row, access } = await assertCanView(db, idRequest, viewer);
  if (!qualityMinorWindow(row, access, viewer.email)) throw new SgcError('La revisión menor la hace Aseguramiento de Calidad mientras el documento está en aprobación.', 403);
  const current = await currentDraftInTx(db as never, idRequest);
  if (!current) throw new SgcError('La solicitud no tiene borrador.', 409);
  if (current.kind === 'borrador_editor') {
    const rev = await db.sgcDraftRevision.findUniqueOrThrow({ where: { id_draft_revision: Number(current.ref.split(':')[1]) } });
    if (sha256HexOf(rev.content_html) !== current.sha256) throw new SgcError('La revisión no coincide con su huella registrada (SHA-256). Avise a Tecnología.', 409);
    return { html: rev.content_html, originRef: current.name, baseSha256: current.sha256 };
  }
  if (current.format !== 'docx') throw new SgcError('El borrador vigente es un PDF: la revisión menor se hace sobre un Word o un borrador editado en la app. Devuélvalo con observaciones.', 409);
  const bytes = await deps.download(current.itemId!);
  if (sha256HexOf(bytes) !== current.sha256) throw new SgcError('El borrador guardado no coincide con su huella registrada (SHA-256). Avise a Tecnología.', 409);
  return { html: await deps.docxToHtml(bytes), originRef: current.name, baseSha256: current.sha256 };
}

/** HTML de partida desde la versión VIGENTE del documento (su Word fuente). */
export async function getVigenteBaseHtml(db: SgcDb, deps: { download: (itemId: string) => Promise<Uint8Array>; docxToHtml: SgcDocxToHtml }, idRequest: number, viewer: SgcViewer, actor: SgcActor) {
  const row = await assertElaborating(db, idRequest, viewer, actor);
  if (!row.id_document) throw new SgcError('Es un documento nuevo: no hay versión vigente de partida.', 409);
  const doc = await db.sgcDocument.findUniqueOrThrow({ where: { id_document: row.id_document } });
  const v = doc.current_version_id ? await db.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id } }) : null;
  if (!v || !v.source_item_id || !/\.docx$/i.test(v.source_file_name ?? '')) {
    throw new SgcError('La versión vigente no tiene Word fuente (.docx): suba el Word para editarlo en la app.', 409);
  }
  const bytes = await deps.download(v.source_item_id);
  return { html: await deps.docxToHtml(bytes), originRef: `${doc.code} V${v.version_number}` };
}

/** Convierte un Word (.docx) subido en HTML para el editor (no guarda nada hasta «Guardar revisión»). */
export async function importWordToHtml(db: SgcDb, deps: { docxToHtml: SgcDocxToHtml }, idRequest: number, file: { fileName: string; bytes: Uint8Array }, viewer: SgcViewer, actor: SgcActor) {
  await assertElaborating(db, idRequest, viewer, actor);
  if (!file.bytes.length) throw new SgcError('El archivo está vacío.');
  if (file.bytes.length > 25 * 1024 * 1024) throw new SgcError('El archivo supera 25 MB.');
  if (!isWord(file.bytes, file.fileName) || !/\.docx$/i.test(file.fileName)) throw new SgcError('Suba un Word .docx.');
  return { html: await deps.docxToHtml(file.bytes), originRef: file.fileName.slice(0, 200) };
}
