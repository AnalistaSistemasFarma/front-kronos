import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getActiveUserId, getOtAccessForUser, type OtActor } from '../../../../lib/ordenes-trabajo/db';
import { companyOtAccess, isOtError, type OtCompanyAccess } from '../../../../lib/ordenes-trabajo/rules';
import { readClientOrigin } from '../../../../lib/sgc/clientOrigin';

/**
 * Contexto común de las rutas /api/ordenes-trabajo/**: sesión, usuario activo,
 * acceso por empresa (subprocesos) y origen. Todo sale de la SESIÓN: el cliente
 * nunca envía identidades ni horas.
 */
export interface OtRequestContext {
  email: string;
  access: OtCompanyAccess[];
  actor: OtActor;
}

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Contexto de la petición, o 401 sin sesión / 403 sin ningún permiso del módulo. */
export async function getOtRequestContext(request: Request): Promise<OtRequestContext | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: 'No autorizado' }, 401);
  const [access, idUser] = await Promise.all([getOtAccessForUser(prisma, email), getActiveUserId(prisma, email)]);
  if (!idUser || access.length === 0) return jsonNoStore({ error: 'No tiene acceso a Órdenes de Trabajo' }, 403);
  const { clientIp } = readClientOrigin(request);
  return { email, access, actor: { idUser, email, ip: clientIp } };
}

/** Acceso a la empresa pedida con el permiso indicado, o la respuesta 400/403. */
export function requireCompany(
  ctx: OtRequestContext,
  idCompany: number | null,
  need: 'canOperate' | 'canManage' = 'canOperate'
): OtCompanyAccess | NextResponse {
  if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
  const a = companyOtAccess(ctx.access, idCompany, need);
  if (a) return a;
  return jsonNoStore(
    {
      error:
        need === 'canManage'
          ? 'Solo el supervisor (Órdenes de Trabajo: Gestión) puede hacer esto.'
          : 'No tiene acceso a Órdenes de Trabajo en esta empresa.',
    },
    403
  );
}

export function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseCompanyParam(url: string): number | null {
  const raw = new URL(url).searchParams.get('company');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Errores de negocio con su mensaje; el resto, 500 sin detalle. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (isOtError(error)) return jsonNoStore({ error: error.message }, error.status);
  console.error(`[ordenes-trabajo/${tag}]`, error);
  return jsonNoStore({ error: 'Error interno de Órdenes de Trabajo' }, 500);
}
