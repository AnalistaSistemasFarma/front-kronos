import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { parseKeyValidityYears } from '@/lib/api-permissions/constants';
import { MAX_ACTIVE_KEYS_PER_CLIENT, createApiClientKey, getApiClient } from '@/lib/api-permissions/db';
import { generateApiKey, parseRouteId } from '@/lib/api-permissions/rules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/administration/api-clients/[id]/keys  { rotate?: boolean, validityYears?: 0|1|2|3|5 }
 * Genera una llave nueva y la devuelve EN CLARO una sola vez. Con rotate=true
 * revoca en la misma transacción las llaves activas del cliente. validityYears > 0 =
 * la llave vence en esos años (0 o ausente = no vence).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const id = parseRouteId((await params).id);
    if (!id) return NextResponse.json({ error: 'Cliente no válido' }, { status: 400, headers: NO_STORE });

    const body = await readJsonBody(request);
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const validBody =
      raw !== null &&
      Object.keys(raw).every((k) => k === 'rotate' || k === 'validityYears') &&
      (raw.rotate === undefined || typeof raw.rotate === 'boolean');
    const validityYears = raw ? parseKeyValidityYears(raw.validityYears) : null;
    if (validBody && validityYears === null) {
      return NextResponse.json({ error: 'Vigencia de la llave no válida' }, { status: 400, headers: NO_STORE });
    }
    if (!validBody) return NextResponse.json({ error: 'Datos no válidos' }, { status: 400, headers: NO_STORE });

    const generated = generateApiKey();
    const result = await createApiClientKey(id, generated, admin.email, raw.rotate === true, validityYears ?? 0);
    if (result.status === 'not_found') {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404, headers: NO_STORE });
    }
    if (result.status === 'no_api_access') {
      return NextResponse.json(
        { error: 'Un proveedor o cliente no lleva llave de API: se administra desde «Administrar portal»' },
        { status: 409, headers: NO_STORE }
      );
    }
    if (result.status === 'too_many') {
      return NextResponse.json(
        { error: `El cliente ya tiene ${MAX_ACTIVE_KEYS_PER_CLIENT} llaves activas: revoque una o use «Rotar»` },
        { status: 409, headers: NO_STORE }
      );
    }
    // El cliente actualizado (sus llaves activas, sin hashes) evita que la pantalla recargue toda la lista.
    const client = await getApiClient(id);
    return NextResponse.json(
      { keyId: result.keyId, key: generated.key, prefix: generated.prefix, revokedKeyIds: result.revokedKeyIds, client },
      { status: 201, headers: NO_STORE }
    );
  } catch (error) {
    return adminErrorResponse(error, 'create-key');
  }
}
