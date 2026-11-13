/**
 * Caché + prefetch del perfil Orion del firmante (rúbrica, cédula, consentimientos).
 * Evita el spinner «Consultando su perfil…» al reabrir Confirmar firma.
 *
 * sessionStorage solo guarda booleanos (sin cédula, nombre, cargo ni rúbrica).
 * El perfil completo vive en memoria de la pestaña.
 */

export type SignerTurnPreview = {
  fullName: string | null;
  idDocumentType: string | null;
  idNumber: string | null;
  jobTitle: string | null;
  companyName: string | null;
  hasSignature: boolean;
  signatureDataUrl: string | null;
  hasFingerprint: boolean;
  hasSigningLegalConsent: boolean;
  hasBiometricConsent: boolean;
  missingInOrion: Array<'fullName' | 'idNumber' | 'jobTitle'>;
  suggested: { fullName: string | null; idNumber: string | null };
  signatureProfileUrl: string | null;
  fingerprintProfileUrl: string | null;
};

type SessionFlags = {
  hasSignature: boolean;
  hasFingerprint: boolean;
  hasSigningLegalConsent: boolean;
  hasBiometricConsent: boolean;
};

const TTL_MS = 10 * 60_000;

type Entry = {
  at: number;
  preview?: SignerTurnPreview;
  promise?: Promise<SignerTurnPreview | null>;
};

const memory = new Map<string, Entry>();

function keyOf(email: string, withFingerprint: boolean): string {
  return `${email.trim().toLowerCase()}:${withFingerprint ? 'fp' : 'light'}`;
}

function storageKey(key: string): string {
  return `orion-user-profile-flags:${key}`;
}

/** La entrada si todavía está vigente; si no, null (así `fresh(e)?.preview` sí lee el caché). */
function fresh(entry: Entry | undefined): Entry | null {
  return entry && Date.now() - entry.at < TTL_MS ? entry : null;
}

function readSessionFlags(key: string): SessionFlags | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; flags?: SessionFlags };
    if (!parsed.ts || Date.now() - parsed.ts >= TTL_MS || !parsed.flags) return null;
    return parsed.flags;
  } catch {
    return null;
  }
}

function writeSessionFlags(key: string, preview: SignerTurnPreview): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const flags: SessionFlags = {
      hasSignature: preview.hasSignature,
      hasFingerprint: preview.hasFingerprint,
      hasSigningLegalConsent: preview.hasSigningLegalConsent,
      hasBiometricConsent: preview.hasBiometricConsent,
    };
    sessionStorage.setItem(storageKey(key), JSON.stringify({ ts: Date.now(), flags }));
  } catch {
    /* ignore quota */
  }
}

function toPreview(data: Record<string, unknown>): SignerTurnPreview {
  return {
    fullName: (data.fullName as string | null) ?? null,
    idDocumentType: (data.idDocumentType as string | null) ?? null,
    idNumber: (data.idNumber as string | null) ?? null,
    jobTitle: (data.jobTitle as string | null) ?? null,
    companyName: (data.companyName as string | null) ?? null,
    hasSignature: data.hasSignature === true,
    signatureDataUrl: (data.signatureDataUrl as string | null) ?? null,
    hasFingerprint: data.hasFingerprint === true,
    hasSigningLegalConsent: data.hasSigningLegalConsent === true,
    hasBiometricConsent: data.hasBiometricConsent === true,
    missingInOrion: Array.isArray(data.missingInOrion)
      ? (data.missingInOrion as SignerTurnPreview['missingInOrion'])
      : [],
    suggested: {
      fullName: (data.suggested as { fullName?: string | null } | undefined)?.fullName ?? null,
      idNumber: (data.suggested as { idNumber?: string | null } | undefined)?.idNumber ?? null,
    },
    signatureProfileUrl: (data.signatureProfileUrl as string | null) ?? null,
    fingerprintProfileUrl: (data.fingerprintProfileUrl as string | null) ?? null,
  };
}

async function fetchProfile(withFingerprint: boolean): Promise<SignerTurnPreview | null> {
  const qs = withFingerprint ? '' : '?fingerprint=0';
  const res = await fetch(`/api/integrations/orion/user-profile${qs}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return null;
  return toPreview(data);
}

export function peekUserProfile(
  email: string,
  withFingerprint = true
): SignerTurnPreview | null {
  const key = keyOf(email, withFingerprint);
  const mem = fresh(memory.get(key));
  if (mem?.preview) return mem.preview;
  // sessionStorage solo tiene flags: no reconstruir perfil con PII.
  void readSessionFlags(key);
  return null;
}

/** Flags ligeros (sin PII) para UI; el perfil completo sigue en memoria/red. */
export function peekUserProfileFlags(
  email: string,
  withFingerprint = true
): SessionFlags | null {
  const key = keyOf(email, withFingerprint);
  const mem = fresh(memory.get(key));
  if (mem?.preview) {
    return {
      hasSignature: mem.preview.hasSignature,
      hasFingerprint: mem.preview.hasFingerprint,
      hasSigningLegalConsent: mem.preview.hasSigningLegalConsent,
      hasBiometricConsent: mem.preview.hasBiometricConsent,
    };
  }
  return readSessionFlags(key);
}

/** Arranca la carga en segundo plano (al abrir a firmar / montar panel). */
export function prefetchUserProfile(email: string, withFingerprint = true): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const key = keyOf(normalized, withFingerprint);
  const existing = fresh(memory.get(key));
  if (existing && (existing.preview || existing.promise)) return;

  const promise = fetchProfile(withFingerprint)
    .then((preview) => {
      if (preview) {
        memory.set(key, { at: Date.now(), preview });
        writeSessionFlags(key, preview);
      }
      return preview;
    })
    .catch(() => null);

  memory.set(key, { at: Date.now(), promise });
}

export async function loadUserProfile(
  email: string,
  withFingerprint = true
): Promise<SignerTurnPreview | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const key = keyOf(normalized, withFingerprint);
  const cached = peekUserProfile(normalized, withFingerprint);
  if (cached) return cached;

  const existing = memory.get(key);
  const pending = fresh(existing)?.promise;
  if (pending) return pending;

  const promise = fetchProfile(withFingerprint)
    .then((preview) => {
      if (preview) {
        memory.set(key, { at: Date.now(), preview });
        writeSessionFlags(key, preview);
      }
      return preview;
    })
    .catch(() => null);

  memory.set(key, { at: Date.now(), promise });
  return promise;
}

/** Invalida caché tras dibujar/guardar rúbrica o aceptar consentimiento. */
export function invalidateUserProfileCache(email?: string | null): void {
  const normalized = String(email || '').trim().toLowerCase();
  const clearKey = (key: string) => {
    memory.delete(key);
    try {
      sessionStorage.removeItem(storageKey(key));
      // Limpia clave antigua que guardaba PII (migración).
      sessionStorage.removeItem(`orion-user-profile:${key}`);
    } catch {
      /* ignore */
    }
  };
  if (!normalized) {
    memory.clear();
    return;
  }
  for (const withFp of [true, false]) {
    clearKey(keyOf(normalized, withFp));
  }
}
