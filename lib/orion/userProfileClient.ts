/**
 * Caché + prefetch del perfil Orion del firmante (rúbrica, cédula, consentimientos).
 * Evita el spinner «Consultando su perfil…» al reabrir Confirmar firma.
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
  return `orion-user-profile:${key}`;
}

function fresh(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && Date.now() - entry.at < TTL_MS);
}

function readSession(key: string): SignerTurnPreview | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; preview?: SignerTurnPreview };
    if (!parsed.ts || Date.now() - parsed.ts >= TTL_MS || !parsed.preview) return null;
    return parsed.preview;
  } catch {
    return null;
  }
}

function writeSession(key: string, preview: SignerTurnPreview): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify({ ts: Date.now(), preview }));
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
  const mem = memory.get(key);
  if (fresh(mem)?.preview) return mem.preview;
  const stored = readSession(key);
  if (stored) {
    memory.set(key, { at: Date.now(), preview: stored });
    return stored;
  }
  return null;
}

/** Arranca la carga en segundo plano (al abrir a firmar / montar panel). */
export function prefetchUserProfile(email: string, withFingerprint = true): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const key = keyOf(normalized, withFingerprint);
  const existing = memory.get(key);
  if (fresh(existing) && (existing.preview || existing.promise)) return;

  const promise = fetchProfile(withFingerprint)
    .then((preview) => {
      if (preview) {
        memory.set(key, { at: Date.now(), preview });
        writeSession(key, preview);
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
  if (fresh(existing)?.promise) return existing.promise!;

  const promise = fetchProfile(withFingerprint)
    .then((preview) => {
      if (preview) {
        memory.set(key, { at: Date.now(), preview });
        writeSession(key, preview);
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
  if (!normalized) {
    memory.clear();
    return;
  }
  for (const withFp of [true, false]) {
    const key = keyOf(normalized, withFp);
    memory.delete(key);
    try {
      sessionStorage.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
  }
}
