import { getOrionConfig } from './config';
import type {
  OrionAssignSignersPayload,
  OrionCreateDocumentPayload,
  OrionDocumentResponse,
} from './types';

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

/**
 * Base pública de Orion para links que salen por correo (nunca localhost).
 * Orden: ORION_PUBLIC_URL → ORION_EMBED_ORIGIN → ORION_API_BASE_URL.
 */
export function getOrionPublicBaseUrl(): string | null {
  const candidates = [
    process.env.ORION_PUBLIC_URL,
    process.env.ORION_EMBED_ORIGIN,
    process.env.ORION_API_BASE_URL,
    getOrionConfig().embedOrigin,
    getOrionConfig().apiBaseUrl,
  ];
  for (const raw of candidates) {
    const base = String(raw || '')
      .trim()
      .replace(/\/$/, '');
    if (base && /^https?:\/\//i.test(base) && !isLoopbackUrl(base)) return base;
  }
  return null;
}

/**
 * Origen público de SynerLink para respaldos /firma/externa (nunca localhost de Origin).
 */
export function resolvePublicAppOrigin(requestOrigin?: string | null): string | null {
  const candidates = [
    process.env.NEXTAUTH_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    requestOrigin,
  ];
  let loopbackFallback: string | null = null;
  for (const raw of candidates) {
    const base = String(raw || '')
      .trim()
      .replace(/\/$/, '');
    if (!base || !/^https?:\/\//i.test(base)) continue;
    if (isLoopbackUrl(base)) {
      if (!loopbackFallback) loopbackFallback = base;
      continue;
    }
    return base;
  }
  return loopbackFallback;
}

/**
 * Convierte rutas/URLs de Orion en URL absoluta pública.
 * Si Orion devolvió localhost (dev), reescribe al host público configurado.
 */
export function resolveOrionAbsoluteUrl(urlOrPath: string | null | undefined): string | null {
  const value = String(urlOrPath || '').trim();
  if (!value) return null;

  const publicBase = getOrionPublicBaseUrl();
  const { apiBaseUrl } = getOrionConfig();
  const rewriteBase = publicBase || apiBaseUrl;

  if (/^https?:\/\//i.test(value)) {
    if (!isLoopbackUrl(value)) return value;
    // localhost → host público (correo / links externos).
    if (!rewriteBase) return value;
    try {
      const parsed = new URL(value);
      return `${rewriteBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return value;
    }
  }

  if (!rewriteBase) return null;
  return `${rewriteBase}${value.startsWith('/') ? value : `/${value}`}`;
}

/** URL canónica del PDF firmado en Orion (preferida sobre signedFileUrl almacenado). */
export function buildOrionSignedFileApiUrl(orionDocumentId: string): string | null {
  const id = String(orionDocumentId || '').trim();
  if (!id) return null;
  return resolveOrionAbsoluteUrl(
    `/api/integrations/synerlink/documents/${encodeURIComponent(id)}/signed-file`
  );
}

export type OrionResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  /** Código estable de Orion (p. ej. NOT_YOUR_TURN, DOCUMENT_CLOSED). */
  code?: string;
};

async function orionFetch<T>(path: string, init?: RequestInit): Promise<OrionResult<T>> {
  const cfg = getOrionConfig();
  if (!cfg.apiBaseUrl || !cfg.integrationApiKey) {
    return {
      ok: false,
      status: 503,
      data: null,
      error: 'Integración Orion no configurada (ORION_API_BASE_URL / INTEGRATION_API_KEYS)',
    };
  }

  const url = `${cfg.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.integrationApiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 503,
      data: null,
      error: `Motor de firma Orion no disponible (${cfg.apiBaseUrl}). ${message}`,
    };
  }

  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errBody = data as { error?: string; message?: string; code?: string } | null;
    const looksLikeHtml =
      /^\s*</.test(text) || /<!DOCTYPE|This page could not be found/i.test(text);
    const fallback =
      res.status === 404 && looksLikeHtml
        ? `Orion no expone ${path} (404). Reinicie GSS Firma / front-orion para cargar las rutas de integración SynerLink.`
        : looksLikeHtml
          ? `Respuesta no válida de Orion (${res.status}) en ${path}`
          : text || res.statusText;
    return {
      ok: false,
      status: res.status,
      data,
      error: errBody?.error || errBody?.message || fallback,
      code: typeof errBody?.code === 'string' ? errBody.code : undefined,
    };
  }

  return { ok: true, status: res.status, data };
}

export async function getOrionDocumentByRef(
  externalRef: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  const encoded = encodeURIComponent(externalRef);
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/by-ref?externalRef=${encoded}`,
    { method: 'GET' }
  );
}

export async function createOrionDocument(
  payload: OrionCreateDocumentPayload
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>('/api/integrations/synerlink/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getOrionDocument(
  orionDocumentId: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}`,
    { method: 'GET' }
  );
}

/** 409 SIGNED_SIGNER_LOCKED si se quita o mueve a alguien que ya firmó. */
export async function assignOrionSigners(
  orionDocumentId: string,
  payload: OrionAssignSignersPayload & { actorEmail?: string | null }
): Promise<OrionResult<OrionDocumentResponse>> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/signers`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export type OrionDocumentEventPayload = {
  /** Id idempotente (`kronos-orion_document_event-{id}`): Orion no duplica reintentos. */
  eventId?: string | null;
  type: string;
  label: string;
  versionLabel?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  detail?: string | null;
  synerlinkRequestId: number;
  fileId: string;
  occurredAt: string;
};

let orionEventsEndpointMissing = false;

/** Hoja de vida en Orion. Si Orion aún no expone la ruta (404) se deja de intentar. */
export async function postOrionDocumentEvent(
  orionDocumentId: string,
  event: OrionDocumentEventPayload
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (orionEventsEndpointMissing) return { ok: false, status: 404 };
  const res = await orionFetch<unknown>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/events`,
    { method: 'POST', body: JSON.stringify(event) }
  );
  if (res.status === 404 && !res.data) orionEventsEndpointMissing = true;
  return { ok: res.ok, status: res.status, error: res.error };
}

