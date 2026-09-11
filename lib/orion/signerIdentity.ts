/**
 * Identidad del firmante al confirmar (alineado con Orion signer-identity).
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
  };
}

const IDENTITY_STORAGE_KEY = 'kronos.orion.signerIdentity';

export function loadStoredSignerIdentity(
  email?: string | null
): Partial<SignerAcceptIdentity> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      email?: string;
      identity?: Partial<SignerAcceptIdentity>;
    };
    if (email && parsed.email && parsed.email.toLowerCase() !== email.toLowerCase()) {
      return null;
    }
    return parsed.identity ?? null;
  } catch {
    return null;
  }
}

export function storeSignerIdentity(
  email: string | null | undefined,
  identity: SignerAcceptIdentity
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      IDENTITY_STORAGE_KEY,
      JSON.stringify({
        email: String(email || '').toLowerCase(),
        identity: {
          fullName: identity.fullName,
          idDocumentType: identity.idDocumentType,
          idNumber: identity.idNumber,
          companyName: identity.companyName,
          jobTitle: identity.jobTitle,
        },
      })
    );
  } catch {
    /* ignore quota */
  }
}
