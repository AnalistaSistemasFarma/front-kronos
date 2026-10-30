import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { getChatAccess } from '../../../../../../lib/chat/access';
import { agentCodeInScope, canConfigureAgents, getAuditScope } from '../../../../../../lib/chat/audit-access';
import { readClientOrigin } from '../../../../../../lib/chat/client-origin';
import {
  ContextoNoDisponible,
  OrdenActiva,
  agenteOcupado,
  crearOrdenLimpiar,
  leerContexto,
  ultimaOrden,
} from '../../../../../../lib/chat/agent-context-store';
import {
  NO_STORE,
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * CONTEXTO DE LA SESIÓN DEL AGENTE en el widget de consumo del chat (2026-10-29).
 *
 * Pedido de Nicolás Rivera: «mostrar cuán lleno está el contexto de la sesión del
 * agente y poder limpiarlo». Limpiar es SOLO para administradores: el permiso
 * «Auditoría de agentes · Configurar» (canConfigureAgents) y el agente dentro de
 * sus empresas auditables (getAuditScope). Meta futura: un usuario = un agente,
 * con permisos sobre su agente.
 *
 *   GET  /api/chat/agents/<code>/contexto?conversacion=<id>
 *        → { contexto: ContextoAgenteDto | null, puedeLimpiar, ocupado, orden: OrdenDto | null }
 *   POST /api/chat/agents/<code>/contexto   { "conversacion": 12, "confirmar": true }
 *        → 202 { orden }   (403 sin permiso, 409 si está trabajando o ya hay una orden)
 *
 * Ver el contexto: quien ya ve el botón de consumo (acceso al agente en el chat).
 * Sin acceso, 404 —no 403— para no revelar qué agentes existen. La conversación,
 * si viene, debe ser un hilo directo de ESE usuario con ESE agente.
 *
 * La orden NO limpia nada aquí: queda registrada (quién, cuándo, IP, navegador)
 * y la ejecuta el ejecutor en la máquina del bot, que reporta el resultado.
 */

type Params = { params: Promise<{ code: string }> };

type Resuelto =
  | { ok: false; res: NextResponse }
  | { ok: true; user: { id: string; email: string }; agente: { idAgent: number; code: string; displayName: string } };

async function resolver(code: string): Promise<Resuelto> {
  const user = await resolveSessionUser();
  if (!user) return { ok: false, res: unauthorized() };
  const access = await getChatAccess(user.email);
  const agente = access.canUseChat ? access.agents.find((a) => a.code === code) : undefined;
  if (!agente) {
    return { ok: false, res: NextResponse.json({ error: 'Agente no encontrado.' }, { status: 404, headers: NO_STORE }) };
  }
  return { ok: true, user, agente };
}

/** Id de un hilo directo del usuario con el agente, o null si no vino / no es suyo. */
async function conversacionPropia(raw: unknown, idUser: string, idAgent: number): Promise<number | null> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const c = await prisma.chatConversation.findFirst({
    where: { id, id_agent: idAgent, id_user: idUser, kind: 'direct' },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function puedeLimpiar(email: string, code: string): Promise<boolean> {
  try {
    if (!(await canConfigureAgents(email))) return false;
    return agentCodeInScope(await getAuditScope(email), code.toLowerCase());
  } catch (error) {
    console.error('[chat/agent-context] no se pudo resolver el permiso de limpiar:', error);
    return false;
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { code } = await params;
    const r = await resolver(code);
    if (!r.ok) return r.res;
    const { user, agente } = r;

    const idConversation = await conversacionPropia(request.nextUrl.searchParams.get('conversacion'), user.id, agente.idAgent);
    const contexto = await leerContexto(agente.idAgent, idConversation);
    const admin = await puedeLimpiar(user.email, agente.code);
    // El estado de la orden y «trabajando» solo le sirven a quien puede limpiar.
    const [orden, ocupado] = admin
      ? await Promise.all([ultimaOrden(agente.idAgent), agenteOcupado(agente.idAgent)])
      : [null, false];
    return jsonNoStore({ contexto, puedeLimpiar: admin && Boolean(contexto), ocupado, orden });
  } catch (error) {
    return serverError('GET /api/chat/agents/[code]/contexto', error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { code } = await params;
    const r = await resolver(code);
    if (!r.ok) return r.res;
    const { user, agente } = r;

    if (!(await puedeLimpiar(user.email, agente.code))) {
      return jsonNoStore(
        { error: 'Limpiar el contexto requiere el permiso «Auditoría de agentes · Configurar» sobre este agente.' },
        { status: 403 }
      );
    }
    const body = await readJsonBody(request);
    if (!body || body.confirmar !== true) return badRequest('Falta la confirmación («confirmar»: true).');

    const idConversation = await conversacionPropia(body.conversacion, user.id, agente.idAgent);
    const contexto = await leerContexto(agente.idAgent, idConversation);
    if (!contexto) {
      return jsonNoStore(
        { error: 'Este agente todavía no reporta su contexto, así que no se puede limpiar desde aquí.' },
        { status: 409 }
      );
    }
    if (await agenteOcupado(agente.idAgent)) {
      return jsonNoStore(
        { error: `${agente.displayName} está trabajando en este momento. Espere a que termine e intente de nuevo.` },
        { status: 409 }
      );
    }

    const origen = readClientOrigin(request);
    const orden = await crearOrdenLimpiar({
      idAgent: agente.idAgent,
      contexto,
      idConversation: contexto.alcance === 'conversacion' ? idConversation : null,
      requestedBy: user.email,
      ip: origen.clientIp,
      userAgent: origen.userAgent,
    });
    return jsonNoStore({ orden }, { status: 202 });
  } catch (error) {
    if (error instanceof OrdenActiva) {
      return jsonNoStore({ error: error.message, orden: error.orden }, { status: 409 });
    }
    if (error instanceof ContextoNoDisponible) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/agents/[code]/contexto', error);
  }
}
