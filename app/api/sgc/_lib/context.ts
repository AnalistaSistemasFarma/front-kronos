import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getSgcAccessForUser } from '../../../../lib/sgc/access';
import { auditOrigin } from '../../../../lib/sgc/audit';
import { getAccessSubject } from '../../../../lib/sgc/db/documents';
import type { SgcActor } from '../../../../lib/sgc/db/catalogs';
import type { SgcAccessSubject } from '../../../../lib/sgc/documentAccess';
import { isSgcError } from '../../../../lib/sgc/errors';
import type { SgcCompanyAccess } from '../../../../lib/sgc/permissions';

/**
 * Contexto común de las rutas /api/sgc/**: sesión, acceso por empresa (dos
 * llaves), departamentos de la persona y origen para la auditoría. Todo se
 * resuelve con el correo de la SESIÓN; el cliente no envía identidades.
 */
export interface SgcRequestContext {
  email: string;
  access: SgcCompanyAccess[];
  subject: SgcAccessSubject;
  actor: SgcActor;
}

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Contexto de la petición, o la respuesta 401 si no hay sesión. */
export async function getSgcRequestContext(request: Request): Promise<SgcRequestContext | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const [access, subject] = await Promise.all([getSgcAccessForUser(prisma, email), getAccessSubject(prisma, email)]);
  const origin = auditOrigin(request);
  return { email, access, subject, actor: { email, ip: origin.ip, userAgent: origin.userAgent } };
}

/** Acceso a una empresa concreta con un permiso (o null si no lo tiene). */
export function companyAccess(
  ctx: SgcRequestContext,
  idCompany: number,
  need: 'canRead' | 'canQuality' = 'canRead'
): SgcCompanyAccess | null {
  const entry = ctx.access.find((a) => a.idCompany === idCompany);
  return entry && entry[need] ? entry : null;
}

/** Empresa pedida en la URL (?company=3). */
export function parseCompanyParam(url: string): number | null {
  const raw = new URL(url).searchParams.get('company');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** Traduce un error a respuesta: los de negocio con su mensaje; el resto, 500 sin detalle. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (isSgcError(error)) return jsonNoStore({ error: error.message }, error.status);
  console.error(`[sgc/${tag}]`, error);
  return jsonNoStore({ error: 'Error interno del SGC' }, 500);
}
