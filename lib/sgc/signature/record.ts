import { createHash, randomUUID } from 'node:crypto';
import { SgcError } from '../errors';
import { looksLikeAutofilledEmail } from '../autofill';
import { SGC_SIGNATURE_LABELS, SGC_SIGNATURE_MEANINGS, type SgcSignatureMeaning } from '../flows/definition';
import { SGC_SIGNATURE_AUTH_METHOD, SGC_SIGNATURE_CONSENT, SGC_SIGNATURE_CONSENT_REQUIRED_MESSAGE, SGC_SIGNATURE_CONSENT_VERSION } from './consent';

/**
 * Registro de la firma electrónica PROPIA del SGC — funciones PURAS (se
 * prueban sin base ni red).
 *
 * Qué queda de cada firma (plan, «Sprint 3»): quién (correo de la SESIÓN,
 * reautenticado con su contraseña de SynerLink en el momento), qué significa
 * (Elaboró, Revisó, Aprobó…), por qué (motivo), cuándo (sello de tiempo del
 * SERVIDOR, UTC), sobre qué (hash SHA-256 del contenido firmado), desde dónde
 * (IP sin puerto y navegador), con qué método y consentimiento, y la
 * evidencia en el espacio propio de la empresa. Cada registro se ENCADENA con
 * el anterior de la empresa (record_hash = SHA-256 del registro + evidencia +
 * hash anterior): alterar o quitar una firma rompe la cadena.
 *
 * La contraseña NUNCA entra aquí: no es parte del registro, de la evidencia
 * ni de la auditoría.
 */

export const SGC_SIGNATURE_SCHEMA = 'sgc-firma-electronica/v1';
/**
 * Contenido firmado. Sprint 4: la firma «Leyó» se hace sobre el PDF
 * CONTROLADO de la versión que se divulga (su SHA-256 registrado) y la firma
 * «Capacitó» sobre el Excel de RESULTADOS de la capacitación que cargó Calidad.
 */
export const SGC_CONTENT_KINDS = ['borrador_adjunto', 'borrador_editor', 'pdf_controlado', 'resultados_capacitacion'] as const;
export type SgcContentKind = (typeof SGC_CONTENT_KINDS)[number];

export const SGC_CONTENT_KIND_LABELS: Record<SgcContentKind, string> = {
  borrador_adjunto: 'Borrador cargado (archivo)',
  borrador_editor: 'Borrador editado en la app',
  pdf_controlado: 'PDF controlado de la versión aprobada',
  resultados_capacitacion: 'Resultados de la capacitación (Excel de Forms)',
};

const SHA_RE = /^[0-9a-f]{64}$/;

export function sha256HexOf(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Huella del texto del consentimiento que la persona aceptó. */
export function consentTextSha256(): string {
  return sha256HexOf(`${SGC_SIGNATURE_CONSENT_VERSION}\n${SGC_SIGNATURE_CONSENT.title}\n${SGC_SIGNATURE_CONSENT.body}\n${SGC_SIGNATURE_CONSENT.checkbox}`);
}

/** JSON canónico: claves ordenadas, sin espacios; fechas en ISO. Mismo objeto ⇒ mismo texto ⇒ mismo hash. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export interface SgcSignInputRaw {
  meaning?: unknown;
  reason?: unknown;
  consentAccepted?: unknown;
  password?: unknown;
}

export interface SgcSignInput {
  meaning: SgcSignatureMeaning;
  reason: string;
  password: string;
}

/**
 * Valida lo que llega del formulario de firma. Sin contraseña, sin motivo o
 * sin aceptar el consentimiento NO se firma. El significado debe ser el que
 * exige la tarea (no lo elige el cliente).
 */
export function validateSignInput(raw: SgcSignInputRaw, expected: SgcSignatureMeaning | null, signerEmail?: string | null): SgcSignInput {
  if (!expected) throw new SgcError('Esta tarea no lleva firma electrónica.', 409);
  if (raw.meaning !== expected) {
    throw new SgcError(`El significado de la firma de esta tarea es «${SGC_SIGNATURE_LABELS[expected]}».`);
  }
  if (!(SGC_SIGNATURE_MEANINGS as readonly string[]).includes(expected)) throw new SgcError('Significado de firma inválido.');
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason.length < 5) throw new SgcError('Escriba el motivo de la firma (mínimo 5 caracteres).');
  if (reason.length > 1000) throw new SgcError('El motivo admite máximo 1000 caracteres.');
  // El gestor de contraseñas del navegador puede rellenar el motivo con el correo: eso no es un motivo.
  if (looksLikeAutofilledEmail(reason, signerEmail)) throw new SgcError('Escriba el motivo de la firma: el campo tiene su correo (lo rellenó el navegador).');
  if (raw.consentAccepted !== true) throw new SgcError(SGC_SIGNATURE_CONSENT_REQUIRED_MESSAGE);
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (!password) throw new SgcError('Escriba su contraseña de SynerLink para firmar (reautenticación).', 401);
  if (password.length > 200) throw new SgcError('Contraseña inválida.', 401);
  return { meaning: expected, reason, password };
}

