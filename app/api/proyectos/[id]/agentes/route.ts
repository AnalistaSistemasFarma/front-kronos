import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { designableAgents } from '../../../../../lib/chat/projects';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { capabilitiesFor, isKnownProfile, MAX_PROJECT_AGENTS, normalizeAgentCodes, PROJECT_PROFILES } from '../../../../../lib/chat/projects-rules';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import type { ChatSessionUser } from '../../../../../lib/chat/http';
import type { ProjectAccess } from '../../../../../lib/chat/projects';
import { politicaGuardadaConCodigo } from '../../../../../lib/proyectos/permisos-agentes';
import { mensajeSoloDesarrollo } from '../../../../../lib/proyectos/agentes-desarrollo-rules';

export const dynamic = 'force-dynamic';

/**
 * AGENTES designados en un proyecto. El DUEÑO o un ADMINISTRADOR de SynerLink
 * que sea miembro (2026-11-10). Solo se agregan agentes que quien los agrega
 * tiene asignados en la empresa del proyecto (designableAgents).
 *
 *   GET    agentes que puede agregar: los que tiene asignados en la empresa del
 *          proyecto, con proyectos habilitados y con el perfil. Si el proyecto
 *          no tiene asistentes ni conversaciones (se creó SIN asistente,
 *          2026-11-10), se ofrecen todos y `eligePerfil` = true.
 *   POST   { agentCodes: [...], profile? }  designa. Si el proyecto tiene acceso a
 *          código, solo se agregan agentes de desarrollo (400; regla del
 *          2026-10-27). Con `eligePerfil`, `profile` es obligatorio, lo deben
 *          admitir todos los escogidos y queda fijo en el proyecto.
 *   DELETE ?code=<agente>  retira (sus conversaciones quedan de solo lectura).
 *          Desde el 2026-11-10 se puede retirar el último: el proyecto sigue
 *          siendo de las personas.
 */
type Ctx = { params: Promise<{ id: string }> };

/** ¿Puede agregar o retirar asistentes? Dueño, o administración de SynerLink (miembro). */
async function puedeGestionar(user: ChatSessionUser, project: ProjectAccess): Promise<boolean> {
  if (capabilitiesFor(project.role).manageAgents) return true;
  return checkAdminPrivileges(user.email).catch(() => false);
}

