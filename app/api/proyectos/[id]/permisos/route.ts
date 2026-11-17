import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { archivedProject, guardProject } from '../../../../../lib/chat/projects-guard';
import { cargarOperadoresPases, normalizarMotivo, normalizarPolitica } from '../../../../../lib/proyectos/permisos-agentes-rules';
import {
  catalogoActivo,
  ErrorPermisos,
  guardarPolitica,
  leerPolitica,
  puedeGestionarPermisos,
  registroPolitica,
  tablaNoExiste,
} from '../../../../../lib/proyectos/permisos-agentes';
import type { PermisosProyectoDto } from '../../../../../lib/proyectos/permisos-agentes-tipos';
import { agentesDelProyecto } from '../../../../../lib/proyectos/agentes-desarrollo';
import { agentesDeNegocio, avisoSinCodigo, pideCodigo } from '../../../../../lib/proyectos/agentes-desarrollo-rules';

export const dynamic = 'force-dynamic';

/**
 * PERMISOS DE LOS AGENTES de un proyecto (2026-10-20).
 *
 *   GET  la política vigente (nivel de código, repos y autorizadores de pases),
 *        si esta persona la puede cambiar, el catálogo activo y el registro de
 *        cambios. Cualquier miembro (un archivado, solo su dueño).
 *   PATCH { codeLevel, repos[], deployApprovers[], reason } — SOLO la
 *        administración o quien tenga el subproceso /process/proyectos/permisos-agentes
 *        en la empresa del proyecto. Ser dueño NO alcanza. Queda en el registro.
 *        Con agentes de negocio en el proyecto SÍ se guarda código o repos
 *        (2026-11-11): solo los agentes de desarrollo los reciben; los de negocio
 *        siguen en «ninguno» en el puente. La respuesta trae `avisos` informativos.
 *
 * La puerta del proyecto va primero: quien no es miembro recibe 404 aunque sea
 * administrador (no se confirma que el proyecto exista).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const canEdit = !guard.project.archived && (await puedeGestionarPermisos(guard.user.email, guard.project.idCompany));
    const [policy, log, agentes] = await Promise.all([
      leerPolitica(guard.project.idProject),
      registroPolitica(guard.project.idProject),
      agentesDelProyecto(guard.project.idProject),
    ]);
    // Desde el 2026-11-11 el código se puede dar con agentes mixtos: solo los de desarrollo lo
    // reciben (el puente entrega «ninguno» a los de negocio). `codeAllowed` queda siempre en true
    // por compatibilidad con clientes viejos.
    const catalog = canEdit ? await catalogoActivo() : [];
    const dto: PermisosProyectoDto = {
      policy,
      canEdit,
      codeAllowed: true,
      nonDevAgents: agentesDeNegocio(agentes).map((a) => a.displayName),
      catalog,
      operators: cargarOperadoresPases(),
      log,
    };
    return jsonNoStore(dto);
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/permisos', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    if (!(await puedeGestionarPermisos(guard.user.email, guard.project.idCompany))) {
      return forbidden('Solo la administración o quien tenga el permiso «Permisos de agentes en Proyectos» en esta empresa puede cambiarlos.');
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const motivo = normalizarMotivo(payload.reason);
    if (!motivo.ok) return badRequest(motivo.error);
    const catalogo = await catalogoActivo();
    const politica = normalizarPolitica(payload, { catalogoActivo: catalogo.map((r) => r.slug), operadores: cargarOperadoresPases() });
    if (!politica.ok) return badRequest(politica.error);

    const r = await guardarPolitica({ idProject: guard.project.idProject, actor: guard.user, entrada: politica.value, motivo: motivo.value });
    // Con código y agentes de negocio: se guarda igual; esos agentes siguen sin código (aviso, no bloqueo).
    const negocio = pideCodigo(politica.value) ? agentesDeNegocio(await agentesDelProyecto(guard.project.idProject)).map((a) => a.displayName) : [];
    return jsonNoStore({ updated: r.cambio, avisos: negocio.length > 0 ? [avisoSinCodigo(negocio)] : [] });
  } catch (error) {
    if (error instanceof ErrorPermisos) return jsonNoStore({ error: error.message }, { status: error.status });
    if (tablaNoExiste(error)) return jsonNoStore({ error: 'Los permisos de los agentes todavía no están habilitados en este servidor.' }, { status: 503 });
    return serverError('PATCH /api/proyectos/[id]/permisos', error);
  }
}