export async function sendOrionDocument(
  orionDocumentId: string,
  options?: { actorEmail?: string | null }
): Promise<OrionResult<OrionDocumentResponse>> {
  const actorEmail = String(options?.actorEmail || '').trim().toLowerCase();
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/send`,
    { method: 'POST', body: JSON.stringify(actorEmail ? { actorEmail } : {}) }
  );
}

/** Consentimiento legal que exige Orion accept-sign (UI vive en SynerLink). */
export const ORION_SIGNING_LEGAL_CONSENT_VERSION = 'co-ley527-d2364-v1';

/** Consentimiento biométrico (huella) — Orion `co-ley1581-art6-huella-v1`. */
export const ORION_BIOMETRIC_CONSENT_VERSION = 'co-ley1581-art6-huella-v1';

/** Firmante interno acepta y aplica su rúbrica guardada (sin embed de gestión). */
export async function acceptOrionSignerTurn(
  orionDocumentId: string,
  email: string,
  options?: {
    signatureDataUrl?: string | null;
    fingerprintDataUrl?: string | null;
    originalPdfBase64?: string | null;
    fullName?: string | null;
    idDocumentType?: string | null;
    idNumber?: string | null;
    companySlug?: string | null;
    companyName?: string | null;
    companyNit?: string | null;
    jobTitle?: string | null;
    /** Si false, no se envía consentimiento (Orion rechazará). Default: true. */
    legalConsentAccepted?: boolean | null;
    legalConsentKind?: 'ELECTRONIC' | 'DIGITAL' | null;
    /** Preferencia Kronos: este turno exige huella. */
    requireFingerprint?: boolean | null;
    /** Slot de secuencia (mismo email puede firmar varias veces). */
    signOrder?: number | null;
    /** Consentimiento biométrico Ley 1581 (obligatorio si hay huella). */
    biometricConsentAccepted?: boolean | null;
    biometricConsentVersion?: string | null;
    biometricConsentAcceptedAt?: string | null;
  }
): Promise<OrionResult<OrionDocumentResponse>> {
  const payload: Record<string, string | boolean | number> = {
    email: email.trim().toLowerCase(),
  };
  if (typeof options?.requireFingerprint === 'boolean') {
    payload.requireFingerprint = options.requireFingerprint;
  }
  const signOrder = Number(options?.signOrder);
  if (Number.isFinite(signOrder) && signOrder > 0) {
    payload.signOrder = signOrder;
  }
  const dataUrl = String(options?.signatureDataUrl || '').trim();
  if (dataUrl.startsWith('data:image/')) {
    payload.signatureDataUrl = dataUrl;
  }
  const fingerprintDataUrl = String(options?.fingerprintDataUrl || '').trim();
  if (fingerprintDataUrl.startsWith('data:image/')) {
    payload.fingerprintDataUrl = fingerprintDataUrl;
  }
  const originalPdfBase64 = String(options?.originalPdfBase64 || '')
    .trim()
    .replace(/^data:application\/pdf;base64,/i, '');
  if (originalPdfBase64) {
    payload.originalPdfBase64 = originalPdfBase64;
  }
  const fullName = String(options?.fullName || '').trim();
  if (fullName) payload.fullName = fullName;
  const idDocumentType = String(options?.idDocumentType || '').trim();
  if (idDocumentType) payload.idDocumentType = idDocumentType;
  const idNumber = String(options?.idNumber || '').trim();
  if (idNumber) payload.idNumber = idNumber;
  const companySlug = String(options?.companySlug || '').trim();
  if (companySlug) payload.companySlug = companySlug;
  const companyName = String(options?.companyName || '').trim();
  if (companyName) payload.companyName = companyName;
  const companyNit = String(options?.companyNit || '').trim();
  if (companyNit) payload.companyNit = companyNit;
  const jobTitle = String(options?.jobTitle || '').trim();
  if (jobTitle) payload.jobTitle = jobTitle;

  // Orion exige legalConsent* (no acceptedTerms). SynerLink ya validó el checkbox.
  if (options?.legalConsentAccepted !== false) {
    payload.legalConsentAccepted = true;
    payload.legalConsentKind =
      options?.legalConsentKind === 'DIGITAL' ? 'DIGITAL' : 'ELECTRONIC';
    payload.legalConsentVersion = ORION_SIGNING_LEGAL_CONSENT_VERSION;
    payload.legalConsentAcceptedAt = new Date().toISOString();
  }

  // Huella → consentimiento biométrico Ley 1581 (Orion 422 si falta).
  if (options?.biometricConsentAccepted === true) {
    payload.biometricConsentAccepted = true;
    payload.biometricConsentVersion =
      String(options.biometricConsentVersion || '').trim() ||
      ORION_BIOMETRIC_CONSENT_VERSION;
    payload.biometricConsentAcceptedAt =
      String(options.biometricConsentAcceptedAt || '').trim() ||
      new Date().toISOString();
  }

  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/accept-sign`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export type OrionPersonConsentStatus = {
  email: string;
  displayName?: string;
  hasSigningLegalConsent: boolean;
  signingLegalConsentVersion?: string | null;
  signingLegalConsentKind?: string | null;
  signingLegalConsentAcceptedAt?: string | null;
  hasBiometricConsent: boolean;
  biometricConsentVersion?: string | null;
  biometricConsentAcceptedAt?: string | null;
  currentSigningLegalVersion: string;
  currentBiometricVersion: string;
};

/** GET consentimiento a nivel persona en Orion. */
export async function getOrionPersonConsent(email: string) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<OrionPersonConsentStatus>(
    `/api/integrations/synerlink/user-consent?email=${encoded}`,
    { method: 'GET' }
  );
}

