function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseTenantMap(raw: string | undefined): Record<number, string> {
  const obj = parseJsonObject(raw);
  const map: Record<number, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const companyId = Number(key);
    if (Number.isInteger(companyId) && companyId > 0 && typeof value === 'string' && value.trim()) {
      map[companyId] = value.trim();
    }
  }
  return map;
}

export type OrionConfig = {
  apiBaseUrl: string | null;
  embedOrigin: string | null;
  integrationApiKey: string | null;
  tenantMap: Record<number, string>;
  enabled: boolean;
};

function trimUrl(raw: string | undefined): string | null {
  return raw?.trim().replace(/\/$/, '') || null;
}

/** Tiempo que se usa ORION_FALLBACK_URL antes de volver a intentar ORION_API_BASE_URL. */
const FALLBACK_TTL_MS = 60_000;

const fallbackState = globalThis as typeof globalThis & { __orionFallbackUntil?: number };

export function getOrionFallbackUrl(): string | null {
  const fallback = trimUrl(process.env.ORION_FALLBACK_URL);
  return fallback && fallback !== trimUrl(process.env.ORION_API_BASE_URL) ? fallback : null;
}

export function isOrionFallbackActive(): boolean {
  return Boolean(getOrionFallbackUrl()) && (fallbackState.__orionFallbackUntil ?? 0) > Date.now();
}

export function activateOrionFallback(): void {
  fallbackState.__orionFallbackUntil = Date.now() + FALLBACK_TTL_MS;
}

export function getOrionConfig(): OrionConfig {
  const primary = trimUrl(process.env.ORION_API_BASE_URL);
  const primaryEmbed = trimUrl(process.env.ORION_EMBED_ORIGIN) || primary;
  const fallback = isOrionFallbackActive() ? getOrionFallbackUrl() : null;
  const apiBaseUrl = fallback || primary;
  const embedOrigin = fallback && (!primaryEmbed || primaryEmbed === primary) ? fallback : primaryEmbed;

  const dedicated = process.env.ORION_INTEGRATION_API_KEY?.trim();
  const keys = (process.env.INTEGRATION_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const orionFromList = keys.find((k) => /orion|gss-orion/i.test(k));
  const integrationApiKey = dedicated || orionFromList || keys[0] || null;

  const tenantMap = parseTenantMap(process.env.ORION_TENANT_MAP);

  return {
    apiBaseUrl,
    embedOrigin,
    integrationApiKey,
    tenantMap,
    enabled: Boolean(apiBaseUrl && integrationApiKey),
  };
}

/** Email fallback si el solicitante SynerLink no existe en Orion. */
export function getOrionDefaultCreatedByEmail(): string | null {
  const raw = process.env.ORION_DEFAULT_CREATED_BY_EMAIL?.trim();
  return raw || null;
}

export function resolveOrionTenantId(synerlinkCompanyId: number): string | null {
  const { tenantMap } = getOrionConfig();
  return tenantMap[synerlinkCompanyId] ?? null;
}

/** Clave interna para JSON legacy (1 doc por solicitud sin fileId). */
export const ORION_LEGACY_FILE_ID = '_legacy';

/**
 * externalRef Orion:
 * - legacy: synerlink://request/{id}
 * - por archivo: synerlink://request/{id}/file/{fileId}
 * - subversión: synerlink://request/{id}/file/{fileId}/v/{v1.1}
 * La v1.0 conserva el ref sin sufijo para no romper documentos ya creados.
 */
export function buildOrionExternalRef(
  requestId: number,
  fileId?: string | null,
  versionLabel?: string | null
): string {
  const base = `synerlink://request/${requestId}`;
  const fid = String(fileId || '').trim();
  if (!fid || fid === ORION_LEGACY_FILE_ID) return base;
  const fileRef = `${base}/file/${encodeURIComponent(fid)}`;
  const label = String(versionLabel || '').trim();
  if (!label || label === 'v1.0') return fileRef;
  return `${fileRef}/v/${encodeURIComponent(label)}`;
}

export function getOrionSignatureProfileUrl(): string | null {
  const custom = process.env.ORION_SIGNATURE_PROFILE_URL?.trim();
  if (custom) return custom.replace(/\/$/, '');
  const { embedOrigin } = getOrionConfig();
  return embedOrigin ? `${embedOrigin}/dashboard/my-signature` : null;
}

export type OrionSignerEmailSender = 'orion' | 'synerlink' | 'both';

/**
 * Quién envía el correo de turno a los firmantes (ORION_SIGNER_EMAIL_SENDER):
 * - orion (defecto): Orion por Graph a quien tenga notifyByEmail.
 * - synerlink: Orion recibe notifyByEmail:false y SynerLink envía por SAPSEND.
 * - both: ambos.
 */
export function getOrionSignerEmailSender(): OrionSignerEmailSender {
  const raw = String(process.env.ORION_SIGNER_EMAIL_SENDER || '')
    .trim()
    .toLowerCase();
  return raw === 'synerlink' || raw === 'both' ? raw : 'orion';
}

export function parseRequestIdFromExternalRef(externalRef: string | undefined): number | null {
  if (!externalRef?.trim()) return null;
  const match = /synerlink:\/\/request\/(\d+)/i.exec(externalRef.trim());
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseFileIdFromExternalRef(externalRef: string | undefined): string | null {
  if (!externalRef?.trim()) return null;
  const match = /synerlink:\/\/request\/\d+\/file\/([^/?#]+)/i.exec(externalRef.trim());
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
