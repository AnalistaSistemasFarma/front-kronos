import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { createApiClient, getApiClient, listAgents, listApiClients, listCompanies, listPermissions } from '@/lib/api-permissions/db';
import { validateApiClientBody } from '@/lib/api-permissions/validate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/administration/api-clients → { clients, permissions, companies, agents }
 * (pestaña «Permisos API» de Administración → Usuarios). Nunca devuelve llaves ni hashes.
 */
export async function GET() {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const [clients, permissions, companies, agents] = await Promise.all([
      listApiClients(),
      listPermissions(),
      listCompanies(),
      listAgents(),
    ]);
    return NextResponse.json({ clients, permissions, companies, agents }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'list');
  }
}

/** POST /api/administration/api-clients — crea un cliente (sin llave; se genera aparte). */
export async function POST(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const parsed = await validateApiClientBody(await readJsonBody(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    const id = await createApiClient(parsed.value, admin.email);
    // Devuelve el cliente para que la pantalla lo agregue sin recargar toda la lista.
    const client = await getApiClient(id);
    return NextResponse.json({ id, client }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'create');
  }
}
