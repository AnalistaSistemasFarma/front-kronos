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

export function getOrionConfig(): OrionConfig {
  const apiBaseUrl = process.env.ORION_API_BASE_URL?.trim().replace(/\/$/, '') || null;
  const embedOrigin = process.env.ORION_EMBED_ORIGIN?.trim().replace(/\/$/, '') || apiBaseUrl;

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

export function buildOrionExternalRef(requestId: number): string {
  return `synerlink://request/${requestId}`;
}

export function getOrionSignatureProfileUrl(): string | null {
  const custom = process.env.ORION_SIGNATURE_PROFILE_URL?.trim();
  if (custom) return custom.replace(/\/$/, '');
  const { embedOrigin } = getOrionConfig();
  return embedOrigin ? `${embedOrigin}/dashboard/my-signature` : null;
}

export function parseRequestIdFromExternalRef(externalRef: string | undefined): number | null {
  if (!externalRef?.trim()) return null;
  const match = /synerlink:\/\/request\/(\d+)/i.exec(externalRef.trim());
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}
