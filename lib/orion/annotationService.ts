import 'server-only';
import { createHash } from 'crypto';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { oneDriveRoot } from '@/lib/onedrive/root';
import {
  downloadOneDriveItemContent,
  ensureFolderAndUploadFile,
  listOneDriveFolderFiles,
} from '@/lib/onedrive/graphFolderUpload';
import {
  SEAL_MAX_BYTES,
  SEAL_MIME_TYPES,
  describeAnnotationChanges,
  documentFullySigned,
  documentHasCompletedSignature,
  emailHasSigned,
  nextAnnotatedCopyName,
  normalizeAnnotationsInput,
} from './annotations';
import { stampAnnotations, type SealImageBytes } from './annotationStamp';
import { fetchOrionSignedFileContent } from './client';
import { getOrionDocumentFromBag, setOrionDocumentInBag } from './formValue';
import { applyValidatorMarks } from './validatorMarks';
import {
  assertUserIsOrionDocumentPreparer,
  insertRequestNote,
  loadOrionFormBagEnsured,
  upsertOrionFormBag,
} from './service';
import type { OrionAnnotatedCopy, OrionSignatureState } from './types';

type SqlPool = import('mssql').ConnectionPool;

export type AnnotationRequestActor = {
  userId: string;
  email: string;
  name?: string | null;
};

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Imágenes de sellos: subcarpeta de la solicitud (las carpetas no salen en la lista de adjuntos). */
function sealFolderSegments(requestId: number, fileId: string): string[] {
  const safeId = String(fileId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'documento';
  return [oneDriveRoot(), 'TEC', 'SG', `Request-${requestId}`, '_sellos', safeId];
}

/** Copias congeladas "Datos N" del documento. */
function annotatedCopyFolderSegments(requestId: number, fileId: string): string[] {
  const safeId = String(fileId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'documento';
  return [oneDriveRoot(), 'TEC', 'SG', `Request-${requestId}`, '_versiones-datos', safeId];
}

async function graphToken(): Promise<string> {
  const token = await getMicrosoftToken();
  if (!token) throw httpError('No se pudo conectar con OneDrive. Intente de nuevo.', 502);
  return token;
}

/**
 * Pueden agregar datos y sellos: el preparador del flujo o un administrador en cualquier
 * momento (los sellos se ubican al preparar, junto a las firmas), y quien ya firmó el
 * documento, después de su firma.
 */
async function assertCanAnnotate(
  pool: SqlPool,
  params: { requestId: number; state: OrionSignatureState; actor: AnnotationRequestActor; isAdmin: boolean }
): Promise<void> {
  if (params.isAdmin) return;
  if (documentHasCompletedSignature(params.state) && emailHasSigned(params.state, params.actor.email)) {
    return;
  }
  try {
    await assertUserIsOrionDocumentPreparer(pool, {
      requestId: params.requestId,
      userId: params.actor.userId,
      userEmail: params.actor.email,
    });
  } catch {
    throw httpError(
      'Solo el preparador, quien ya firmó el documento o un administrador puede agregar datos y sellos.',
      403
    );
  }
}

async function loadDocumentForAnnotation(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: AnnotationRequestActor; isAdmin: boolean }
) {
  const loaded = await loadOrionFormBagEnsured(pool, params.requestId);
  const state = getOrionDocumentFromBag(loaded.bag, params.fileId);
  await assertCanAnnotate(pool, { ...params, state });
  return { loaded, state };
}

/** Sube la imagen de un sello y devuelve el id con el que se ubica en el documento. */
export async function uploadAnnotationSeal(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: AnnotationRequestActor;
    isAdmin: boolean;
    fileName: string;
    mime: string;
    bytes: Buffer;
  }
): Promise<{ sealItemId: string; sealFileName: string }> {
  await loadDocumentForAnnotation(pool, params);
  const mime = String(params.mime || '').toLowerCase();
  if (!(SEAL_MIME_TYPES as readonly string[]).includes(mime)) {
    throw httpError('El sello debe ser una imagen PNG o JPG.', 415);
  }
  if (params.bytes.byteLength === 0 || params.bytes.byteLength > SEAL_MAX_BYTES) {
    throw httpError('La imagen del sello debe pesar máximo 2 MB.', 413);
  }
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const sealFileName = `sello-${Date.now()}.${ext}`;
  const token = await graphToken();
  const uploaded = await ensureFolderAndUploadFile(
    token,
    sealFolderSegments(params.requestId, params.fileId),
    sealFileName,
    params.bytes as unknown as BodyInit,
    mime
  );
  return { sealItemId: String(uploaded.id), sealFileName };
}

