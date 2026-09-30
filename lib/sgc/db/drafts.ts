import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { getDraftHtmlError, sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';
import type { SgcDocxToHtml } from '../pdf/render';
import { sha256HexOf } from '../signature/record';
import { isWord } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import { addInteraction, assertCanView, type SgcViewer } from './requests';

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

const ORIGINS = ['blanco', 'vigente', 'word', 'revision'] as const;
type Origin = (typeof ORIGINS)[number];

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
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
  return {
    request: { id: row.id_request, subject: row.subject, status: row.status, elaboratorEmail: row.elaborator_email, idCompany: row.id_company },
    document: doc ? { code: doc.code, title: doc.title } : null,
    vigente: vigente ? { versionNumber: vigente.version_number, hasWord: Boolean(vigente.source_item_id && /\.docx$/i.test(vigente.source_file_name ?? '')) } : null,
    canEdit:
      row.status === 'abierta' &&
      lower(row.elaborator_email) === lower(viewer.email) &&
      row.tasks.some((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador'),
    revisions: revs.map((r) => ({ id: r.id_draft_revision, number: r.revision_number, origin: r.origin, originRef: r.origin_ref, sha256: r.sha256.trim(), sizeBytes: r.size_bytes, note: r.note, savedBy: r.saved_by, savedAt: r.saved_at.toISOString() })),
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
  input: { html: unknown; note?: unknown; origin?: unknown; originRef?: unknown },
  viewer: SgcViewer,
  actor: SgcActor
) {
  const error = getDraftHtmlError(input.html);
  if (error) throw new SgcError(error);
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
    return { id: rev.id_draft_revision, number: rev.revision_number, sha256: sha, unchanged: false };
  });
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