/** POST guarda consentimiento general (firma y/o huella) en el perfil Orion. */
export async function saveOrionPersonConsent(
  email: string,
  body: {
    legalConsentAccepted?: boolean;
    legalConsentKind?: 'ELECTRONIC' | 'DIGITAL';
    legalConsentVersion?: string;
    legalConsentAcceptedAt?: string;
    biometricConsentAccepted?: boolean;
    biometricConsentVersion?: string;
    biometricConsentAcceptedAt?: string;
  }
) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<OrionPersonConsentStatus & { ok?: boolean }>(
    `/api/integrations/synerlink/user-consent?email=${encoded}`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

/** Regenera PDF acumulado en Orion (corrige documentos con solo la 1.ª firma). */
export async function rebuildOrionSignedPdf(
  orionDocumentId: string,
  options?: { originalPdfBase64?: string | null }
): Promise<{
  ok: boolean;
  status: number;
  data: (OrionDocumentResponse & { rebuilt?: boolean; signerCount?: number }) | null;
  error?: string;
}> {
  const payload: { originalPdfBase64?: string } = {};
  const b64 = String(options?.originalPdfBase64 || '').trim();
  if (b64) payload.originalPdfBase64 = b64.replace(/^data:application\/pdf;base64,/i, '');

  return orionFetch(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/rebuild-signed-pdf`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/** Firmante en turno devuelve el documento al coordinador (sin cerrar la solicitud). */
export async function returnOrionDocument(
  orionDocumentId: string,
  payload: { email: string; reason: string }
): Promise<OrionResult<OrionDocumentResponse>> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/return`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        reason: String(payload.reason || '').trim(),
      }),
    }
  );
}

