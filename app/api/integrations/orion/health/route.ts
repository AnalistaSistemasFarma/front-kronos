import { NextResponse } from 'next/server';
import { getOrionConfig, getOrionSignatureProfileUrl, buildOrionExternalRef } from '@/lib/orion/config';
import { getOrionDocumentByRef } from '@/lib/orion/client';

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

  return NextResponse.json({
    ok: orionReachable,
    orionReachable,
    orionError,
    signatureProfileUrl: getOrionSignatureProfileUrl(),
    config: {
      apiBaseUrl: cfg.apiBaseUrl,
      embedOrigin: cfg.embedOrigin,
      tenantMap: cfg.tenantMap,
      hasApiKey: Boolean(cfg.integrationApiKey),
    },
  });
}
