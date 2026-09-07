/**
 * Autenticación de la API del AGENTE (los bots de la flota) — parte que toca
 * la base de datos. La criptografía y la validación de la configuración de
 * llaves están aparte, en lib/chat/agent-keys.ts (puras y con pruebas).
 *
 * -------------------------------------------------------------------------
 * POR QUÉ REST AQUÍ Y NO UNA TOOL DEL SERVIDOR MCP
 * -------------------------------------------------------------------------
 * El repo ya tiene un servidor MCP (mcp/) con este mismo esquema de llave. Se
 * evaluó colgar el chat de ahí y se decidió que NO. Razones, mirando el código
 * real:
 *
 *   1. La bandeja necesita LONG-POLL. mcp/src/server.ts monta el transporte
 *      Streamable HTTP en modo stateless: crea un McpServer y un transport
 *      NUEVOS por petición y los cierra en `res.on('close')`. Una tool que se
 *      quede 30 s esperando trabajo sostiene ese par abierto y choca con los
 *      timeouts por tool del cliente MCP. Un GET que espera es exactamente lo
 *      que HTTP sabe hacer, y lo puede llamar un `curl` sin cliente MCP.
 *   2. El MCP es de LECTURA por diseño. mcp/src/readonly.ts impone
 *      `assertReadOnlySql` sobre SQL crudo y la única ruta de escritura
 *      (mcp/src/write.ts) está acotada a propósito a categorización. Meter ahí
 *      las escrituras del chat obligaría a ensanchar ese candado.
 *   3. El MCP habla SQL crudo contra su propio pool (mcp/src/db.ts). El chat ya
 *      tiene sus modelos en Prisma y su lógica de permisos en
 *      lib/chat/access.ts. Reimplementar la propiedad del hilo en SQL a mano,
 *      en otro proceso, es exactamente cómo se abren los IDOR.
 *   4. Despliegue: el MCP es otro proceso PM2 en otro puerto. Con REST dentro
 *      de la app, el chat es un solo artefacto, un solo despliegue y una sola
 *      fuente de verdad.
 *   5. Alcance del daño: las llaves del MCP leen toda la base de Kronos para un
 *      conjunto de empresas. Estas llaves solo tocan las conversaciones de SU
 *      agente. Espacios de llaves separados = consecuencias más pequeñas si una
 *      se filtra.
 *
 * -------------------------------------------------------------------------
 * REGLA DE ORO
 * -------------------------------------------------------------------------
 * La LLAVE determina de qué agente se trata. El payload NUNCA lleva el agente:
 * un bot no puede escribir como otro bot ni aunque lo pida. Es el mismo
 * criterio con el que la identidad del proveedor sale de la sesión y no del
 * cliente (lib/proveedor/isolation.ts).
 */
import { prisma } from '../prisma';
import { extractBearer, loadAgentKeys, matchAgentKey } from './agent-keys';

export type { ChatAgentKeyEntry } from './agent-keys';

/** Identidad resuelta de un agente autenticado. */
export interface ChatAgentIdentity {
  idAgent: number;
  code: string;
  displayName: string;
  /**
   * Ruta del avatar dentro de /public ('/agents/orus.jpg'), o null si el
   * agente no tiene foto. Se usa como icono de la notificación push: ver
   * app/api/chat/agent/messages/route.ts.
   */
  avatarUrl: string | null;
  /** Etiqueta de la llave usada, para logs. Nunca es la llave. */
  keyLabel: string;
}

/**
 * Autentica una petición de la API del agente y resuelve su identidad contra la
 * tabla `agent`.
 *
 * Devuelve null (=> 401 sin pistas del motivo) si: no hay Bearer, la llave no
 * casa, no hay llaves configuradas, el `code` de la llave no existe en la base,
 * o el agente está inactivo.
 */
export async function authenticateAgent(request: Request): Promise<ChatAgentIdentity | null> {
  const token = extractBearer(request.headers.get('authorization'));
  const entry = matchAgentKey(token, loadAgentKeys());
  if (!entry) return null;

  const agent = await prisma.agent.findFirst({
    where: { code: entry.agent, is_active: true },
    select: { id_agent: true, code: true, display_name: true, avatar_url: true },
  });
  if (!agent) {
    console.error(
      `[chat/agent-auth] la llave "${entry.label}" apunta al agente "${entry.agent}", que no existe o está inactivo.`
    );
    return null;
  }

  return {
    idAgent: agent.id_agent,
    code: agent.code,
    displayName: agent.display_name,
    avatarUrl: agent.avatar_url ?? null,
    keyLabel: entry.label ?? entry.agent,
  };
}

/**
 * Verificación de PROPIEDAD del lado del agente (anti-IDOR; espejo de
 * assertConversationOwnership del lado del usuario): la conversación debe
 * pertenecer a ESTE agente. El id_agent sale de la llave, nunca del payload.
 *
 * Devuelve null si la conversación no existe o es de otro agente.
 */
export async function assertAgentConversation(
  idAgent: number,
  conversationId: unknown
): Promise<{ id: number; idUser: string } | null> {
  if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId <= 0) {
    return null;
  }

  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, id_agent: idAgent },
    select: { id: true, id_user: true },
  });
  if (!conversation) return null;

  return { id: conversation.id, idUser: conversation.id_user };
}
