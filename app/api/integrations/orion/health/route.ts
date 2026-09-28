import { NextResponse } from 'next/server';
import { getOrionConfig, getOrionSignatureProfileUrl, buildOrionExternalRef } from '@/lib/orion/config';
import { getOrionDocumentByRef, listOrionTenants } from '@/lib/orion/client';
import { compareOrionTenantMaps, parseOrionTenantMap } from '@/lib/orion/tenantCheck';

/** GET /api/integrations/orion/health — diagnóstico rápido */
export async function GET() {
  const cfg = getOrionConfig();
  if (!cfg.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'ORION_API_BASE_URL u ORION_INTEGRATION_API_KEY no configurados',
        config: {
          apiBaseUrl: cfg.apiBaseUrl,
          embedOrigin: cfg.embedOrigin,
          tenantMapKeys: Object.keys(cfg.tenantMap),
        },
      },
      { status: 503 }
    );
  }

  let orionReachable = false;
  let orionError: string | null = null;
  try {
    const probe = await getOrionDocumentByRef(buildOrionExternalRef(0));
    orionReachable = probe.status !== 0;
    if (!probe.ok && probe.status >= 500) {
      orionError = probe.error || `HTTP ${probe.status}`;
    } else {
      orionReachable = true;
    }
  } catch (e) {
    orionError = e instanceof Error ? e.message : 'Error de red';
  }

  let tenants: {
    checked: boolean;
    matches: boolean | null;
    orionTenantMap: Record<number, string> | null;
    /** ORION_TENANT_MAP dice un slug y Orion otro para la misma empresa. */
    mismatches: ReturnType<typeof compareOrionTenantMaps>;
    /** En ORION_TENANT_MAP pero aún no en Orion: se crean solas (sync_orion_tenants). */
    pendingInOrion: number[];
    error: string | null;
  } = {
    checked: false,
    matches: null,
    orionTenantMap: null,
    mismatches: [],
    pendingInOrion: [],
    error: null,
  };
  try {
    const res = await listOrionTenants();
    if (res.ok) {
      const orionTenantMap = parseOrionTenantMap(res.data);
      const diff = compareOrionTenantMaps(cfg.tenantMap, orionTenantMap);
      const mismatches = diff.filter((row) => row.kronos && row.orion);
      tenants = {
        checked: true,
        matches: mismatches.length === 0,
        orionTenantMap,
        mismatches,
        pendingInOrion: diff.filter((row) => row.kronos && !row.orion).map((row) => row.synerlinkCompanyId),
        error: null,
      };
    } else {
      tenants = { ...tenants, error: res.error || `HTTP ${res.status}` };
    }
  } catch (e) {
    tenants = { ...tenants, error: e instanceof Error ? e.message : 'Error de red' };
  }

  return NextResponse.json({
    ok: orionReachable && tenants.matches !== false,
    orionReachable,
    orionError,
    tenants,
    signatureProfileUrl: getOrionSignatureProfileUrl(),
    config: {
      apiBaseUrl: cfg.apiBaseUrl,
      embedOrigin: cfg.embedOrigin,
      tenantMap: cfg.tenantMap,
      hasApiKey: Boolean(cfg.integrationApiKey),
    },
  });
}