/** Contenido que se firma: el borrador vigente de la solicitud, con su huella. */
export interface SgcSignedContent {
  kind: SgcContentKind;
  ref: string;
  name: string;
  sha256: string;
}

/** Datos de la firma que entran al registro, a la evidencia y al hash. */
export interface SgcSignaturePayload {
  schema: typeof SGC_SIGNATURE_SCHEMA;
  uid: string;
  idCompany: number;
  idRequest: number;
  idTask: number;
  idTaskAssignee: number;
  signerEmail: string;
  signerName: string | null;
  meaning: SgcSignatureMeaning;
  meaningLabel: string;
  reason: string;
  signedAt: string;
  content: SgcSignedContent;
  authMethod: string;
  consentVersion: string;
  masterSha256: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function buildSignaturePayload(p: {
  uid?: string;
  idCompany: number;
  idRequest: number;
  idTask: number;
  idTaskAssignee: number;
  signerEmail: string;
  signerName: string | null;
  meaning: SgcSignatureMeaning;
  reason: string;
  signedAt: Date;
  content: SgcSignedContent;
  masterSha256: string | null;
  ip: string | null;
  userAgent: string | null;
}): SgcSignaturePayload {
  if (!SHA_RE.test(p.content.sha256)) throw new SgcError('La huella del contenido firmado no es válida.', 500);
  return {
    schema: SGC_SIGNATURE_SCHEMA,
    uid: p.uid ?? randomUUID(),
    idCompany: p.idCompany,
    idRequest: p.idRequest,
    idTask: p.idTask,
    idTaskAssignee: p.idTaskAssignee,
    signerEmail: p.signerEmail.trim().toLowerCase(),
    signerName: p.signerName,
    meaning: p.meaning,
    meaningLabel: SGC_SIGNATURE_LABELS[p.meaning],
    reason: p.reason,
    signedAt: p.signedAt.toISOString(),
    content: p.content,
    authMethod: SGC_SIGNATURE_AUTH_METHOD,
    consentVersion: SGC_SIGNATURE_CONSENT_VERSION,
    masterSha256: p.masterSha256,
    ip: p.ip,
    userAgent: p.userAgent,
  };
}

/** Archivo de EVIDENCIA (JSON legible) que se guarda en <raíz>/_firmas/. Nunca lleva la contraseña. */
export function buildEvidenceFile(payload: SgcSignaturePayload): { fileName: string; bytes: Uint8Array } {
  const doc = {
    ...payload,
    aviso:
      'Evidencia de firma electrónica del SGC documental (SynerLink). La persona se reautenticó con su contraseña de SynerLink, que no se guarda. La hora es la del servidor (UTC). La integridad del registro se verifica con el record_hash de sgc.signature.',
    consentimiento: { version: payload.consentVersion, sha256: consentTextSha256() },
  };
  const stamp = payload.signedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return {
    fileName: `${stamp}_${payload.meaning}_${payload.uid}.json`,
    bytes: new TextEncoder().encode(JSON.stringify(doc, null, 2)),
  };
}

/** Carpeta de la evidencia: <storage_root>/_firmas/SOL-<n>. */
export function evidenceFolderSegments(storageRoot: string, idRequest: number): string[] {
  const root = storageRoot.split('/').map((s) => s.trim()).filter(Boolean);
  if (root.length === 0) throw new SgcError('La empresa no tiene carpeta raíz del SGC.', 500);
  return [...root, '_firmas', `SOL-${idRequest}`];
}

/** Hash ENCADENADO del registro: payload canónico + huella de la evidencia + hash anterior de la empresa. */
export function computeRecordHash(payload: SgcSignaturePayload, evidenceSha256: string, prevRecordHash: string | null): string {
  return sha256HexOf(`${canonicalJson(payload)}\n${evidenceSha256}\n${prevRecordHash ?? 'GENESIS'}`);
}

/** Fila de sgc.signature tal como se lee de la base (lo que hace falta para verificarla). */
export interface SgcSignatureRow {
  signature_uid: string;
  id_company: number;
  id_request: number;
  id_task: number;
  id_task_assignee: number;
  signer_email: string;
  signer_name: string | null;
  meaning: string;
  reason: string;
  signed_at: Date;
  content_kind: string;
  content_ref: string;
  content_name: string;
  content_sha256: string;
  auth_method: string;
  consent_version: string;
  master_sha256: string | null;
  ip: string | null;
  user_agent: string | null;
  evidence_sha256: string;
  prev_record_hash: string | null;
  record_hash: string;
}

/** Reconstruye el payload desde la fila guardada. */
export function payloadFromRow(row: SgcSignatureRow): SgcSignaturePayload {
  return {
    schema: SGC_SIGNATURE_SCHEMA,
    uid: row.signature_uid.trim(),
    idCompany: row.id_company,
    idRequest: row.id_request,
    idTask: row.id_task,
    idTaskAssignee: row.id_task_assignee,
    signerEmail: row.signer_email,
    signerName: row.signer_name,
    meaning: row.meaning as SgcSignatureMeaning,
    meaningLabel: SGC_SIGNATURE_LABELS[row.meaning as SgcSignatureMeaning] ?? row.meaning,
    reason: row.reason,
    signedAt: row.signed_at.toISOString(),
    content: { kind: row.content_kind as SgcContentKind, ref: row.content_ref, name: row.content_name, sha256: row.content_sha256.trim() },
    authMethod: row.auth_method,
    consentVersion: row.consent_version,
    masterSha256: row.master_sha256?.trim() ?? null,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

/** true si el registro guardado sigue íntegro (su record_hash coincide con lo que contiene). */
export function verifySignatureRow(row: SgcSignatureRow): boolean {
  return computeRecordHash(payloadFromRow(row), row.evidence_sha256.trim(), row.prev_record_hash?.trim() ?? null) === row.record_hash.trim();
}

/**
 * Verifica la CADENA de firmas de una empresa (en orden de inserción): cada
 * registro íntegro y enlazado con el anterior. Devuelve el primer problema.
 */
export function verifySignatureChain(rows: readonly SgcSignatureRow[]): { ok: boolean; checked: number; brokenAt: string | null; problem: string | null } {
  let prev: string | null = null;
  for (const r of rows) {
    if (!verifySignatureRow(r)) return { ok: false, checked: rows.length, brokenAt: r.signature_uid.trim(), problem: 'El registro no coincide con su huella (fue alterado).' };
    if ((r.prev_record_hash?.trim() ?? null) !== prev) return { ok: false, checked: rows.length, brokenAt: r.signature_uid.trim(), problem: 'La cadena de firmas está rota (falta o sobra un registro).' };
    prev = r.record_hash.trim();
  }
  return { ok: true, checked: rows.length, brokenAt: null, problem: null };
}
