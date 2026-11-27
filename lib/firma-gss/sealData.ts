import {
  SIGNER_ID_DOCUMENT_OPTIONS,
  validateSignerIdentity,
  type SignerIdDocumentType,
} from '../orion/signerIdentity';

/**
 * «DATOS DEL SELLO» en el perfil (Juan Fonseca, 2026-11-20): nombre (obligatorio),
 * documento y cargo (opcionales) con los que se estampa la firma, configurados una sola vez junto a «Mi
 * firma». Así, al autorizar una firma, el documento queda firmado de una vez
 * sin el modal de cédula/cargo (ver OrionSignaturePanel, firma automática).
 *
 * Mismas reglas que «Mi firma» (lib/firma-gss/miFirma.ts):
 *   - Solo los PROPIOS: el correo sale de la SESIÓN.
 *   - Solo tras REAUTENTICARSE con la contraseña de SynerLink.
 *   - Se guardan en GSS Firma (Orión), que es la fuente del sello.
 *   - Auditoría en user_audit_log SIN los valores (Ley 1581): solo qué campos cambiaron.
 *
 * Orión exige la rúbrica en la misma llamada, así que se reenvía la registrada:
 * sin firma registrada no se pueden guardar los datos del sello.
 */

export const SEAL_DATA_AUDIT_ACTION = 'GSS_FIRMA_DATOS_SELLO';

export interface SealData {
  fullName: string;
  idDocumentType: SignerIdDocumentType;
  idNumber: string;
  jobTitle: string;
}

export interface SealDataInput extends SealData {
  /** Acepta las condiciones de firma electrónica a nivel persona (solo si aún no las tenía). */
  acceptedTerms: boolean;
}

export class SealDataError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const DOCUMENT_TYPES = new Set<string>(SIGNER_ID_DOCUMENT_OPTIONS.map((o) => o.value));

/** Reads and validates the seal data of a JSON body. Throws SealDataError (400). */
export function parseSealData(raw: unknown): SealDataInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SealDataError('Petición inválida.');
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const fullName = text(r.fullName, 80);
  const idDocumentType = text(r.idDocumentType, 20).toUpperCase() || 'CC';
  const idNumber = text(r.idNumber, 50);
  const jobTitle = text(r.jobTitle, 120);

  // Documento y cargo son OPCIONALES, igual que en el modal de firma (Juan, 2026-11-20):
  // solo se estampan si la persona los registra. El nombre sí es obligatorio.
  if (!DOCUMENT_TYPES.has(idDocumentType)) throw new SealDataError('Elija el tipo de documento.');
  const error = validateSignerIdentity({
    fullName,
    idDocumentType: idDocumentType as SignerIdDocumentType,
    idNumber,
    jobTitle,
  });
  if (error) throw new SealDataError(error);

  return {
    fullName,
    idDocumentType: idDocumentType as SignerIdDocumentType,
    idNumber,
    jobTitle,
    acceptedTerms: r.acceptedTerms === true,
  };
}

export interface CurrentSealData extends Partial<Record<keyof SealData, string | null>> {
  hasSigningLegalConsent: boolean;
}

export interface SealDataDeps {
  /** Rúbrica registrada en GSS Firma (Orión exige reenviarla). */
  readSignature: (email: string) => Promise<{ dataUrl: string | null; method: string | null }>;
  /** Datos actuales del sello y consentimiento (para auditar qué cambió). */
  readCurrent: (email: string) => Promise<CurrentSealData>;
  save: (
    email: string,
    dataUrl: string,
    method: 'drawn' | 'uploaded',
    datos: SealData
  ) => Promise<{ ok: boolean; error?: string }>;
  saveConsent: (email: string) => Promise<{ ok: boolean; error?: string }>;
  auditar: (row: { user_id: string; action: string; performed_by: string; details: string }) => Promise<unknown>;
}

export interface SaveSealDataInput {
  idUser: string;
  email: string;
  data: SealDataInput;
  ip: string | null;
  userAgent?: string | null;
}

export async function saveSealData(
  deps: SealDataDeps,
  input: SaveSealDataInput
): Promise<{ consentSaved: boolean }> {
  const signature = await deps.readSignature(input.email);
  if (!signature.dataUrl) {
    throw new SealDataError('Registre primero su firma: los datos del sello se guardan junto a ella.', 409);
  }
  const previous = await deps.readCurrent(input.email).catch(() => null);
  const { acceptedTerms, ...data } = input.data;

  const r = await deps.save(input.email, signature.dataUrl, signature.method === 'uploaded' ? 'uploaded' : 'drawn', data);
  if (!r.ok) throw new SealDataError(`No se pudieron guardar en GSS Firma: ${r.error ?? 'sin respuesta'}`, 502);

  let consentSaved = false;
  if (acceptedTerms && !previous?.hasSigningLegalConsent) {
    const c = await deps.saveConsent(input.email).catch(() => ({ ok: false }));
    consentSaved = c.ok;
  }

  const fields = (Object.keys(data) as Array<keyof SealData>).filter(
    (k) => !previous || String(previous[k] ?? '') !== String(data[k] ?? '')
  );
  await deps.auditar({
    user_id: input.idUser,
    action: SEAL_DATA_AUDIT_ACTION,
    performed_by: input.email,
    details: JSON.stringify({
      camposCambiados: fields,
      consentimientoAceptado: consentSaved,
      origen: 'perfil',
      ip: input.ip,
      userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    }),
  });
  return { consentSaved };
}
