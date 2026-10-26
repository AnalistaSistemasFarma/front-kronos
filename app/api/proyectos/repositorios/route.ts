import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { normalizarMotivo, normalizarRepoCatalogo } from '../../../../lib/proyectos/permisos-agentes-rules';
import { catalogoCompleto, ErrorPermisos, esAdminCatalogo, guardarRepo, tablaNoExiste } from '../../../../lib/proyectos/permisos-agentes';

export const dynamic = 'force-dynamic';

/**
 * CATÁLOGO de repositorios que se pueden vincular a un proyecto (2026-10-20).
 * SOLO la administración de SynerLink (rol admin o Administración → Usuarios).
 *
 *   GET   todo el catálogo (activos e inactivos) con cuántos proyectos usa cada repo.
 *   POST  { slug, name, github, branchTesting, branchProduction, description?, reason }
 */
const SOLO_ADMIN = 'Solo la administración de SynerLink administra el catálogo de repositorios.';

export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await esAdminCatalogo(user.email))) return forbidden(SOLO_ADMIN);
    return jsonNoStore({ repos: await catalogoCompleto() });
  } catch (error) {
    if (tablaNoExiste(error)) return jsonNoStore({ repos: [], pendiente: true });
    return serverError('GET /api/proyectos/repositorios', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await esAdminCatalogo(user.email))) return forbidden(SOLO_ADMIN);
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const motivo = normalizarMotivo(payload.reason);
    if (!motivo.ok) return badRequest(motivo.error);
    const repo = normalizarRepoCatalogo(payload);
    if (!repo.ok) return badRequest(repo.error);
    const creado = await guardarRepo({ actor: user, entrada: repo.value, motivo: motivo.value });
    return jsonNoStore({ repo: creado }, { status: 201 });
  } catch (error) {
    if (error instanceof ErrorPermisos) return jsonNoStore({ error: error.message }, { status: error.status });
    if (tablaNoExiste(error)) return jsonNoStore({ error: 'El catálogo de repositorios todavía no está habilitado en este servidor.' }, { status: 503 });
    return serverError('POST /api/proyectos/repositorios', error);
  }
}
