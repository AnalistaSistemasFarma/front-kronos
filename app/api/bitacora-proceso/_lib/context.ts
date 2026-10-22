import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getActiveUserId, getOtAccessForUser, puedeAbrirComoJefe, type OtActor } from '../../../../lib/bitacora-proceso/db';
import {
  companyOtAccess,
  isOtError,
  mensajeFaltaAcceso,
  mensajeNoPuedeAbrir,
  OT_MSG_SIN_MODULO,
  OT_MSG_USUARIO_INACTIVO,
  type OtCompanyAccess,
} from '../../../../lib/bitacora-proceso/rules';
import { readClientOrigin } from '../../../../lib/sgc/clientOrigin';

/**
 * Contexto común de las rutas /api/bitacora-proceso/**: sesión, usuario activo,
 * acceso por empresa (subprocesos) y origen. Todo sale de la SESIÓN: el cliente
 * nunca envía identidades ni horas.
 */
export interface OtRequestContext {
  email: string;
  access: OtCompanyAccess[];
  actor: OtActor;
  /** Rol `admin` de SynerLink (puede restablecer PIN de bitácora, B3). */
  isAdmin: boolean;
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
  if (!idUser) return jsonNoStore({ error: OT_MSG_USUARIO_INACTIVO }, 403);
  if (access.length === 0) return jsonNoStore({ error: OT_MSG_SIN_MODULO }, 403);
  const { clientIp } = readClientOrigin(request);
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  return { email, access, actor: { idUser, email, ip: clientIp }, isAdmin };
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
  const entry = ctx.access.find((x) => x.idCompany === idCompany) ?? null;
  return jsonNoStore({ error: mensajeFaltaAcceso(need, entry, idCompany) }, 403);
}

/**
 * Acceso para ABRIR una bitácora (y para los datos que pide la apertura) — R3, 2026-10-17:
 * el supervisor (Gestión) o el JEFE DE PRODUCCIÓN asignado en la empresa. Devuelve también
 * con qué título abre, para que crearOrden aplique la regla del jefe.
 */
export async function requireCompanyOpen(
  ctx: OtRequestContext,
  idCompany: number | null
): Promise<{ access: OtCompanyAccess; abreComo: 'GESTION' | 'JEFE_PROD' } | NextResponse> {
  const a = requireCompany(ctx, idCompany);
  if (a instanceof Response) return a;
  if (a.canManage) return { access: a, abreComo: 'GESTION' };
  if (await puedeAbrirComoJefe(prisma, a, ctx.actor.idUser)) return { access: a, abreComo: 'JEFE_PROD' };
  return jsonNoStore({ error: mensajeNoPuedeAbrir(a) }, 403);
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
  console.error(`[bitacora-proceso/${tag}]`, error);
  return jsonNoStore({ error: 'Error interno de Bitácora de Proceso' }, 500);
}
