import { prisma } from '../prisma';

/**
 * Resolución de permisos del módulo "Asistentes IA" (chat de agentes).
 *
 * Mismo patrón que lib/document-management/access.ts y lib/health-records/
 * access.ts: se reusa el esquema existente
 * (process -> subprocess -> subprocess_user_company -> company_user) en vez
 * de crear una tabla de permisos propia.
 *
 *   - Nivel 1 (módulo):  el usuario tiene el subproceso CHAT_MODULE_URL en
 *                        alguna empresa -> ve el módulo.
 *   - Nivel 2 (agente):  cada agente tiene SU PROPIO subproceso
 *                        (agent.id_subprocess, p.ej. '/process/chat/orus').
 *                        Tener ese subproceso en la empresa X = puede hablar
 *                        con ese agente en la empresa X.
 *   - Nivel 3 (empresa): cada fila cuelga de un company_user, así que el
 *                        permiso siempre está acotado a UNA empresa.
 *
 * -------------------------------------------------------------------------
 * DECISIÓN DE DISEÑO — por qué NO existe `user_agent_access`
 * -------------------------------------------------------------------------
 * El diseño original contemplaba una tabla `user_agent_access`
 * (id_user, id_agent, granted_by, granted_at) además del subproceso por
 * agente. Las dos cosas representan EXACTAMENTE el mismo permiso, así que
 * había que escoger una sola fuente de verdad. Se escogió el SUBPROCESO y la
 * tabla NO se creó. Razones:
 *
 *   1. Nicolás pidió que el permiso se asigne desde
 *      /process/administration/users "como cualquier otro módulo". Esa
 *      pantalla lee /api/subprocesses y escribe en subprocess_user_company;
 *      con el subproceso, el módulo aparece ahí solo, sin una línea de UI
 *      nueva. Con `user_agent_access` habría que construir otra pantalla.
 *   2. `user_agent_access` no tiene empresa. El permiso de SynerLink SÍ es
 *      por empresa (la tripleta usuario/empresa/subproceso). Una tabla plana
 *      usuario->agente no puede expresar "puede hablar con Orus en GSS pero
 *      no en Ryan", y conviviendo con el subproceso daría dos respuestas
 *      distintas a la misma pregunta.
 *   3. La auditoría que justificaba la tabla (quién otorgó y cuándo) ya
 *      existe: app/api/users/[id]/subprocesses/route.ts escribe en
 *      `user_audit_log` la acción UPDATE_SUBPROCESSES con performed_by y
 *      created_at en cada cambio de asignación. No hay nada que ganar.
 *   4. Dos fuentes de verdad de un permiso no son redundancia inofensiva:
 *      basta con que un endpoint consulte la equivocada para abrir un hueco.
 *
 * Lo que SÍ existe es `agent_company`, que es OTRA cosa: la AGRUPACIÓN (las
 * "carpetas" de la interfaz), no el permiso. Un usuario ve un agente en una
 * empresa solo si se cumplen LAS DOS condiciones:
 *   (a) el agente pertenece a esa empresa   (agent_company), y
 *   (b) el usuario tiene el subproceso del agente en esa misma empresa
 *       (subprocess_user_company).
 */

/** Subproceso de acceso al módulo (marcador de permiso, no una página). */
export const CHAT_MODULE_URL = '/process/chat';

/** Acceso de un usuario a UN agente dentro de UNA empresa. */
export interface ChatAgentCompanyAccess {
  idCompany: number;
  companyName: string;
  /** true si el agente tiene esta empresa marcada como principal. */
  isPrimary: boolean;
}

/** Un agente visible para el usuario, con las empresas donde puede usarlo. */
export interface ChatAgentAccess {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  description: string | null;
  sortOrder: number;
  /** Empresas donde el usuario tiene permiso sobre ESTE agente. */
  companies: ChatAgentCompanyAccess[];
}

/** Resultado completo de la resolución de permisos del módulo. */
export interface ChatAccess {
  /** El usuario tiene el subproceso del módulo en alguna empresa. */
  canUseChat: boolean;
  /** Empresas donde el usuario tiene el subproceso del módulo. */
  companies: ChatAgentCompanyAccess[];
  /** Agentes que puede ver, ya filtrados por permiso y por empresa. */
  agents: ChatAgentAccess[];
}

/**
 * Devuelve qué agentes puede ver el usuario y en qué empresas.
 *
 * Una sola consulta a subprocess_user_company trae tanto el subproceso del
 * módulo como los subprocesos-permiso de cada agente; después se cruza con
 * agent_company para no mostrar un agente en una empresa a la que no
 * pertenece.
 */
