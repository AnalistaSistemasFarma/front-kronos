import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { projectModuleCompanies } from '../../../../lib/chat/projects';
import { cargarOperadoresPases } from '../../../../lib/proyectos/permisos-agentes-rules';
import { alcancePermisos, catalogoActivo, esAdminCatalogo } from '../../../../lib/proyectos/permisos-agentes';
import type { OpcionesPermisosDto } from '../../../../lib/proyectos/permisos-agentes-tipos';

export const dynamic = 'force-dynamic';

/**
 * Opciones de «Permisos de los agentes» para «Nuevo proyecto» y la lista (2026-10-20):
 * en qué empresas (de las del módulo) puede esta persona escoger los permisos al
 * crear, si administra el catálogo, el catálogo activo y los operadores que
 * pueden autorizar pases. Sin el módulo, 404.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const empresas = await projectModuleCompanies(user.id);
    if (empresas.length === 0) return jsonNoStore({ error: 'No tiene el módulo «Proyectos».' }, { status: 404 });

    const [alcance, catalogAdmin] = await Promise.all([alcancePermisos(user.email), esAdminCatalogo(user.email)]);
    const editableCompanies = empresas.map((e) => e.idCompany).filter((id) => alcance.all || alcance.companyIds.includes(id));
    const dto: OpcionesPermisosDto = {
      editableCompanies,
      catalogAdmin,
      catalog: editableCompanies.length > 0 || catalogAdmin ? await catalogoActivo() : [],
      operators: cargarOperadoresPases(),
    };
    return jsonNoStore(dto);
  } catch (error) {
    return serverError('GET /api/proyectos/permisos-agentes', error);
  }
}
