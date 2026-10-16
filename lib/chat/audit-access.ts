import { prisma } from '../prisma';
import type { Prisma } from '../../app/generated/prisma';
import { checkAdminPrivileges } from '../access-control';
import { AUDIT_CONFIGURE_URL, AUDIT_CONVERSATIONS_URL } from './audit-constants';

/**
 * PERMISO DEL MÓDULO "Auditoría de agentes".
 *
 * Pedido de Nicolás (2026-09-10): "quiero que sea un módulo asignable en
 * synerlink solo para administración".
 *
 * Se resuelve con el MISMO esquema que el resto de SynerLink
 * (process -> subprocess -> subprocess_user_company -> company_user), igual
 * que lib/chat/access.ts: un subproceso propio que se otorga desde
 * Administración → Usuarios como cualquier otro módulo. Eso es lo que lo hace
 * "asignable" sin construir una pantalla nueva de permisos.
 *
 * DOS PUERTAS, A PROPÓSITO:
 *   1. tener el subproceso AUDIT_MODULE_URL en cualquier empresa, o
 *   2. tener privilegios de administrador (rol admin, o el subproceso de
 *      Administración → Usuarios).
 * La segunda existe para que la administración pueda entrar sin tener que
 * autoasignarse el permiso primero, que es el mismo criterio del organigrama
 * de la flota.
 *
 * ACOTADO POR EMPRESA (aprobado por Nicolás, 2026-10-06). Quien tenga el
 * subproceso sin ser administrador ve SOLO lo de los agentes de las empresas
 * donde se lo asignaron (subprocess_user_company → company_user.id_company,
 * y los agentes de esas empresas por agent_company). La administración sigue
 * viendo toda la flota: los cruces entre empresas se revisan desde ahí. Ver
 * getAuditScope; el filtro se aplica en cada endpoint, no en la pantalla.
 *
 * ⚠️ LO QUE ESTE MÓDULO MUESTRA es el texto de conversaciones ajenas: es
 * información confidencial y datos personales (Ley 1581 de 2012). La reja de
 * abajo es lo único que separa eso de cualquier usuario del portal.
 */

/** Subproceso que ES el permiso del módulo (marcador, no una página). */
export const AUDIT_MODULE_URL = '/process/chat/auditoria';

/** ¿Puede este usuario ver la auditoría de los agentes? */
export async function canAuditAgents(userEmail: string): Promise<boolean> {
  const email = userEmail.trim();
  if (!email) return false;

  const asignado = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: AUDIT_MODULE_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  if (asignado) return true;

  return checkAdminPrivileges(email);
}

export { AUDIT_CONFIGURE_URL, AUDIT_CONVERSATIONS_URL };

/**
 * ALCANCE de la auditoría para un usuario.
 *   - { all: true }: administración (misma verificación que canAuditAgents):
 *     toda la flota, incluidos los hilos entre personas.
 *   - { all: false, companyIds, agentIds }: las empresas donde tiene el
 *     subproceso AUDIT_MODULE_URL y los agentes asignados a ellas. Sin
 *     empresas, listas vacías (no ve nada).
 */
export type AuditScope =
  | { all: true }
  | { all: false; companyIds: number[]; agentIds: number[] };

const SIN_ALCANCE: AuditScope = { all: false, companyIds: [], agentIds: [] };

/** Empresas donde el usuario tiene asignado ese subproceso. */
async function empresasConSubproceso(email: string, url: string): Promise<number[]> {
  const filas = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: url },
    },
    select: { companyUser: { select: { id_company: true } } },
  });
  return [...new Set(filas.map((f) => f.companyUser.id_company))].sort((a, b) => a - b);
}

/** Alcance limitado a esas empresas, con los agentes asignados a ellas. */
async function alcanceDeEmpresas(companyIds: number[]): Promise<AuditScope> {
  if (companyIds.length === 0) return SIN_ALCANCE;
  const filas = await prisma.agentCompany.findMany({
    where: { id_company: { in: companyIds } },
    select: { id_agent: true },
  });
  const agentIds = [...new Set(filas.map((f) => f.id_agent))].sort((a, b) => a - b);
  return { all: false, companyIds, agentIds };
}

