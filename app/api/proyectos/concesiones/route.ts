import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { readClientOrigin } from '../../../../lib/chat/client-origin';
import { projectModuleCompanies, resolveProjectForUser } from '../../../../lib/chat/projects';
import { errorDeProyecto } from '../../../../lib/proyectos/acciones';
import { asistentesDe, concesionesVigentes, crearConcesionProyectos, revocarConcesionProyectos } from '../../../../lib/proyectos/concesion';

export const dynamic = 'force-dynamic';

/**
 * ACCESO DE UN ASISTENTE a los proyectos de la persona (concesión de 24 h para
 * kronos-mcp; lib/proyectos/concesion.ts).
 *
 *   GET    ?idProject=   concesiones VIGENTES propias (las que cubren ese proyecto) y los
 *          asistentes que la persona tiene asignados (en la empresa del proyecto, si viene).
 *   POST   { idAgent, idProject?: number | null, pedido? }  da el acceso: un
 *          proyecto (debe pasar su puerta) o todos los suyos (null).
 *   DELETE ?id=          revoca una concesión propia.
 *
 * Solo con sesión y con el permiso del módulo «Proyectos». Lo de otra persona: 404.
 */
async function sesionConModulo() {
  const user = await resolveSessionUser();
  if (!user) return null;
  const empresas = await projectModuleCompanies(user.id);
  return empresas.length > 0 ? user : null;
}

function idDe(v: string | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return String(n) === v.trim() && n > 0 ? n : -1;
}

export async function GET(request: NextRequest) {
  try {
    const user = await sesionConModulo();
    if (!user) return unauthorized();
    const idProject = idDe(request.nextUrl.searchParams.get('idProject'));
    if (idProject === -1) return badRequest('Id de proyecto inválido.');
    let idCompany: number | null = null;
    if (idProject) {
      const project = await resolveProjectForUser(user, idProject);
      if (!project) return jsonNoStore({ error: 'Proyecto no encontrado.' }, { status: 404 });
      idCompany = project.idCompany;
    }
    const [concesiones, agentes] = await Promise.all([concesionesVigentes(user, idProject ?? undefined), asistentesDe(user.email, idCompany)]);
    return jsonNoStore({ concesiones, agentes });
  } catch (error) {
    return serverError('GET /api/proyectos/concesiones', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await sesionConModulo();
    if (!user) return unauthorized();
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    let project = null;
    if (payload.idProject !== undefined && payload.idProject !== null) {
      project = await resolveProjectForUser(user, payload.idProject);
      if (!project) return jsonNoStore({ error: 'Proyecto no encontrado.' }, { status: 404 });
    }
    const origen = readClientOrigin(request);
    const r = await crearConcesionProyectos(user, { idAgent: payload.idAgent, project, pedido: payload.pedido, ip: origen.clientIp, userAgent: origen.userAgent });
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/concesiones', error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await sesionConModulo();
    if (!user) return unauthorized();
    await revocarConcesionProyectos(user, idDe(request.nextUrl.searchParams.get('id')) ?? -1);
    return jsonNoStore({ revoked: true });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/concesiones', error);
  }
}