async function candidatos(email: string, idProject: number, idCompany: number, profile: string) {
  const [actuales, conversaciones] = await Promise.all([
    prisma.chatProjectAgent.findMany({ where: { id_project: idProject }, select: { id_agent: true } }),
    prisma.chatConversation.count({ where: { id_project: idProject, kind: 'project' } }),
  ]);
  // El perfil se fija al crear y no cambia: cambiar el alcance de datos a mitad
  // de un hilo dejaría una sesión con contexto de otra empresa. Un proyecto SIN
  // asistentes y SIN conversaciones no tiene hilos: ahí sí se escoge el perfil.
  const eligePerfil = actuales.length === 0 && conversaciones === 0;
  const porEmpresa = await designableAgents(email, eligePerfil ? undefined : profile);
  const ya = new Set(actuales.map((a) => a.id_agent));
  return { lista: (porEmpresa.get(idCompany) ?? []).filter((a) => !ya.has(a.idAgent)), actuales: actuales.length, eligePerfil };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!(await puedeGestionar(guard.user, guard.project))) return forbidden('Solo el dueño del proyecto puede agregar asistentes.');
    const { lista, eligePerfil } = await candidatos(guard.user.email, guard.project.idProject, guard.project.idCompany, guard.project.profile);
    return jsonNoStore({ agents: lista, eligePerfil, profiles: eligePerfil ? [...PROJECT_PROFILES] : [] });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/agentes', error);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!(await puedeGestionar(guard.user, guard.project))) return forbidden('Solo el dueño del proyecto puede agregar asistentes.');

    const payload = await readJsonBody(request);
    const codigos = normalizeAgentCodes(payload?.agentCodes);
    if (!codigos.ok) return badRequest(codigos.error);

    const { lista, actuales, eligePerfil } = await candidatos(guard.user.email, guard.project.idProject, guard.project.idCompany, guard.project.profile);
    const porCodigo = new Map(lista.map((a) => [a.code.toLowerCase(), a]));
    if (codigos.value.some((c) => !porCodigo.has(c))) {
      return forbidden('Alguno de los asistentes no está disponible para usted en la empresa del proyecto con su perfil de conectores.');
    }
    // Primer asistente de un proyecto creado sin asistentes: escoge el perfil.
    let perfilNuevo: string | null = null;
    if (eligePerfil) {
      if (!isKnownProfile(payload?.profile)) return badRequest('Escoja el perfil de conectores del proyecto.');
      const perfil = payload.profile as string;
      if (codigos.value.some((c) => !porCodigo.get(c)!.profiles.includes(perfil))) {
        return badRequest('Alguno de los asistentes escogidos no admite ese perfil de conectores.');
      }
      perfilNuevo = perfil;
    }
    if (actuales + codigos.value.length > MAX_PROJECT_AGENTS) {
      return badRequest(`Un proyecto puede tener hasta ${MAX_PROJECT_AGENTS} asistentes.`);
    }
    const negocio = codigos.value.map((c) => porCodigo.get(c)!).filter((a) => !a.esDesarrollo);
    if (negocio.length > 0 && (await politicaGuardadaConCodigo(guard.project.idProject))) {
      return badRequest(
        `${mensajeSoloDesarrollo(negocio.map((a) => a.displayName))} Para agregarlo, primero deje los permisos del proyecto en «Ninguno».`
      );
    }
    const filas = codigos.value.map((c) => ({ id_project: guard.project.idProject, id_agent: porCodigo.get(c)!.idAgent, added_by: guard.user.id }));
    if (perfilNuevo === null) {
      await prisma.chatProjectAgent.createMany({ data: filas });
      return jsonNoStore({ added: filas.length }, { status: 201 });
    }
    // Perfil y asistentes en UNA transacción, y solo si el proyecto SIGUE sin
    // asistentes ni conversaciones (dos pestañas a la vez: gana la primera).
    const perfil = perfilNuevo;
    const hecho = await prisma.$transaction(async (tx) => {
      const r = await tx.chatProject.updateMany({
        where: { id_project: guard.project.idProject, agents: { none: {} }, conversations: { none: {} } },
        data: { profile: perfil },
      });
      if (r.count !== 1) return false;
      // «Agente con el que se creó»: el primero, si el proyecto nació sin asistente.
      await tx.chatProject.updateMany({ where: { id_project: guard.project.idProject, id_agent: null }, data: { id_agent: filas[0].id_agent } });
      await tx.chatProjectAgent.createMany({ data: filas });
      return true;
    });
    if (!hecho) return jsonNoStore({ error: 'El proyecto cambió mientras tanto. Vuelva a abrir «Agregar asistente».' }, { status: 409 });
    return jsonNoStore({ added: filas.length, profile: perfil }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/agentes', error);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!(await puedeGestionar(guard.user, guard.project))) return forbidden('Solo el dueño del proyecto puede retirar asistentes.');

    const code = (request.nextUrl.searchParams.get('code') ?? '').trim().toLowerCase();
    if (!code) return badRequest('Debe indicar el asistente (code).');
    const filas = await prisma.chatProjectAgent.findMany({
      where: { id_project: guard.project.idProject },
      select: { id_project_agent: true, agent: { select: { code: true } } },
    });
    const fila = filas.find((f) => f.agent.code.toLowerCase() === code);
    if (!fila) return jsonNoStore({ error: 'Ese asistente no está en el proyecto.' }, { status: 404 });
    await prisma.chatProjectAgent.delete({ where: { id_project_agent: fila.id_project_agent } });
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]/agentes', error);
  }
}
