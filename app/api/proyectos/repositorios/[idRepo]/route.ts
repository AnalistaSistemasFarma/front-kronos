import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { normalizarMotivo, normalizarRepoCatalogo } from '../../../../../lib/proyectos/permisos-agentes-rules';
import { cambiarActivoRepo, ErrorPermisos, esAdminCatalogo, guardarRepo, tablaNoExiste } from '../../../../../lib/proyectos/permisos-agentes';

export const dynamic = 'force-dynamic';

/**
 * UN repositorio del catálogo (2026-10-20). SOLO la administración.
 *
 *   PATCH { active: boolean, reason }  activar o desactivar (no se borra nunca).
 *   PATCH { name, github, branchTesting, branchProduction, description?, reason }  editar
 *         (la clave no cambia: los proyectos y el puente la usan).
 */
type Ctx = { params: Promise<{ idRepo: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await esAdminCatalogo(user.email))) return forbidden('Solo la administración de SynerLink administra el catálogo de repositorios.');
    const { idRepo: raw } = await params;
    const idRepo = Number.parseInt(raw, 10);
    if (!Number.isInteger(idRepo) || idRepo <= 0 || String(idRepo) !== raw.trim()) return badRequest('Id de repositorio inválido.');

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const motivo = normalizarMotivo(payload.reason);
    if (!motivo.ok) return badRequest(motivo.error);

    if (typeof payload.active === 'boolean' && payload.name === undefined) {
      const repo = await cambiarActivoRepo({ actor: user, idRepo, active: payload.active, motivo: motivo.value });
      return jsonNoStore({ repo });
    }
    const entrada = normalizarRepoCatalogo(payload, { editando: true });
    if (!entrada.ok) return badRequest(entrada.error);
    const repo = await guardarRepo({ actor: user, idRepo, entrada: entrada.value, motivo: motivo.value });
    return jsonNoStore({ repo });
  } catch (error) {
    if (error instanceof ErrorPermisos) return jsonNoStore({ error: error.message }, { status: error.status });
    if (tablaNoExiste(error)) return jsonNoStore({ error: 'El catálogo de repositorios todavía no está habilitado en este servidor.' }, { status: 503 });
    return serverError('PATCH /api/proyectos/repositorios/[idRepo]', error);
  }
}
