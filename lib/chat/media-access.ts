import 'server-only';
import { getChatAccess } from './access';
import { projectModuleCompanies } from './projects';
import type { ChatSessionUser } from './http';

/**
 * ¿Esta persona usa ALGÚN chat (módulo Chat o módulo Proyectos)? Es la puerta
 * del buscador de GIF, del proxy y de los stickers (2026-10-20): quien no
 * tiene chat no gasta el cupo de GIPHY ni usa el servidor como proxy.
 * Devuelve además las empresas del módulo de Chat (para los stickers propios
 * de cada empresa).
 */
export async function accesoAMedia(
  user: ChatSessionUser
): Promise<{ ok: boolean; empresas: number[]; nombresEmpresas: { id: number; nombre: string }[] }> {
  const acceso = await getChatAccess(user.email);
  const empresas = acceso.companies.map((c) => c.idCompany);
  // Nombres de las empresas del módulo de Chat: a ellas se puede proponer un
  // sticker propio («Mis stickers», 2026-10-21).
  const nombresEmpresas = acceso.companies.map((c) => ({ id: c.idCompany, nombre: c.companyName }));
  if (acceso.canUseChat) return { ok: true, empresas, nombresEmpresas };
  const proyectos = await projectModuleCompanies(user.id);
  return {
    ok: proyectos.length > 0,
    empresas: [...new Set([...empresas, ...proyectos.map((p) => p.idCompany)])],
    nombresEmpresas,
  };
}
