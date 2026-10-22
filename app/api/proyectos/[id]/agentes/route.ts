import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { designableAgents } from '../../../../../lib/chat/projects';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { capabilitiesFor, MAX_PROJECT_AGENTS, normalizeAgentCodes } from '../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * AGENTES designados en un proyecto. Solo el DUEÑO.
 *
 *   GET    agentes que puede agregar: los que el dueño tiene asignados en la
 *          empresa del proyecto, con proyectos habilitados y con el perfil.
 *   POST   { agentCodes: [...] }  designa.
 *   DELETE ?code=<agente>  retira (sus conversaciones quedan de solo lectura;
 *          el último agente no se puede retirar).
 */
type Ctx = { params: Promise<{ id: string }> };

async function candidatos(email: string, idProject: number, idCompany: number, profile: string) {
  const [porEmpresa, actuales] = await Promise.all([
    designableAgents(email, profile),
    prisma.chatProjectAgent.findMany({ where: { id_project: idProject }, select: { id_agent: true } }),
  ]);
  const ya = new Set(actuales.map((a) => a.id_agent));
  return { lista: (porEmpresa.get(idCompany) ?? []).filter((a) => !ya.has(a.idAgent)), actuales: actuales.length };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageAgents) return forbidden('Solo el dueño del proyecto puede agregar asistentes.');
    const { lista } = await candidatos(guard.user.email, guard.project.idProject, guard.project.idCompany, guard.project.profile);
    return jsonNoStore({ agents: lista });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/agentes', error);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageAgents) return forbidden('Solo el dueño del proyecto puede agregar asistentes.');

    const payload = await readJsonBody(request);
    const codigos = normalizeAgentCodes(payload?.agentCodes);
    if (!codigos.ok) return badRequest(codigos.error);

    const { lista, actuales } = await candidatos(guard.user.email, guard.project.idProject, guard.project.idCompany, guard.project.profile);
    const porCodigo = new Map(lista.map((a) => [a.code.toLowerCase(), a]));
    if (codigos.value.some((c) => !porCodigo.has(c))) {
      return forbidden('Alguno de los asistentes no está disponible para usted en la empresa del proyecto con su perfil de conectores.');
    }
    if (actuales + codigos.value.length > MAX_PROJECT_AGENTS) {
      return badRequest(`Un proyecto puede tener hasta ${MAX_PROJECT_AGENTS} asistentes.`);
    }
    await prisma.chatProjectAgent.createMany({
      data: codigos.value.map((c) => ({ id_project: guard.project.idProject, id_agent: porCodigo.get(c)!.idAgent, added_by: guard.user.id })),
    });
    return jsonNoStore({ added: codigos.value.length }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/agentes', error);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageAgents) return forbidden('Solo el dueño del proyecto puede retirar asistentes.');

    const code = (request.nextUrl.searchParams.get('code') ?? '').trim().toLowerCase();
    if (!code) return badRequest('Debe indicar el asistente (code).');
    const filas = await prisma.chatProjectAgent.findMany({
      where: { id_project: guard.project.idProject },
      select: { id_project_agent: true, agent: { select: { code: true } } },
    });
    const fila = filas.find((f) => f.agent.code.toLowerCase() === code);
    if (!fila) return jsonNoStore({ error: 'Ese asistente no está en el proyecto.' }, { status: 404 });
    if (filas.length <= 1) return forbidden('El proyecto debe conservar al menos un asistente.');

    await prisma.chatProjectAgent.delete({ where: { id_project_agent: fila.id_project_agent } });
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]/agentes', error);
  }
}