/** Imagen de un sello del documento (para verlo en el editor). */
export async function readAnnotationSeal(
  pool: SqlPool,
  params: { requestId: number; fileId: string; itemId: string; actor: AnnotationRequestActor; isAdmin: boolean }
): Promise<SealImageBytes> {
  await loadDocumentForAnnotation(pool, params);
  const token = await graphToken();
  const files = await listOneDriveFolderFiles(token, sealFolderSegments(params.requestId, params.fileId));
  if (!files.some((f) => f.id === params.itemId)) throw httpError('Sello no encontrado.', 404);
  const content = await downloadOneDriveItemContent(token, params.itemId);
  if (!content) throw httpError('Sello no encontrado.', 404);
  return { bytes: content.buffer, mime: content.contentType };
}

/** Guarda la lista completa de datos y sellos del documento y deja nota en el historial. */
export async function saveDocumentAnnotations(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    annotations: unknown;
    actor: AnnotationRequestActor;
    isAdmin: boolean;
  }
): Promise<{ state: OrionSignatureState; documents: Record<string, OrionSignatureState> }> {
  const { loaded, state: current } = await loadDocumentForAnnotation(pool, params);
  const previous = current.annotations ?? [];
  const next = normalizeAnnotationsInput(params.annotations, previous, params.actor);
  const fullySigned = documentFullySigned(current);
  // A mitad de las firmas, el siguiente firmante firmaría sobre otra cosa: datos solo al final.
  if (!fullySigned && next.some((a) => a.kind === 'text')) {
    throw httpError('Los datos se agregan cuando el documento tenga todas las firmas.', 409);
  }

  // Un sello solo puede apuntar a imágenes subidas para ESTE documento.
  const sealIds = [...new Set(next.filter((a) => a.kind === 'seal').map((a) => String(a.sealItemId)))];
  if (sealIds.length > 0) {
    const token = await graphToken();
    const files = await listOneDriveFolderFiles(token, sealFolderSegments(params.requestId, params.fileId));
    const known = new Set(files.map((f) => f.id));
    if (sealIds.some((id) => !known.has(id))) {
      throw httpError('Uno de los sellos no pertenece a este documento. Vuelva a cargarlo.', 400);
    }
  }

  const summary = describeAnnotationChanges(previous, next);
  if (!summary) {
    return { state: current, documents: loaded.bag.documents };
  }

  let state: OrionSignatureState = { ...current, annotations: next };
  // Con todas las firmas, cada guardado deja su copia congelada (antes de guardar el estado:
  // si la copia falla, no queda nada a medias).
  let copy: OrionAnnotatedCopy | null = null;
  if (fullySigned) {
    copy = await createAnnotatedCopy({ ...params, state });
    state = { ...state, annotatedCopies: [...(current.annotatedCopies ?? []), copy] };
  }
  const bag = setOrionDocumentInBag(loaded.bag, params.fileId, state);
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);

  try {
    const copyNote = copy ? ` — quedó la copia "${copy.label}" (SHA-256 ${copy.sha256.slice(0, 16)}...)` : '';
    await insertRequestNote(
      pool,
      params.requestId,
      `${state.fileName || 'Documento'}: datos después de firmar — ${summary}${copyNote} — por ${params.actor.name || params.actor.email}`,
      params.actor.userId
    );
  } catch (err) {
    console.warn('[orion/annotations] nota del historial:', err);
  }

  return { state: getOrionDocumentFromBag(bag, params.fileId), documents: bag.documents };
}

