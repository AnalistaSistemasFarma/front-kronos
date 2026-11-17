import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../../../lib/access-control';
import {
  badRequest,
  forbidden,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';
import { columnaNoExiste } from '../../../../../../lib/proyectos/agentes-desarrollo';

/**
 * MARCA «AGENTE DE DESARROLLO» de un asistente (agent.es_desarrollo).
 *
 *   GET   /api/chat/agents/<code>/desarrollo  → { esDesarrollo }
 *   PATCH /api/chat/agents/<code>/desarrollo  { esDesarrollo: boolean } → la cambia
 *
 * Pedido de Nicolás Rivera (2026-11-11): marcar desde la interfaz si un agente
 * es de desarrollo; hasta hoy solo se podía por base de datos. La marca decide
 * si a un proyecto se le puede dar nivel de código y repositorios
 * (lib/proyectos/agentes-desarrollo-rules.ts).
 *
 * QUIÉN: solo la administración de SynerLink (checkAdminPrivileges), la misma
 * reja que cambiar la foto del asistente. Las dos operaciones la validan en el
 * servidor: esconder el interruptor no protege nada.
 *
 * REGISTRO: el módulo de agentes no tiene tabla de bitácora propia (la de
 * permisos de proyectos solo admite proyecto/catálogo por CHECK), así que el
 * cambio queda en el log del servidor con quién, cuándo, antes y después.
 */

/** El administrador en sesión, o la respuesta de rechazo (401/403). */
async function soloAdmin(): Promise<{ email: string } | Response> {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!(await checkAdminPrivileges(user.email))) {
    return forbidden('Solo un administrador puede marcar agentes de desarrollo.');
  }
  return user;
}

const SIN_COLUMNA = 'La marca de agente de desarrollo todavía no está disponible en esta base.';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  try {
    const auth = await soloAdmin();
    if (auth instanceof Response) return auth;

    const { code } = await params;
    const fila = await prisma.agent.findUnique({ where: { code }, select: { es_desarrollo: true } });
    if (!fila) return NextResponse.json({ error: 'Ese asistente no existe.' }, { status: 404 });
    return jsonNoStore({ esDesarrollo: fila.es_desarrollo === true });
  } catch (error) {
    if (columnaNoExiste(error)) return NextResponse.json({ error: SIN_COLUMNA }, { status: 409 });
    return serverError('GET /api/chat/agents/[code]/desarrollo', error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  try {
    const auth = await soloAdmin();
    if (auth instanceof Response) return auth;

    const body = (await request.json().catch(() => null)) as { esDesarrollo?: unknown } | null;
    if (typeof body?.esDesarrollo !== 'boolean') return badRequest('Falta esDesarrollo (true o false).');
    const esDesarrollo = body.esDesarrollo;

    const { code } = await params;
    const antes = await prisma.agent.findUnique({
      where: { code },
      select: { id_agent: true, display_name: true, es_desarrollo: true },
    });
    if (!antes) return NextResponse.json({ error: 'Ese asistente no existe.' }, { status: 404 });

    if (antes.es_desarrollo !== esDesarrollo) {
      await prisma.agent.update({ where: { id_agent: antes.id_agent }, data: { es_desarrollo: esDesarrollo } });
      console.info(
        '[agentes] marca es_desarrollo cambiada',
        JSON.stringify({
          code,
          idAgent: antes.id_agent,
          antes: antes.es_desarrollo,
          despues: esDesarrollo,
          por: auth.email,
          cuando: new Date().toISOString(),
        })
      );
    }
    return jsonNoStore({ ok: true, esDesarrollo });
  } catch (error) {
    if (columnaNoExiste(error)) return NextResponse.json({ error: SIN_COLUMNA }, { status: 409 });
    return serverError('PATCH /api/chat/agents/[code]/desarrollo', error);
  }
}
