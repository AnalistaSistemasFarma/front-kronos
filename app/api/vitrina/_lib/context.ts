import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getActiveUserId, getVitrinaAccessForUser } from '../../../../lib/vitrina/access';
import { VITRINA_GESTION_NAME, VITRINA_MODULE_NAME } from '../../../../lib/vitrina/constants';
import { companyVitrinaAccess, isVitrinaError, type VitrinaCompanyAccess } from '../../../../lib/vitrina/rules';
import type { VitrinaActor } from '../../../../lib/vitrina/service';

/**
 * Contexto común de las rutas /api/vitrina/**: sesión, usuario activo y acceso por
 * empresa (subprocess_user_company). Todo sale de la SESIÓN; la empresa viene en la
 * petición y se valida contra los permisos del usuario en ESA empresa.
 */
export interface VitrinaRequestContext {
  email: string;
  idUser: string;
  access: VitrinaCompanyAccess[];
}

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function getVitrinaContext(): Promise<VitrinaRequestContext | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: 'No autorizado' }, 401);
  const [access, idUser] = await Promise.all([getVitrinaAccessForUser(prisma, email), getActiveUserId(prisma, email)]);
  if (!idUser) return jsonNoStore({ error: 'Su usuario está inactivo en SynerLink.' }, 403);
  return { email, idUser, access };
}

/** Actor de Gestión en la empresa pedida, o 400/403. */
export function requireGestion(ctx: VitrinaRequestContext, idCompany: number | null): VitrinaActor | NextResponse {
  if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
  const a = companyVitrinaAccess(ctx.access, idCompany, 'canGestionar');
  if (!a) {
    return jsonNoStore({ error: `No tiene el permiso «${VITRINA_GESTION_NAME}» en esta empresa. Lo asigna un administrador en Administración → Usuarios.` }, 403);
  }
  return { idCompany, idUser: ctx.idUser };
}

/** Consulta (comercial) en la empresa pedida, o 400/403. Gestión implica consulta. */
export function requireConsulta(ctx: VitrinaRequestContext, idCompany: number | null): VitrinaActor | NextResponse {
  if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
  const a = companyVitrinaAccess(ctx.access, idCompany, 'canConsultar');
  if (!a) {
    return jsonNoStore({ error: `No tiene el permiso «${VITRINA_MODULE_NAME}» en esta empresa. Lo asigna un administrador en Administración → Usuarios.` }, 403);
  }
  return { idCompany, idUser: ctx.idUser };
}

/** Consulta con la empresa en ?company=. */
export async function consultaDesdeUrl(request: Request): Promise<VitrinaActor | NextResponse> {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  return requireConsulta(ctx, parseCompanyParam(request.url));
}

/** Gestión con la empresa en ?company=. */
export async function gestionDesdeUrl(request: Request): Promise<VitrinaActor | NextResponse> {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  return requireGestion(ctx, parseCompanyParam(request.url));
}

/** Gestión con la empresa en el cuerpo ({ company }). Devuelve también el cuerpo leído. */
export async function gestionDesdeCuerpo(request: Request): Promise<{ actor: VitrinaActor; body: Record<string, unknown> } | NextResponse> {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  const actor = requireGestion(ctx, parseId(body.company));
  if (actor instanceof Response) return actor;
  return { actor, body };
}

export function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseCompanyParam(url: string): number | null {
  return parseId(new URL(url).searchParams.get('company'));
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Errores de negocio con su mensaje; el resto, 500 sin detalle. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (isVitrinaError(error)) return jsonNoStore({ error: error.message }, error.status);
  console.error(`[vitrina/${tag}]`, error);
  return jsonNoStore({ error: `Error interno de ${VITRINA_MODULE_NAME}` }, 500);
}
