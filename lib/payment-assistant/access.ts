import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Asistente de Pagos" (multiempresa).
 *
 * Reutiliza el esquema de permisos existente (process -> subprocess ->
 * subprocess_user_company), igual que el modulo de Registros Sanitarios:
 *
 *   - Nivel modulo:  el usuario tiene al menos una fila para el subproceso del
 *                    Asistente de Pagos -> ve el modulo en el menu.
 *   - Nivel empresa: cada fila esta atada a un company_user, asi que define EN
 *                    QUE EMPRESA tiene acceso.
 *
 * Este modulo es SOLO LECTURA: no hay separacion lectura/escritura, un unico
 * subproceso (`PAYMENT_ASSISTANT_URL`) habilita la consulta. La resolucion del
 * endpoint SAP por empresa es identica a la de registros sanitarios, pero aqui
 * "empresa lista" solo exige endpoint activo con baseUrl + companyDB (la
 * propuesta usa entidades estandar del Service Layer: PurchaseInvoices y
 * BusinessPartners; no depende de ningun UDO propio).
 */

export const PAYMENT_ASSISTANT_URL = '/process/payment-assistant';

/** Endpoint SAP de una empresa, con credenciales. SOLO uso en servidor. */
export interface CompanySapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (columna `client`). */
  companyDB: string;
}

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface PaymentAssistantCompanyAccess {
  idCompany: number;
  companyName: string;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface PaymentAssistantCompanyPublic {
  idCompany: number;
  companyName: string;
  /** true si la empresa esta lista para consultar (endpoint activo). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el Asistente de
 * Pagos, con su endpoint SAP.
 *
 * INCLUYE credenciales -> NO devolver tal cual al navegador. Para el cliente,
 * usar toPublicAccess().
 */
export async function getPaymentAssistantAccess(
  userEmail: string
): Promise<PaymentAssistantCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: PAYMENT_ASSISTANT_URL },
    },
    include: {
      companyUser: {
        include: {
          company: { include: { sap_endpoints: true } },
        },
      },
    },
  });

  const byCompany = new Map<number, PaymentAssistantCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;
    if (byCompany.has(id)) continue;

    const ep =
      company.sap_endpoints.find((e) => e.is_active) ?? company.sap_endpoints[0] ?? null;
    byCompany.set(id, {
      idCompany: id,
      companyName: company.company,
      endpoint: ep
        ? {
            baseUrl: ep.base_url,
            username: ep.username ?? '',
            password: ep.password ?? '',
            companyDB: ep.client ?? '',
          }
        : null,
    });
  }

  return [...byCompany.values()];
}

/** Una empresa esta "lista" si tiene endpoint activo con baseUrl y companyDB. */
export function isCompanyReady(access: PaymentAssistantCompanyAccess): boolean {
  return Boolean(access.endpoint && access.endpoint.baseUrl && access.endpoint.companyDB);
}

/**
 * Devuelve el acceso (con endpoint y credenciales, SOLO servidor) de UNA empresa
 * para un usuario, validando que tenga el subproceso y que la empresa este lista.
 * null si no tiene permiso, la empresa no aplica, o no esta configurada.
 */
export async function getCompanyEndpointForUser(
  userEmail: string,
  companyId: number
): Promise<PaymentAssistantCompanyAccess | null> {
  const access = await getPaymentAssistantAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (!isCompanyReady(company)) return null;
  return company;
}

/**
 * Verifica que un usuario tenga acceso al Asistente de Pagos en una empresa.
 *
 * El módulo es de UN SOLO NIVEL de permiso (un único subproceso
 * `PAYMENT_ASSISTANT_URL`): quien tiene acceso a la empresa puede consultar y,
 * por ahora, también editar la configuración de dispersión de esa empresa. Por
 * eso este chequeo hace las veces de "nivel write" para la configuración: no
 * exige endpoint SAP activo (la config no consulta SAP), solo pertenencia a la
 * empresa dentro del módulo. Si más adelante se separa lectura/escritura, este
 * es el punto para endurecerlo.
 */
export async function userCanAccessCompany(
  userEmail: string,
  companyId: number
): Promise<boolean> {
  const access = await getPaymentAssistantAccess(userEmail);
  return access.some((a) => a.idCompany === companyId);
}

/** Proyecta el acceso a la forma segura para el navegador (sin credenciales). */
export function toPublicAccess(
  access: PaymentAssistantCompanyAccess[]
): PaymentAssistantCompanyPublic[] {
  return access.map((a) => ({
    idCompany: a.idCompany,
    companyName: a.companyName,
    ready: isCompanyReady(a),
  }));
}
