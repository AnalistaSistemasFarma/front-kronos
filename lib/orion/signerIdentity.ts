/**
 * Identidad del firmante al confirmar (alineado con Orion signer-identity).
 *
 * Privacidad (Ley 1581): NO persistir cédula/NIT/cargo/empresa en localStorage.
 * Esos datos solo viven en memoria del formulario y en el POST a complete-sign → Orion.
 */

export type SignerIdDocumentType =
  | 'CC'
  | 'CE'
  | 'PA'
  | 'PPT'
  | 'NIT_EMPRESA'
  | 'OTRO';

export const SIGNER_ID_DOCUMENT_OPTIONS: {
  value: SignerIdDocumentType;
  label: string;
}[] = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PA', label: 'Pasaporte' },
  { value: 'PPT', label: 'Permiso por protección temporal' },
  { value: 'NIT_EMPRESA', label: 'NIT empresa' },
  { value: 'OTRO', label: 'Otro documento' },
];

export function isCompanyNitDocumentType(
  type: SignerIdDocumentType | string | null | undefined
): boolean {
  return type === 'NIT_EMPRESA';
}

export type SignerAcceptIdentity = {
  fullName: string;
  idDocumentType: SignerIdDocumentType;
  idNumber: string;
  companySlug?: string | null;
  companyName?: string | null;
  companyNit?: string | null;
  jobTitle?: string | null;
  /** Aceptación de condiciones de firma electrónica (SynerLink UI). */
  acceptedTerms?: boolean;
  /** Consentimiento biométrico (huella) cuando el documento la exige. */
  acceptedBiometric?: boolean;
};

export function formatSignerIdLabel(
  idDocumentType: SignerIdDocumentType | string | null | undefined,
  idNumber: string | null | undefined
): string | null {
  if (!idNumber?.trim()) return null;
  if (isCompanyNitDocumentType(idDocumentType)) {
    return `NIT ${idNumber.trim()}`;
  }
  const type = (idDocumentType ?? 'CC').trim() || 'CC';
  return `${type} ${idNumber.trim()}`;
}

export function validateSignerIdentity(
  identity: Partial<SignerAcceptIdentity>,
  options?: { nameOptional?: boolean }
): string | null {
  const fullName = identity.fullName?.trim() ?? '';
  const idNumber = identity.idNumber?.trim() ?? '';
  const jobTitle = identity.jobTitle?.trim() ?? '';
  const isNitEmpresa = isCompanyNitDocumentType(identity.idDocumentType);
  const nameOptional = options?.nameOptional === true;

  if (nameOptional) {
    if (fullName.length > 0 && fullName.length < 3) {
      return 'Si indica nombre, use al menos 3 caracteres.';
    }
  } else if (fullName.length < 3) {
    return 'Indique su nombre completo (mínimo 3 caracteres).';
  }

  if (isNitEmpresa) {
    if (jobTitle.length > 0 && jobTitle.length < 2) {
      return 'Si indica cargo, use al menos 2 caracteres.';
    }
    if (idNumber.length > 0) {
      if (idNumber.length < 5) {
        return 'Si indica NIT, use al menos 5 caracteres.';
      }
      if (!/^[0-9.\-\s]+$/.test(idNumber)) {
        return 'El NIT solo puede incluir números, puntos o guiones.';
      }
    }
    return null;
  }

  if (idNumber.length > 0) {
    if (idNumber.length < 4) {
      return 'Si indica número de documento, use al menos 4 caracteres.';
    }
    if (!/^[A-Za-z0-9.\-\s]+$/.test(idNumber)) {
      return 'El número de documento solo puede incluir letras, números, puntos o guiones.';
    }
  }
  return null;
}

/** Normaliza el payload antes de enviarlo a Orion. */
export function normalizeSignerIdentity(
  identity: Partial<SignerAcceptIdentity>,
  fallbackName?: string | null
): SignerAcceptIdentity {
  const idDocumentType = (identity.idDocumentType || 'CC') as SignerIdDocumentType;
  const idNumber = String(identity.idNumber || '').trim();
  const isNit = isCompanyNitDocumentType(idDocumentType);
  const companyName = String(identity.companyName || identity.companySlug || '').trim() || null;
  const jobTitle = String(identity.jobTitle || '').trim() || null;

  return {
    fullName:
      String(identity.fullName || '').trim() ||
      String(fallbackName || '').trim() ||
      'Firmante',
    idDocumentType,
    idNumber,
    companySlug: isNit ? companyName : null,
    companyName: isNit ? companyName : null,
    companyNit: isNit && idNumber ? idNumber : null,
    jobTitle: isNit ? jobTitle : null,
    acceptedTerms: identity.acceptedTerms === true ? true : undefined,
    acceptedBiometric: identity.acceptedBiometric === true ? true : undefined,
  };
}

/** Clave legada — se borra al cargar el formulario (ya no se escribe). */
const LEGACY_IDENTITY_STORAGE_KEY = 'kronos.orion.signerIdentity';

/**
 * @deprecated No se persiste identidad. Solo limpia residuos de versiones anteriores.
 */
export function loadStoredSignerIdentity(
  _email?: string | null
): Partial<SignerAcceptIdentity> | null {
  void _email;
  clearStoredSignerIdentity();
  return null;
}

/**
 * @deprecated No-op: no persistir datos personales del firmante en el navegador.
 */
export function storeSignerIdentity(
  _email: string | null | undefined,
  _identity: SignerAcceptIdentity
): void {
  void _email;
  void _identity;
  clearStoredSignerIdentity();
}

/** Elimina cualquier rastro previo de identidad en localStorage. */
export function clearStoredSignerIdentity(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_IDENTITY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