/** Rechazo definitivo (RECHAZADO). 409 DOCUMENT_CLOSED si ya estaba cerrado. */
export async function rejectOrionDocument(
  orionDocumentId: string,
  payload: { email?: string | null; reason?: string | null }
): Promise<OrionResult<OrionDocumentResponse>> {
  const body: Record<string, string> = {};
  const email = String(payload.email || '').trim().toLowerCase();
  const reason = String(payload.reason || '').trim();
  if (email) body.email = email;
  if (reason) body.reason = reason;
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/reject`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function getOrionSignatureEmbedUrl(
  email: string
): Promise<{ ok: boolean; status: number; data: { embedUrl: string; email: string } | null; error?: string }> {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<{ embedUrl: string; email: string }>(
    `/api/integrations/synerlink/embed/signature-url?email=${encoded}`,
    { method: 'GET' }
  );
}

/**
 * Pide a Orion la URL pública de firma (`/sign/{token}`).
 * No usar /firma/externa de SynerLink en correos.
 */
export async function fetchOrionSignerSignUrl(
  orionDocumentId: string,
  email: string,
  signOrder?: number | null
): Promise<{ ok: boolean; status: number; signUrl: string | null; error?: string }> {
  const docId = String(orionDocumentId || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  if (!docId || !mail) {
    return { ok: false, status: 400, signUrl: null, error: 'docId y email son obligatorios' };
  }
  const qs = new URLSearchParams({ docId, email: mail });
  const order = Number(signOrder);
  if (Number.isFinite(order) && order > 0) qs.set('signOrder', String(order));

  const res = await orionFetch<{ signUrl?: string; email?: string }>(
    `/api/integrations/synerlink/embed/sign-url?${qs.toString()}`,
    { method: 'GET' }
  );
  const raw = String(res.data?.signUrl || '').trim();
  const signUrl = resolveOrionAbsoluteUrl(raw) || raw || null;
  if (!res.ok || !signUrl) {
    return {
      ok: false,
      status: res.status,
      signUrl: null,
      error: res.error || 'Orion no devolvió URL de firma',
    };
  }
  return { ok: true, status: res.status, signUrl };
}

export async function loadOrionUserSignature(email: string) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  const result = await orionFetch<{
    dataUrl?: string | null;
    method?: string | null;
    hasSignature?: boolean;
    code?: string;
    error?: string;
  }>(`/api/integrations/synerlink/user-signature?email=${encoded}`, { method: 'GET' });

  if (!result.ok) return result;

  return {
    ...result,
    data: {
      dataUrl: result.data?.dataUrl ?? null,
      method: result.data?.method ?? null,
    },
  };
}

export async function saveOrionUserSignature(
  email: string,
  signatureDataUrl: string,
  method: 'drawn' | 'uploaded' = 'drawn'
) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<{ ok: boolean; skipped?: boolean; code?: string; error?: string }>(
    `/api/integrations/synerlink/user-signature?email=${encoded}`,
    {
      method: 'POST',
      body: JSON.stringify({ signatureDataUrl, method }),
    }
  );
}

type OrionSignatureFieldInput = {
  id: string;
  signerOrder: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  kind?: 'signature' | 'fingerprint' | 'validation';
};

/**
 * Persiste recuadros de firma en Orion.
 * Preferido: POST /documents/{id}/signature-fields con Bearer de integración.
 * Fallback: embed API + token (bags viejos / Orion sin la ruta nueva).
 */
export async function saveOrionSignatureFields(params: {
  orionDocumentId: string;
  embedToken?: string | null;
  signatureFields: OrionSignatureFieldInput[];
  /** Legacy email→huella (ambiguo si el mismo email firma 2 veces). */
  signerRequireFingerprint?: Record<string, boolean>;
  /** signOrder→huella (fuente de verdad con emails repetidos). */
  signerRequireFingerprintByOrder?: Record<string, boolean>;
}): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  const id = encodeURIComponent(params.orionDocumentId);
  const body: {
    signatureFields: OrionSignatureFieldInput[];
    signerRequireFingerprint?: Record<string, boolean>;
    signerRequireFingerprintByOrder?: Record<string, boolean>;
  } = {
    signatureFields: params.signatureFields,
  };
  if (params.signerRequireFingerprint) {
    body.signerRequireFingerprint = params.signerRequireFingerprint;
  }
  if (params.signerRequireFingerprintByOrder) {
    body.signerRequireFingerprintByOrder = params.signerRequireFingerprintByOrder;
  }
  const viaKey = await orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${id}/signature-fields`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  if (viaKey.ok) return viaKey;

  // 404/405: Orion aún no expone la ruta → fallback embed.
  const embedToken = String(params.embedToken || '').trim();
  if (!embedToken) return viaKey;

  const qs = new URLSearchParams({
    docId: params.orionDocumentId,
    token: embedToken,
    action: 'signatureFields',
  });
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/embed/document?${qs.toString()}`,
    {
      method: 'POST',
      body: JSON.stringify({ signatureFields: params.signatureFields }),
    }
  );
}

/** Descarga binaria de una URL Orion protegida (Bearer integration key). */
export async function fetchOrionProtectedFile(url: string): Promise<{
  ok: boolean;
  status: number;
  buffer: ArrayBuffer | null;
  contentType: string | null;
  error?: string;
}> {
  const cfg = getOrionConfig();
  if (!cfg.integrationApiKey) {
    return {
      ok: false,
      status: 503,
      buffer: null,
      contentType: null,
      error: 'Integración Orion no configurada',
    };
  }

  const absoluteUrl = resolveOrionAbsoluteUrl(url);
  if (!absoluteUrl) {
    return {
      ok: false,
      status: 503,
      buffer: null,
      contentType: null,
      error: 'ORION_API_BASE_URL no configurado',
    };
  }

  try {
    const res = await fetch(absoluteUrl, {
      headers: { Authorization: `Bearer ${cfg.integrationApiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        buffer: null,
        contentType: null,
        error: text || res.statusText,
      };
    }
    const buffer = await res.arrayBuffer();
    return {
      ok: true,
      status: res.status,
      buffer,
      contentType: res.headers.get('content-type'),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error de red';
    const unreachable =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(message);
    return {
      ok: false,
      status: unreachable ? 503 : 502,
      buffer: null,
      contentType: null,
      error: unreachable
        ? `Motor de firma Orion no disponible (${cfg.apiBaseUrl || 'ORION_API_BASE_URL'}). Inicie Orion y vuelva a intentar.`
        : message,
    };
  }
}

