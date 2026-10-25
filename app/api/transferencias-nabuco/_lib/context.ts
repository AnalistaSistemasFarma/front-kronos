import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getActiveUserId, getNabucoAccessForUser, type NabucoCompanyAccess } from '../../../../lib/transferencias-nabuco/access';
import { NABUCO_ADMIN_NAME, NABUCO_MODULE_NAME } from '../../../../lib/transferencias-nabuco/constants';
import { NabucoError } from '../../../../lib/transferencias-nabuco/db';
import { SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Contexto común de /api/transferencias-nabuco/** (mismo patrón que Vitrina): sesión,
 * usuario activo y acceso POR EMPRESA (subprocess_user_company). La empresa viene en la
 * petición (o sale de la config) y se valida contra los permisos del usuario en ESA empresa.
 */
export interface NabucoContext {
  email: string;
  idUser: string;
  access: NabucoCompanyAccess[];
}

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function getNabucoContext(): Promise<NabucoContext | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: 'No autorizado' }, 401);
  const [access, idUser] = await Promise.all([getNabucoAccessForUser(email), getActiveUserId(email)]);
  if (!idUser) return jsonNoStore({ error: 'Su usuario está inactivo en SynerLink.' }, 403);
  return { email, idUser, access };
}

export function requireEmpresa(ctx: NabucoContext, idCompany: number | null, nivel: 'leer' | 'admin'): NextResponse | null {
  if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
  const a = ctx.access.find((x) => x.idCompany === idCompany);
  const ok = a && (nivel === 'admin' ? a.canAdministrar : a.canLeer);
  if (ok) return null;
  const permiso = nivel === 'admin' ? NABUCO_ADMIN_NAME : NABUCO_MODULE_NAME;
  return jsonNoStore({ error: `No tiene el permiso «${permiso}» en esta empresa. Lo asigna un administrador en Administración → Usuarios.` }, 403);
}

export function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Errores de negocio con su mensaje; el resto, 500 sin detalle (nunca credenciales). */
export function errorResponse(error: unknown, tag: string): NextResponse {
  if (error instanceof NabucoError) return jsonNoStore({ error: error.message }, error.status);
  if (error instanceof SapError) return jsonNoStore({ error: `SAP: ${error.message}` }, 502);
  console.error(`[transferencias-nabuco/${tag}]`, error instanceof Error ? error.message : error);
  return jsonNoStore({ error: `Error interno de ${NABUCO_MODULE_NAME}` }, 500);
}
