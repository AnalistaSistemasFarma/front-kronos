import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { badRequest, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../lib/chat/http';
import { designableAgents, listProjectsForUser, projectModuleCompanies } from '../../../lib/chat/projects';
import {
  isKnownProfile,
  MAX_OWNED_PROJECTS,
  normalizeAgentCodes,
  normalizeProjectDescription,
  normalizeProjectInstructions,
  normalizeProjectName,
  PROJECT_PROFILES,
} from '../../../lib/chat/projects-rules';
import type { ListaProyectosDto } from '../../../lib/proyectos/tipos';
import { pedirSugerencia } from '../../../lib/proyectos/equipo';
import { estadosTrabajandoVisibles } from '../../../lib/proyectos/estado-agente-servidor';
import { cargarOperadoresPases, normalizarMotivo, normalizarPolitica, type PoliticaEntrada } from '../../../lib/proyectos/permisos-agentes-rules';
import { catalogoActivo, ErrorPermisos, guardarPolitica, puedeGestionarPermisos, tablaNoExiste } from '../../../lib/proyectos/permisos-agentes';

export const dynamic = 'force-dynamic';

/**
 * Módulo «Proyectos» (2026-10-18).
 *
 *   GET  /api/proyectos[?archivados=1]  proyectos donde la persona es miembro
 *        (archivados: solo los suyos), más las empresas donde tiene el módulo,
 *        los agentes que puede designar en cada una y los perfiles.
 *   POST /api/proyectos  { name, idCompany, description?, agentCodes[], profile, instructions?, suggestTeam? }
 *        suggestTeam (F2, 2026-10-18): al crear, pide de una vez al primer
 *        asistente una sugerencia de equipo de subagentes (quedan PROPUESTOS).
 *        agentPolicy? (2026-10-20): { codeLevel, repos[], deployApprovers[], reason? }
 *        permisos de los agentes. Solo se guardan si quien crea puede
 *        cambiarlos en esa empresa (administración o el subproceso
 *        /process/proyectos/permisos-agentes); si no puede y pide algo distinto
 *        de «ninguno», 403. Sin agentPolicy, el proyecto queda en «ninguno».
 *
 * SEGURIDAD
 *   - La persona sale de la SESIÓN; el dueño es SIEMPRE quien crea.
 *   - Debe tener el permiso del módulo en la empresa escogida.
 *   - Cada agente debe estar asignado a la persona EN ESA empresa, tener
 *     proyectos habilitados (CHAT_PROJECTS_AGENTS) y admitir el perfil.
 *   - Sin el módulo, 404.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const archivados = request.nextUrl.searchParams.get('archivados') === '1';
    const data = await listProjectsForUser(user, { archivados });
    if (!data) return jsonNoStore({ error: 'No tiene el módulo «Proyectos».' }, { status: 404 });

    const porEmpresa = await designableAgents(user.email);
    const designables: ListaProyectosDto['designables'] = {};
    for (const c of data.companies) designables[String(c.idCompany)] = porEmpresa.get(c.idCompany) ?? [];

    // Agentes trabajando AHORA en las conversaciones de estos proyectos (2026-10-20),
    // con la misma puerta del icono de la cabecera. Solo de los activos: un
    // proyecto archivado no tiene conversaciones vivas. Lo siguiente llega por el pulso.
    const trabajando =
      archivados || data.projects.length === 0
        ? []
        : await estadosTrabajandoVisibles(
            user.id,
            data.companies.map((c) => c.idCompany),
            { idProjects: data.projects.map((p) => p.idProject) }
          );
    const projects = data.projects.map((p) => ({ ...p, trabajando: trabajando.filter((e) => e.idProject === p.idProject) }));

    // El contrato con la interfaz (lib/proyectos/tipos.ts) lo verifica el compilador.
    const lista: ListaProyectosDto = { companies: data.companies, designables, profiles: [...PROJECT_PROFILES], projects };
    return jsonNoStore(lista);
  } catch (error) {
    return serverError('GET /api/proyectos', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const nombre = normalizeProjectName(payload.name);
    if (!nombre.ok) return badRequest(nombre.error);
    const descripcion = normalizeProjectDescription(payload.description);
    if (!descripcion.ok) return badRequest(descripcion.error);
    const instrucciones = normalizeProjectInstructions(payload.instructions);
    if (!instrucciones.ok) return badRequest(instrucciones.error);
    const codigos = normalizeAgentCodes(payload.agentCodes);
    if (!codigos.ok) return badRequest(codigos.error);
    if (!isKnownProfile(payload.profile)) return badRequest('Escoja el perfil de conectores.');
    const perfil = payload.profile;

    const idCompany = Number(payload.idCompany);
    if (!Number.isInteger(idCompany) || idCompany <= 0) return badRequest('Escoja la empresa del proyecto.');

    // (b) permiso del módulo en esa empresa. Sin él: 404, como si no existiera.
    const empresas = await projectModuleCompanies(user.id);
    if (!empresas.some((e) => e.idCompany === idCompany)) {
      return jsonNoStore({ error: 'No tiene el módulo «Proyectos» en esa empresa.' }, { status: 404 });
    }

    // Agentes: asignados a la persona en esa empresa, habilitados y con el perfil.
    const permitidos = (await designableAgents(user.email, perfil)).get(idCompany) ?? [];
    const porCodigo = new Map(permitidos.map((a) => [a.code.toLowerCase(), a]));
    const faltan = codigos.value.filter((c) => !porCodigo.has(c));
    if (faltan.length > 0) {
      return jsonNoStore(
        { error: 'Alguno de los asistentes no está disponible para usted en esa empresa con ese perfil de conectores.' },
        { status: 403 }
      );
    }
    const agentes = codigos.value.map((c) => porCodigo.get(c)!);

    // Tope de proyectos activos por dueño: cada proyecto despierta sesiones
    // del modelo, y el consumo sale del plan de cada agente.
    const propios = await prisma.chatProject.count({
      where: { archived: false, members: { some: { id_user: user.id, role: 'owner' } } },
    });
    if (propios >= MAX_OWNED_PROJECTS) {
      return jsonNoStore(
        { error: `Ya es dueño de ${MAX_OWNED_PROJECTS} proyectos activos. Archive uno antes de crear otro.` },
        { status: 409 }
      );
    }

    // Permisos de los agentes (2026-10-20). Por defecto «ninguno» y sin repos.
    let politica: { entrada: PoliticaEntrada; motivo: string } | null = null;
    if (payload.agentPolicy !== undefined && payload.agentPolicy !== null) {
      const puede = await puedeGestionarPermisos(user.email, idCompany);
      const pedida = payload.agentPolicy as Record<string, unknown>;
      const esNinguno = typeof pedida === 'object' && pedida?.codeLevel === 'ninguno';
      if (!puede && !esNinguno) {
        return jsonNoStore(
          { error: 'Solo la administración o quien tenga el permiso «Permisos de agentes en Proyectos» en esa empresa puede dar acceso a código.' },
          { status: 403 }
        );
      }
      if (puede) {
        const catalogo = await catalogoActivo();
        const v = normalizarPolitica(pedida, { catalogoActivo: catalogo.map((r) => r.slug), operadores: cargarOperadoresPases() });
        if (!v.ok) return badRequest(v.error);
        const textoMotivo = typeof pedida.reason === 'string' && pedida.reason.trim() ? pedida.reason : 'Permisos escogidos al crear el proyecto.';
        const m = normalizarMotivo(textoMotivo);
        if (!m.ok) return badRequest(m.error);
        politica = { entrada: v.value, motivo: m.value };
      }
    }

    const datosProyecto = {
      name: nombre.value,
      description: descripcion.value,
      // «Agente con el que se creó» (columna de la F1). El acceso lo dan
      // las filas de chat_project_agent.
      id_agent: agentes[0].idAgent,
      id_company: idCompany,
      profile: perfil,
      instructions: instrucciones.value,
      created_by: user.id,
      members: { create: [{ id_user: user.id, role: 'owner', added_by: user.id }] },
      agents: { create: agentes.map((a) => ({ id_agent: a.idAgent, added_by: user.id })) },
    };
    // Con permisos escogidos: proyecto, política y registro en UNA transacción
    // (si la política no se puede guardar, el proyecto no queda creado a medias).
    const pol = politica;
    let creado: { id_project: number };
    try {
      creado = pol
        ? await prisma.$transaction(async (tx) => {
            const p = await tx.chatProject.create({ data: datosProyecto, select: { id_project: true } });
            await guardarPolitica({ idProject: p.id_project, actor: user, entrada: pol.entrada, motivo: pol.motivo, cliente: tx });
            return p;
          })
        : await prisma.chatProject.create({ data: datosProyecto, select: { id_project: true } });
    } catch (error) {
      if (error instanceof ErrorPermisos) return jsonNoStore({ error: error.message }, { status: error.status });
      if (pol && tablaNoExiste(error)) {
        return jsonNoStore({ error: 'Los permisos de los agentes todavía no están habilitados en este servidor. Cree el proyecto sin ellos.' }, { status: 503 });
      }
      throw error;
    }

    // «De primeras» (pedido de Nicolás, 2026-10-18): la sugerencia de equipo
    // sale con la creación. Si no se puede pedir, el proyecto queda creado igual.
    let teamRequested = false;
    if (payload.suggestTeam === true) {
      try {
        await pedirSugerencia(
          { id: user.id, email: user.email },
          { idProject: creado.id_project, name: nombre.value, idCompany, profile: perfil, role: 'owner', archived: false },
          { agentCode: agentes[0].code }
        );
        teamRequested = true;
      } catch (err) {
        console.error('[POST /api/proyectos] sugerencia de equipo:', (err as Error).message);
      }
    }

    return jsonNoStore({ idProject: creado.id_project, teamRequested }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos', error);
  }
}