/** Intenta descargar el PDF firmado usando la URL canónica y fallbacks almacenados. */
export async function fetchOrionSignedFileContent(params: {
  orionDocumentId?: string | null;
  signedFileUrl?: string | null;
  /** Solo firmas con order <= maxOrder (versión histórica parcial). */
  maxSignerOrder?: number | null;
  /** Marca de agua DOCUMENTO VALIDADO (versión aparte; no mezclar con historial de firmas). */
  validated?: boolean;
}): Promise<{
  ok: boolean;
  status: number;
  buffer: ArrayBuffer | null;
  contentType: string | null;
  error?: string;
}> {
  const withQuery = (url: string): string => {
    const u = new URL(url);
    if (params.maxSignerOrder != null && Number.isFinite(params.maxSignerOrder)) {
      u.searchParams.set('maxOrder', String(params.maxSignerOrder));
    }
    if (params.validated) {
      u.searchParams.set('validated', '1');
    }
    return u.toString();
  };

  const candidates = [
    params.orionDocumentId ? buildOrionSignedFileApiUrl(params.orionDocumentId) : null,
    resolveOrionAbsoluteUrl(params.signedFileUrl),
  ]
    .filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index)
    .map(withQuery);

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 404,
      buffer: null,
      contentType: null,
      error: 'No hay URL de PDF firmado en Orion',
    };
  }

  let last = {
    ok: false,
    status: 502,
    buffer: null as ArrayBuffer | null,
    contentType: null as string | null,
    error: 'No se pudo descargar el PDF firmado desde Orion',
  };

  for (const url of candidates) {
    const result = await fetchOrionProtectedFile(url);
    if (result.ok && result.buffer) return result;
    last = {
      ...result,
      error: result.error || last.error,
    };
  }

  return last;
}

