import { NextResponse } from 'next/server';
import { extractBearer, isValidIntegrationApiKey } from '../integration/apiKeyAuth';

export function requireFarmadosisApi(
  req: Request
): { ok: true } | { ok: false; response: NextResponse } {
  const bearer = extractBearer(req.headers.get('authorization'));
  if (isValidIntegrationApiKey(bearer)) return { ok: true };

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'No autorizado',
        hint: 'Use Authorization: Bearer <INTEGRATION_API_KEYS>. La llamada debe ser servidor a servidor; no exponga la key en el navegador.',
      },
      { status: 401 }
    ),
  };
}
