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

export const DATOS_SELLO_AUDIT_ACTION = 'GSS_FIRMA_DATOS_SELLO';

export interface DatosSello {
  fullName: string;
  idDocumentType: SignerIdDocumentType;
  idNumber: string;
  jobTitle: string;
}

export interface DatosSelloInput extends DatosSello {
  /** Acepta las condiciones de firma electrónica a nivel persona (solo si aún no las tenía). */
  acceptedTerms: boolean;
}

export class DatosSelloError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const TIPOS = new Set<string>(SIGNER_ID_DOCUMENT_OPTIONS.map((o) => o.value));

/** Lee y valida los datos del sello de un cuerpo JSON. Lanza DatosSelloError (400). */
export function parseDatosSello(raw: unknown): DatosSelloInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DatosSelloError('Petición inválida.');
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const fullName = text(r.fullName, 80);
  const idDocumentType = text(r.idDocumentType, 20).toUpperCase() || 'CC';
  const idNumber = text(r.idNumber, 50);
  const jobTitle = text(r.jobTitle, 120);

  // Documento y cargo son OPCIONALES, igual que en el modal de firma (Juan, 2026-11-20):
  // solo se estampan si la persona los registra. El nombre sí es obligatorio.
  if (!TIPOS.has(idDocumentType)) throw new DatosSelloError('Elija el tipo de documento.');
  const error = validateSignerIdentity({
    fullName,
    idDocumentType: idDocumentType as SignerIdDocumentType,
    idNumber,
    jobTitle,
  });
  if (error) throw new DatosSelloError(error);

  return {
    fullName,
    idDocumentType: idDocumentType as SignerIdDocumentType,
    idNumber,
    jobTitle,
    acceptedTerms: r.acceptedTerms === true,
  };
}

export interface DatosSelloActuales extends Partial<Record<keyof DatosSello, string | null>> {
  hasSigningLegalConsent: boolean;
}

export interface DatosSelloDeps {
  /** Rúbrica registrada en GSS Firma (Orión exige reenviarla). */
  leerFirma: (email: string) => Promise<{ dataUrl: string | null; method: string | null }>;
  /** Datos actuales del sello y consentimiento (para auditar qué cambió). */
  leerActuales: (email: string) => Promise<DatosSelloActuales>;
  guardar: (
    email: string,
    dataUrl: string,
    method: 'drawn' | 'uploaded',
    datos: DatosSello
  ) => Promise<{ ok: boolean; error?: string }>;
  guardarConsentimiento: (email: string) => Promise<{ ok: boolean; error?: string }>;
  auditar: (row: { user_id: string; action: string; performed_by: string; details: string }) => Promise<unknown>;
}

export interface GuardarDatosSelloInput {
  idUser: string;
  email: string;
  datos: DatosSelloInput;
  ip: string | null;
  userAgent?: string | null;
}

export async function guardarDatosSello(
  deps: DatosSelloDeps,
  input: GuardarDatosSelloInput
): Promise<{ consentimientoGuardado: boolean }> {
  const firma = await deps.leerFirma(input.email);
  if (!firma.dataUrl) {
    throw new DatosSelloError('Registre primero su firma: los datos del sello se guardan junto a ella.', 409);
  }
  const antes = await deps.leerActuales(input.email).catch(() => null);
  const { acceptedTerms, ...datos } = input.datos;

  const r = await deps.guardar(input.email, firma.dataUrl, firma.method === 'uploaded' ? 'uploaded' : 'drawn', datos);
  if (!r.ok) throw new DatosSelloError(`No se pudieron guardar en GSS Firma: ${r.error ?? 'sin respuesta'}`, 502);

  let consentimientoGuardado = false;
  if (acceptedTerms && !antes?.hasSigningLegalConsent) {
    const c = await deps.guardarConsentimiento(input.email).catch(() => ({ ok: false }));
    consentimientoGuardado = c.ok;
  }

  const campos = (Object.keys(datos) as Array<keyof DatosSello>).filter(
    (k) => !antes || String(antes[k] ?? '') !== String(datos[k] ?? '')
  );
  await deps.auditar({
    user_id: input.idUser,
    action: DATOS_SELLO_AUDIT_ACTION,
    performed_by: input.email,
    details: JSON.stringify({
      camposCambiados: campos,
      consentimientoAceptado: consentimientoGuardado,
      origen: 'perfil',
      ip: input.ip,
      userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    }),
  });
  return { consentimientoGuardado };
}