/**
 * Contrato v3: URL pública `/review/{token}` para que un aprobador del cliente revise el
 * borrador (Aceptar / Rechazar). 404 = Orion aún no implementa la revisión de borradores.
 */
export async function fetchOrionDraftReviewUrl(params: {
  orionDocumentId: string;
  email: string;
  name?: string | null;
  cardCode?: string | null;
  reviewOrder: number;
  expiresInHours?: number;
  forceRefresh?: boolean;
}): Promise<{ ok: boolean; status: number; reviewUrl: string | null; expiresAt: string | null; error?: string }> {
  const res = await orionFetch<{
    reviewUrl?: string;
    url?: string;
    expiresAt?: string;
    error?: string;
  }>(`/api/integrations/synerlink/embed/review-url`, {
    method: 'POST',
    body: JSON.stringify({
      docId: params.orionDocumentId,
      email: params.email.trim().toLowerCase(),
      name: params.name ?? undefined,
      cardCode: params.cardCode ?? undefined,
      reviewOrder: params.reviewOrder,
      expiresInHours: params.expiresInHours ?? 24,
      sendEmail: false,
      forceRefresh: params.forceRefresh === true,
    }),
  });
  const raw = String(res.data?.reviewUrl || res.data?.url || '').trim();
  const reviewUrl = resolveOrionAbsoluteUrl(raw) || raw || null;
  if (!res.ok || !reviewUrl) {
    return {
      ok: false,
      status: res.status,
      reviewUrl: null,
      expiresAt: null,
      error: res.error || res.data?.error || 'Orion no devolvió la URL de revisión',
    };
  }
  return { ok: true, status: res.status, reviewUrl, expiresAt: res.data?.expiresAt ?? null };
}

