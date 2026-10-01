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
import { bodyTooLarge, checkSgcRate, type SgcRateBucket } from '../../../../lib/sgc/rateLimit';

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
  need: 'canRead' | 'canQuality' | 'canManage' | 'canAdminFlows' = 'canRead'
): SgcCompanyAccess | null {
  const entry = ctx.access.find((a) => a.idCompany === idCompany);
  return entry && entry[need] ? entry : null;
}

/** Acceso que permite configurar flujos, matriz y autorizaciones (administración de flujos o Calidad). */
export function configAccess(ctx: SgcRequestContext, idCompany: number): SgcCompanyAccess | null {
  const entry = ctx.access.find((a) => a.idCompany === idCompany);
  return entry && (entry.canAdminFlows || entry.canQuality) ? entry : null;
}

/** Id numérico positivo de un segmento de la URL, o null. */
export function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Cuerpo JSON como objeto (o null si no lo es). */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Empresa pedida en la URL (?company=3). */
export function parseCompanyParam(url: string): number | null {
  const raw = new URL(url).searchParams.get('company');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Sprint 6 — límite de tasa: 429 con Retry-After si la persona (o la IP, en
 * rutas sin sesión) superó el límite del tipo de ruta; null si puede seguir.
 */
export function rateLimitResponse(bucket: SgcRateBucket, who: string): NextResponse | null {
  const d = checkSgcRate(bucket, who);
  if (d.allowed) return null;
  return NextResponse.json(
    { error: 'Demasiadas solicitudes seguidas. Espere un momento e intente de nuevo.' },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(d.retryAfterSeconds) } }
  );
}

/**
 * Sprint 6 — antes de leer un formulario con archivos: 413 si el cuerpo
 * declarado es demasiado grande y 403 si la persona no tiene ningún acceso al
 * SGC (así nadie sin permiso hace que el servidor cargue el cuerpo en memoria).
 */
export function uploadGuard(request: Request, ctx: SgcRequestContext): NextResponse | null {
  if (bodyTooLarge(request.headers.get('content-length'))) return jsonNoStore({ error: 'El archivo supera el tamaño permitido (25 MB).' }, 413);
  if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
  return null;
}

/** Traduce un error a respuesta: los de negocio con su mensaje; el resto, 500 sin detalle. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (isSgcError(error)) return jsonNoStore({ error: error.message }, error.status);
  console.error(`[sgc/${tag}]`, error);
  return jsonNoStore({ error: 'Error interno del SGC' }, 500);
}
