import { prisma } from '../../../../../lib/prisma';
import { SGC_CATALOG_ENTITIES, saveCatalogEntry, type SgcCatalogEntity } from '../../../../../lib/sgc/db/catalogs';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/config/<entidad> — crea (sin `id`) o edita (con `id`) un
 * maestro de la empresa: coding-guide, process-types, processes o
 * document-types. Solo Aseguramiento de Calidad. Exige `reason` (control de
 * cambios) y queda en la auditoría con el antes/después.
 */
export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { entity } = await params;
    if (!(SGC_CATALOG_ENTITIES as readonly string[]).includes(entity)) return jsonNoStore({ error: 'Maestro desconocido' }, 404);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    if (!Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) {
      return jsonNoStore({ error: 'Solo Aseguramiento de Calidad configura los maestros del SGC' }, 403);
    }
    const saved = await saveCatalogEntry(prisma, idCompany, entity as SgcCatalogEntity, body, ctx.actor);
    return jsonNoStore({ saved }, body.id ? 200 : 201);
  } catch (error) {
    return errorResponse(error, 'config');
  }
}
