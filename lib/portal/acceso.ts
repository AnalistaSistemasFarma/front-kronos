/**
 * PORTAL DE TALENTO HUMANO — quién puede ver el contenido.
 *
 * El portal se llega por DOS caminos, y los dos son legítimos:
 *
 *   1. Como MÓDULO del hub de SynerLink (`/process/portal-th`). Quien ya tiene
 *      usuario aquí entra con su sesión de siempre y no necesita ningún
 *      código; el permiso se asigna desde Administración → Usuarios, como
 *      cualquier otro módulo.
 *   2. Como PORTAL abierto (`/portal`), con un código al correo, para los
 *      colaboradores del grupo que NO tienen usuario en SynerLink — que son la
 *      mayoría: la plataforma tiene unos cien usuarios y el grupo es más
 *      grande.
 *
 * Este archivo existe para que los endpoints no tengan que saber por cuál de
 * los dos entró la persona: preguntan una sola cosa —"¿puede ver esto?"— y
 * aquí adentro se resuelve.
 */
import { getServerSession } from 'next-auth';
import type { NextRequest } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { prisma } from '../prisma';
import { leerSesion } from './auth';
import { COOKIE_SESION, SUBPROCESO_PORTAL } from './config';

export interface IdentidadPortal {
  correo: string;
  /** Por dónde entró. Sirve para los registros, no para dar más permisos. */
  via: 'synerlink' | 'codigo';
}

/**
 * ¿Este usuario de SynerLink tiene el módulo asignado?
 *
 * Es la MISMA tabla que usa Administración → Usuarios
 * (`subprocess_user_company`), así que el permiso se otorga y se revoca donde
 * se otorgan todos los demás. No hay una lista aparte que mantener.
 */
async function tieneElModulo(correo: string): Promise<boolean> {
  const filas = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT TOP 1 suc.id_subprocess_user_company AS id
    FROM [subprocess_user_company] suc
    INNER JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN [user] u ON u.id = cu.id_user
    INNER JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
    WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(${correo})))
      AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, '')))) = ${SUBPROCESO_PORTAL}
  `;
  return filas.length > 0;
}

/**
 * Resuelve quién es el que pide, por cualquiera de los dos caminos.
 *
 * Se mira PRIMERO la sesión de SynerLink: quien está dentro de la plataforma
 * es el caso normal del módulo, y así no se le pide un código a alguien que ya
 * se autenticó.
 */
export async function identificar(request: NextRequest): Promise<IdentidadPortal | null> {
  try {
    const sesion = await getServerSession(authOptions);
    const correo = sesion?.user?.email;
    if (correo && (await tieneElModulo(correo))) {
      return { correo, via: 'synerlink' };
    }
  } catch (error) {
    // Que falle la sesión de SynerLink no puede tumbar el portal abierto: se
    // registra y se sigue por el otro camino.
    console.warn('[portal] no se pudo leer la sesión de SynerLink:', (error as Error).message);
  }

  const porCodigo = leerSesion(request.cookies.get(COOKIE_SESION)?.value);
  if (porCodigo) return { correo: porCodigo, via: 'codigo' };

  return null;
}