export async function getChatAccess(userEmail: string): Promise<ChatAccess> {
  // Agentes activos que ya tienen su subproceso-permiso creado. Un agente sin
  // id_subprocess es invisible para todos: no hay forma de otorgarlo.
  const agents = await prisma.agent.findMany({
    where: { is_active: true, id_subprocess: { not: null } },
    include: {
      companies: { include: { company: true } },
    },
    orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
  });

  const agentBySubprocessId = new Map(agents.map((a) => [a.id_subprocess as number, a]));

  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      OR: [
        { subprocess: { subprocess_url: CHAT_MODULE_URL } },
        { id_subprocess: { in: [...agentBySubprocessId.keys()] } },
      ],
    },
    include: {
      subprocess: true,
      companyUser: { include: { company: true } },
    },
  });

  // Empresas donde el usuario tiene el acceso al módulo.
  const moduleCompanies = new Map<number, ChatAgentCompanyAccess>();
  // idAgent -> Set<idCompany> donde el usuario tiene el permiso del agente.
  const grantsByAgent = new Map<number, Set<number>>();

  for (const row of rows) {
    const company = row.companyUser.company;

    if (row.subprocess.subprocess_url === CHAT_MODULE_URL) {
      if (!moduleCompanies.has(company.id_company)) {
        moduleCompanies.set(company.id_company, {
          idCompany: company.id_company,
          companyName: company.company,
          isPrimary: false,
        });
      }
      continue;
    }

    const agent = agentBySubprocessId.get(row.id_subprocess);
    if (!agent) continue;

    let set = grantsByAgent.get(agent.id_agent);
    if (!set) {
      set = new Set<number>();
      grantsByAgent.set(agent.id_agent, set);
    }
    set.add(company.id_company);
  }

  const visibleAgents: ChatAgentAccess[] = [];

  for (const agent of agents) {
    const granted = grantsByAgent.get(agent.id_agent);
    if (!granted || granted.size === 0) continue;

    // El agente solo se muestra en las empresas a las que PERTENECE y en las
    // que además el usuario tiene el permiso.
    const companies = agent.companies
      .filter((ac) => granted.has(ac.id_company))
      .map((ac) => ({
        idCompany: ac.id_company,
        companyName: ac.company.company,
        isPrimary: ac.is_primary,
      }));

    if (companies.length === 0) continue;

    visibleAgents.push({
      idAgent: agent.id_agent,
      code: agent.code,
      displayName: agent.display_name,
      handle: agent.handle,
      avatarUrl: agent.avatar_url,
      description: agent.description,
      sortOrder: agent.sort_order,
      companies,
    });
  }

  return {
    canUseChat: moduleCompanies.size > 0,
    companies: [...moduleCompanies.values()],
    agents: visibleAgents,
  };
}

/**
 * Valida que el usuario pueda hablar con UN agente concreto. Devuelve las
 * empresas donde puede hacerlo, o null si no tiene permiso.
 *
 * Úsela en TODO endpoint que reciba un id_agent del cliente: no basta con que
 * el usuario tenga acceso al módulo.
 */
export async function getChatAgentAccess(
  userEmail: string,
  agentId: number
): Promise<ChatAgentAccess | null> {
  const access = await getChatAccess(userEmail);
  if (!access.canUseChat) return null;
  return access.agents.find((a) => a.idAgent === agentId) ?? null;
}

/**
 * Verificación de PROPIEDAD de una conversación DIRECTA (anti-IDOR). Nunca
 * confíe en un id_conversation que llegue del cliente sin pasar por aquí:
 * valida a la vez que el hilo es del usuario de la sesión Y que el usuario
 * todavía tiene permiso sobre el agente del hilo (un permiso revocado cierra
 * el acceso a las conversaciones viejas).
 *
 * ⚠️ ANCLADA A `kind = 'direct'` A PROPÓSITO. En un GRUPO, `id_user` es solo
 * "quien lo creó": si esta función no filtrara por `kind`, el creador de un
 * grupo entraría por el camino del hilo directo y se saltaría la verificación
 * de participantes. La puerta de los grupos es `assertGroupAccess`
 * (lib/chat/groups.ts).
 *
 * Devuelve null si la conversación no existe, no es un hilo directo, no es
 * suya, o perdió el permiso.
 */
export async function assertConversationOwnership(
  userEmail: string,
  conversationId: number
): Promise<{ id: number; idAgent: number } | null> {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;

  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      kind: 'direct',
      // El filtro por correo de la sesión es lo que ata el hilo al dueño.
      user: { email: userEmail },
    },
    select: { id: true, id_agent: true },
  });

  if (!conversation) return null;

  const agentAccess = await getChatAgentAccess(userEmail, conversation.id_agent);
  if (!agentAccess) return null;

  return { id: conversation.id, idAgent: conversation.id_agent };
}