export type OrionDraftReviewDecisionRow = {
  email: string;
  name?: string | null;
  reviewOrder?: number | null;
  decision: 'ACEPTADO' | 'RECHAZADO';
  comment?: string | null;
  decidedAt?: string | null;
};

/**
 * Decisiones registradas en Orion para un borrador (respaldo del webhook: si el aviso no llegó,
 * Kronos las consulta). Orion con GET /embed/review-url; si no lo tiene, se leen de la hoja de vida.
 */
export async function fetchOrionDraftReviewDecisions(
  orionDocumentId: string
): Promise<{ ok: boolean; decisions: OrionDraftReviewDecisionRow[]; error?: string }> {
  const id = encodeURIComponent(orionDocumentId);
  const signal = AbortSignal.timeout(8000);
  const direct = await orionFetch<{ reviewers?: Array<Partial<OrionDraftReviewDecisionRow> & { status?: string }> }>(
    `/api/integrations/synerlink/embed/review-url?docId=${id}`,
    { method: 'GET', signal }
  );
  if (direct.ok) {
    const decisions = (direct.data?.reviewers ?? [])
      .filter((r) => r.email && (r.decision === 'ACEPTADO' || r.decision === 'RECHAZADO'))
      .map((r) => ({
        email: String(r.email).trim().toLowerCase(),
        name: r.name ?? null,
        reviewOrder: r.reviewOrder ?? null,
        decision: r.decision as 'ACEPTADO' | 'RECHAZADO',
        comment: r.comment ?? null,
        decidedAt: r.decidedAt ?? null,
      }));
    return { ok: true, decisions };
  }
  if (direct.status !== 404 && direct.status !== 405) {
    return { ok: false, decisions: [], error: direct.error };
  }

  // Orion sin la consulta: los hitos BORRADOR_ACEPTADO / BORRADOR_RECHAZADO de la hoja de vida.
  const timeline = await orionFetch<{
    events?: Array<{
      documentId?: string | null;
      type?: string;
      actorEmail?: string | null;
      actorName?: string | null;
      detail?: string | null;
      occurredAt?: string | null;
    }>;
  }>(`/api/integrations/synerlink/documents/timeline?orionDocumentId=${id}`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  if (!timeline.ok) return { ok: false, decisions: [], error: timeline.error };
  const decisions = (timeline.data?.events ?? [])
    .filter(
      (e) =>
        e.documentId === orionDocumentId &&
        e.actorEmail &&
        (e.type === 'BORRADOR_ACEPTADO' || e.type === 'BORRADOR_RECHAZADO')
    )
    .map((e) => {
      const rejected = e.type === 'BORRADOR_RECHAZADO';
      // Orion guarda el rechazo como "Nombre: descripción".
      const detail = String(e.detail || '');
      const sep = detail.indexOf(': ');
      return {
        email: String(e.actorEmail).trim().toLowerCase(),
        name: e.actorName ?? null,
        reviewOrder: null,
        decision: (rejected ? 'RECHAZADO' : 'ACEPTADO') as 'ACEPTADO' | 'RECHAZADO',
        comment: rejected ? (sep >= 0 ? detail.slice(sep + 2) : detail) || null : null,
        decidedAt: e.occurredAt ?? null,
      };
    });
  return { ok: true, decisions };
}

/** Contrato v3: anula enlaces de revisión pendientes (otro aprobador rechazó). */
export async function revokeOrionDraftReviewUrls(params: {
  orionDocumentId: string;
  emails: string[];
  reason: string;
}): Promise<OrionResult<unknown>> {
  return orionFetch<unknown>(`/api/integrations/synerlink/embed/review-url/revoke`, {
    method: 'POST',
    body: JSON.stringify({
      docId: params.orionDocumentId,
      emails: params.emails.map((e) => e.trim().toLowerCase()),
      reason: params.reason,
    }),
  });
}
