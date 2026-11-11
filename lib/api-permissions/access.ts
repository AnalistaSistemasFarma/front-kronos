/**
 * REJA del panel de la API SAP (servidor), 2026-11-10. Igual que Firmas o cualquier otro
 * proceso: entra quien tenga asignado el subproceso «Gestión de la API SAP» (/process/api-sap,
 * proceso «API SAP») en cualquier empresa. Se asigna desde Administración → Usuarios como
 * cualquier subproceso. El rol (admin, super_user…) por sí solo NO da entrada.
 */
import 'server-only';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { resolveCanonicalUserEmail } from '../access-control';
import { prisma } from '../prisma';
import { API_SAP_MANAGE_URL } from './constants';
import {
  ApiClientConflictError,
  MEXICO_EMAIL_TAKEN_MESSAGE,
  isMexicoEmailUniqueViolation,
  isMissingAccessLevelColumnError,
  isMissingPermissionCompanyTableError,
  isMissingApiTablesError,
  isMissingKeyExpiryColumnError,
  isMissingSubjectsSchemaError,
  isUniqueViolation,
} from './db';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function canManageApiClients(userEmail: string | null | undefined): Promise<boolean> {
  if (!userEmail) return false;
  try {
    const email = await resolveCanonicalUserEmail(userEmail);
    if (!email) return false;

    const rows = await prisma.$queryRaw<Array<{ marker: number | null }>>`
      SELECT TOP 1
        (SELECT TOP 1 suc.id_subprocess_user_company
           FROM [subprocess_user_company] suc
           INNER JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
           INNER JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
          WHERE cu.id_user = u.id
            AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, '')))) = ${API_SAP_MANAGE_URL}) AS marker
      FROM [user] u
      WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(${email})))
    `;
    const row = rows[0];
    if (!row) return false;
    return Boolean(row.marker);
  } catch (error) {
    console.error('[permisos-api] Error al validar el acceso:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** Respuesta de error de las rutas de administración: sin detalles técnicos al cliente. */
export function adminErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof ApiClientConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
  }
  console.error(`[permisos-api] Error (${context}):`, error instanceof Error ? error.message : error);
  if (isMissingKeyExpiryColumnError(error)) {
    return NextResponse.json(
      { error: 'Falta aplicar en esta base el script de vencimiento de llaves (2026-11-10-permisos-api-vencimiento-llaves).' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (isMissingAccessLevelColumnError(error)) {
    return NextResponse.json(
      { error: 'Falta aplicar en esta base el script del nivel de acceso de Permisos API (2026-11-11-permisos-api-nivel-acceso).' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (isMissingSubjectsSchemaError(error)) {
    return NextResponse.json(
      { error: 'Falta aplicar en esta base el script de sujetos de Permisos API (2026-11-09-permisos-api-sujetos).' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (isMissingPermissionCompanyTableError(error)) {
    return NextResponse.json(
      { error: 'Falta aplicar en esta base el script de permisos por empresa (2026-11-11-permisos-api-permiso-empresa).' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (isMissingApiTablesError(error)) {
    return NextResponse.json(
      { error: 'Las tablas de Permisos API aún no existen en esta base (falta el script SQL del pase).' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (isMexicoEmailUniqueViolation(error)) {
    return NextResponse.json({ error: MEXICO_EMAIL_TAKEN_MESSAGE }, { status: 409, headers: NO_STORE });
  }
  if (isUniqueViolation(error)) {
    return NextResponse.json({ error: 'Ya existe un cliente con ese nombre' }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ error: 'No se pudo completar la operación' }, { status: 500, headers: NO_STORE });
}

/** Lee el cuerpo JSON sin lanzar (null si no es JSON). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Para las rutas de administración: devuelve el correo del administrador o la
 * respuesta 401/403 que hay que enviar.
 */
export async function requireApiClientAdmin(): Promise<{ email: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers: NO_STORE });
  if (!(await canManageApiClients(email))) {
    return NextResponse.json({ error: 'No tiene permiso para administrar los permisos API' }, { status: 403, headers: NO_STORE });
  }
  return { email };
}
