import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getCorreoAccess, type AccesoCorreo } from '../../../../lib/correo/db';
import { isCorreoError } from '../../../../lib/correo/errors';
import { correoDeps } from '../../../../lib/correo/runtime';
import type { CorreoDeps } from '../../../../lib/correo/service';
import { SgcRateLimiter, type SgcRateRule } from '../../../../lib/sgc/rateLimit';
import { readClientOrigin } from '../../../../lib/sgc/clientOrigin';

/**
 * Contexto común de /api/correo/**: sesión, permiso del módulo, límite de tasa y
 * dependencias. La identidad y el buzón salen SIEMPRE de la sesión (el correo del
 * usuario de SynerLink → mailboxForSession): ninguna ruta recibe un usuario, buzón
 * o UPN desde el navegador (anti-IDOR).
 */

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Límites por persona (ventana deslizante en memoria, como el SGC). */
export const CORREO_RATE_RULES = {
  lectura: { max: 120, windowMs: 60_000 },
  adjunto: { max: 60, windowMs: 60_000 },
  envio: { max: 10, windowMs: 60_000 },
  creacion: { max: 120, windowMs: 10 * 60_000 },
} as const satisfies Record<string, SgcRateRule>;
export type CorreoRateBucket = keyof typeof CORREO_RATE_RULES;

const limiter: SgcRateLimiter =
  ((globalThis as Record<string, unknown>).__correoRateLimiter as SgcRateLimiter | undefined) ??
  ((globalThis as Record<string, unknown>).__correoRateLimiter = new SgcRateLimiter());

export interface CorreoContext {
  acceso: AccesoCorreo;
  deps: CorreoDeps;
  ip: string | null;
}

/** Contexto, o 401 sin sesión / 403 sin el permiso del módulo / 429 por exceso de peticiones. */
export async function getCorreoContext(request: Request, bucket: CorreoRateBucket = 'lectura'): Promise<CorreoContext | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: 'No autorizado' }, 401);
  const acceso = await getCorreoAccess(prisma, email);
  if (!acceso) return jsonNoStore({ error: 'No tiene acceso al módulo Correo. Pídalo a TI.' }, 403);
  const decision = limiter.check(`${bucket}:${acceso.idUser}`, CORREO_RATE_RULES[bucket], Date.now());
  if (!decision.allowed) {
    return jsonNoStore({ error: `Demasiadas solicitudes. Intente de nuevo en ${decision.retryAfterSeconds} s.` }, 429, {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }
  return { acceso, deps: correoDeps(), ip: readClientOrigin(request).clientIp };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Errores de negocio con su mensaje (y código); el resto, 500 sin detalle. */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (isCorreoError(error)) return jsonNoStore({ error: error.message, code: error.code }, error.status);
  console.error(`[correo/${tag}]`, error instanceof Error ? error.message : 'error');
  return jsonNoStore({ error: 'Error interno del módulo Correo' }, 500);
}

export function empresaParam(url: string): number | null {
  const raw = new URL(url).searchParams.get('empresa');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}
