import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Organigrama" (multiempresa).
 *
 * Espeja el mecanismo de "Compras" / "Articulos": el acceso por empresa se
 * modela con filas subprocess_user_company atadas a un subproceso cuya
 * subprocess_url identifica el modulo. Cada fila esta atada a un company_user
 * que define EN QUE EMPRESA aplica.
 *
 *   - ACCESS_URL ('/process/organigrama') -> ver y editar el organigrama de
 *     esa empresa.
 *
 * A diferencia de Articulos/Compras, el organigrama NO consume SAP: toda la
 * informacion vive en la base local (modelos Cargo, CargoAlias, CargoJerarquia).
 * Por eso no hay "readiness" por endpoint: una empresa esta lista si el usuario
 * tiene el subproceso para ella.
 *
 * Modelo de permiso UNICO (ver+editar): el organigrama es una herramienta de
 * administracion del catalogo organizacional; quien tiene acceso a una empresa
 * puede visualizar y editar su jerarquia en esa empresa. Si en el futuro se
 * requiere separar lectura de escritura, se agrega un WRITE_URL siguiendo el
 * mismo patron de Articulos (dos subprocesos), sin tocar el resto del codigo.
 */

// URL dedicada del modulo (subproceso '/process/organigrama' sembrado en BD).
export const ORGANIGRAMA_ACCESS_URL = '/process/organigrama';

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface OrganigramaCompanyAccess {
  idCompany: number;
  companyName: string;
  /** El usuario puede ver y editar el organigrama de esta empresa. */
  canAccess: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el modulo de
 * organigrama. Solo datos de empresa (sin credenciales): es seguro devolverlo
 * al navegador tal cual.
 */
export async function getOrganigramaAccess(
  userEmail: string
): Promise<OrganigramaCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: ORGANIGRAMA_ACCESS_URL },
    },
    include: {
      companyUser: { include: { company: true } },
    },
  });

  const byCompany = new Map<number, OrganigramaCompanyAccess>();
  for (const row of rows) {
    const company = row.companyUser.company;
    if (!byCompany.has(company.id_company)) {
      byCompany.set(company.id_company, {
        idCompany: company.id_company,
        companyName: company.company,
        canAccess: true,
      });
    }
  }

  return [...byCompany.values()].sort((a, b) => a.idCompany - b.idCompany);
}

/**
 * Verifica que el usuario tenga acceso al organigrama de UNA empresa concreta.
 * Devuelve la empresa accesible o null. Usar antes de leer o escribir.
 */
export async function getCompanyAccessForUser(
  userEmail: string,
  companyId: number
): Promise<OrganigramaCompanyAccess | null> {
  const access = await getOrganigramaAccess(userEmail);
  return access.find((a) => a.idCompany === companyId) ?? null;
}