export async function getAuditScope(userEmail: string): Promise<AuditScope> {
  const email = userEmail.trim();
  if (!email) return SIN_ALCANCE;
  if (await checkAdminPrivileges(email)) return { all: true };
  return alcanceDeEmpresas(await empresasConSubproceso(email, AUDIT_MODULE_URL));
}

/**
 * Filtro de conversaciones dentro del alcance. Para un alcance limitado:
 * hilos directos con agentes del alcance y grupos de empresas del alcance.
 * Los hilos entre personas ('people') quedan fuera: no son de un agente.
 */
export function conversationScopeWhere(scope: AuditScope): Prisma.ChatConversationWhereInput {
  if (scope.all) return {};
  return {
    OR: [
      { kind: 'direct', id_agent: { in: scope.agentIds } },
      { kind: 'group', id_company: { in: scope.companyIds } },
    ],
  };
}

/** Lo mismo que conversationScopeWhere, sobre una conversación ya leída. */
export function conversationInScope(
  scope: AuditScope,
  conv: { kind: string; id_agent: number; id_company: number | null }
): boolean {
  if (scope.all) return true;
  if (conv.kind === 'direct') return scope.agentIds.includes(conv.id_agent);
  if (conv.kind === 'group') return conv.id_company !== null && scope.companyIds.includes(conv.id_company);
  return false;
}

/** ¿El agente está dentro del alcance? */
export function agentInScope(scope: AuditScope, idAgent: number): boolean {
  return scope.all || scope.agentIds.includes(idAgent);
}

/** ¿El agente con ese código está dentro del alcance? (hoja de vida). */
export async function agentCodeInScope(scope: AuditScope, code: string): Promise<boolean> {
  if (scope.all) return true;
  const agente = await prisma.agent.findUnique({ where: { code }, select: { id_agent: true } });
  return agente !== null && scope.agentIds.includes(agente.id_agent);
}

/**
 * ¿Dónde puede este usuario leer el TEXTO de las conversaciones en la
 * auditoría? null = en ninguna parte.
 *
 * Decisión de Nicolás (2026-10-02): la vista general muestra solo agentes y
 * métricas (persona, fecha, IP, consumo); el texto queda detrás de un permiso
 * aparte, el subproceso AUDIT_CONVERSATIONS_URL.
 *
 * SIN SEGUNDA PUERTA, A PROPÓSITO: ser administrador NO alcanza. El texto es
 * información confidencial y datos personales (Ley 1581 de 2012); quien lo lea
 * debe tener el permiso asignado con nombre propio. El permiso de
 * conversaciones no abre el módulo por sí solo: se recibe el alcance de la
 * auditoría (getAuditScope) y se recorta con él.
 *
 * POR EMPRESA (2026-10-06): fuera de la administración, el texto se ve solo
 * en las empresas donde el usuario tiene LOS DOS permisos (auditoría y
 * conversaciones). La administración con el permiso de conversaciones lo ve
 * en todo su alcance, como antes.
 */
export async function getAuditTextScope(
  userEmail: string,
  scope: AuditScope
): Promise<AuditScope | null> {
  const email = userEmail.trim();
  if (!email) return null;

  const empresas = await empresasConSubproceso(email, AUDIT_CONVERSATIONS_URL);
  if (empresas.length === 0) return null;
  if (scope.all) return scope;

  const ambas = empresas.filter((id) => scope.companyIds.includes(id));
  if (ambas.length === 0) return null;
  return alcanceDeEmpresas(ambas);
}

/**
 * ¿Puede este usuario CONFIGURAR la hoja de vida de los agentes (propósito y
 * dueño)? Hoja de vida, F2 (2026-10-02).
 *
 * Exige el subproceso AUDIT_CONFIGURE_URL con nombre propio (ser administrador
 * NO alcanza, mismo criterio que el permiso de conversaciones) y, además,
 * poder auditar: el permiso de configurar no abre el módulo por sí solo.
 */
export async function canConfigureAgents(userEmail: string): Promise<boolean> {
  const email = userEmail.trim();
  if (!email) return false;

  const asignado = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: AUDIT_CONFIGURE_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  if (!asignado) return false;
  return canAuditAgents(email);
}
