import { prisma } from '../prisma';
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
 * NO ESTÁ ACOTADO POR EMPRESA — y esa es una decisión, no un olvido. La
 * auditoría se mira sobre TODA la flota: un agente de GSS conversa con gente
 * de varias empresas, y una vista partida por empresa dejaría fuera justamente
 * los cruces que se quieren revisar. Por eso el permiso se otorga a muy poca
 * gente; el alcance del dato es el grupo completo.
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
 * ¿Puede este usuario leer el TEXTO de las conversaciones en la auditoría?
 *
 * Decisión de Nicolás (2026-10-02): la vista general muestra solo agentes y
 * métricas (persona, fecha, IP, consumo); el texto queda detrás de un permiso
 * aparte, el subproceso AUDIT_CONVERSATIONS_URL.
 *
 * SIN SEGUNDA PUERTA, A PROPÓSITO: ser administrador NO alcanza. El texto es
 * información confidencial y datos personales (Ley 1581 de 2012); quien lo lea
 * debe tener el permiso asignado con nombre propio. Se exige además poder
 * auditar (canAuditAgents): el permiso de conversaciones no abre el módulo
 * por sí solo.
 */
export async function canViewAuditConversations(userEmail: string): Promise<boolean> {
  const email = userEmail.trim();
  if (!email) return false;

  const asignado = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: AUDIT_CONVERSATIONS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return Boolean(asignado);
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
