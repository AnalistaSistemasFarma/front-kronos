import { prisma } from '../prisma';
import {
  SALAS_ADMIN_URL,
  SALAS_RESERVAR_URL,
  SALAS_VER_URL,
  nivelDesdeUrls,
  type NivelSalas,
} from './permisos';

/**
 * Nivel de acceso del usuario al módulo de Salas. Basta con tener el
 * subproceso en cualquiera de sus empresas: las salas son de la sede y se
 * comparten entre las empresas del grupo.
 */
export async function getNivelSalas(userEmail: string): Promise<NivelSalas | null> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: { in: [SALAS_VER_URL, SALAS_RESERVAR_URL, SALAS_ADMIN_URL] } },
    },
    select: { subprocess: { select: { subprocess_url: true } } },
  });
  return nivelDesdeUrls(rows.map((r) => r.subprocess.subprocess_url));
}
