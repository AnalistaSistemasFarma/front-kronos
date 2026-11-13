import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { getAgentInventory } from '@/lib/api-permissions/inventory';
import { parseAgentCodeParam } from '@/lib/api-permissions/rules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/administration/api-clients/agents/[code]/inventory → «Lo que tiene hoy» del agente
 * (último escaneo, conectores clasificados, empresas, perfil del puente y gobierno). Solo
 * lectura y solo para quien administra los Permisos API. Nunca devuelve el destino completo
 * de un conector ni nada de agent_inventory_runtime.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const code = parseAgentCodeParam((await params).code);
    if (!code) return NextResponse.json({ error: 'Agente no válido' }, { status: 400, headers: NO_STORE });
    const inventory = await getAgentInventory(code);
    if (!inventory) return NextResponse.json({ error: 'Agente no encontrado' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(inventory, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'inventory');
  }
}