/**
 * PDF firmado de Orion (todas las firmas, SIN marca de agua) + visto bueno de validadores +
 * datos y sellos, guardado en OneDrive. La marca de agua se pone al servirlo, no aquí.
 */
async function createAnnotatedCopy(params: {
  requestId: number;
  fileId: string;
  state: OrionSignatureState;
  actor: AnnotationRequestActor;
}): Promise<OrionAnnotatedCopy> {
  const { state } = params;
  const signed = await fetchOrionSignedFileContent({
    orionDocumentId: state.orionDocumentId,
    signedFileUrl: state.signedFileUrl,
    validated: false,
  });
  if (!signed.ok || !signed.buffer) {
    throw httpError('No se pudo traer el PDF firmado de Orion para guardar la copia con los datos. Intente de nuevo.', 502);
  }
  const token = await graphToken();
  const annotations = state.annotations ?? [];
  const seals: Record<string, SealImageBytes | null> = {};
  for (const id of new Set(annotations.filter((a) => a.kind === 'seal').map((a) => String(a.sealItemId)))) {
    const content = await downloadOneDriveItemContent(token, id);
    if (!content) throw httpError('No se pudo leer la imagen de un sello. Vuelva a cargarlo.', 502);
    seals[id] = { bytes: content.buffer, mime: content.contentType };
  }

  let pdf: Uint8Array = new Uint8Array(signed.buffer);
  pdf = await applyValidatorMarks(pdf, state, { final: true });
  pdf = await stampAnnotations(pdf, annotations, seals);

  const name = nextAnnotatedCopyName(state);
  const uploaded = await ensureFolderAndUploadFile(
    token,
    annotatedCopyFolderSegments(params.requestId, params.fileId),
    name.fileName,
    Buffer.from(pdf) as unknown as BodyInit,
    'application/pdf'
  );
  return {
    ...name,
    oneDriveItemId: String(uploaded.id),
    sha256: createHash('sha256').update(pdf).digest('hex'),
    createdAt: new Date().toISOString(),
    createdByEmail: params.actor.email,
    createdByName: params.actor.name ?? null,
  };
}

/** Contenido de una copia "Datos N" (null si ya no está en OneDrive). */
export async function loadAnnotatedCopyPdf(copy: OrionAnnotatedCopy): Promise<Uint8Array | null> {
  const token = await getMicrosoftToken();
  if (!token) return null;
  const content = await downloadOneDriveItemContent(token, copy.oneDriveItemId).catch(() => null);
  return content ? new Uint8Array(content.buffer) : null;
}

const SEAL_CACHE_TTL_MS = 10 * 60 * 1000;
const sealCache = new Map<string, { seal: SealImageBytes | null; at: number }>();

async function loadSealForStamp(token: string, itemId: string): Promise<SealImageBytes | null> {
  const hit = sealCache.get(itemId);
  if (hit && Date.now() - hit.at < SEAL_CACHE_TTL_MS) return hit.seal;
  const content = await downloadOneDriveItemContent(token, itemId).catch(() => null);
  const seal = content ? { bytes: content.buffer, mime: content.contentType } : null;
  sealCache.set(itemId, { seal, at: Date.now() });
  return seal;
}

/** Estampa los datos y sellos sobre el PDF que se sirve en SynerLink. Nunca lanza. */
export async function applyDocumentAnnotations(
  pdf: Uint8Array,
  state: OrionSignatureState
): Promise<Uint8Array> {
  const annotations = state.annotations ?? [];
  if (annotations.length === 0) return pdf;
  try {
    const sealIds = [
      ...new Set(annotations.filter((a) => a.kind === 'seal' && a.sealItemId).map((a) => String(a.sealItemId))),
    ];
    const seals: Record<string, SealImageBytes | null> = {};
    if (sealIds.length > 0) {
      const token = await getMicrosoftToken();
      if (token) {
        for (const id of sealIds) seals[id] = await loadSealForStamp(token, id);
      }
    }
    return await stampAnnotations(pdf, annotations, seals);
  } catch (err) {
    console.warn('[orion/annotations] No se pudieron estampar los datos después de firmar:', err);
    return pdf;
  }
}
