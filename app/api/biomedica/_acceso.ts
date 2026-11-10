import { prisma } from '../../../lib/prisma';
import { getBiomedAccessForUser, type BiomedAccess } from '../../../lib/biomedica/access';
import { getSgcRequestContext, jsonNoStore } from '../sgc/_lib/context';

/**
 * Sesión + acceso al módulo de Ingeniería biomédica para una empresa (2026-11-06).
 * Responde 401 sin sesión, 400 sin empresa y 403 sin el permiso del módulo ni el de Calidad.
 */
export async function biomedContext(request: Request, rawCompany: unknown): Promise<Response | { access: BiomedAccess; email: string; actor: { email: string; ip: string | null } }> {
  const ctx = await getSgcRequestContext(request);
  if (ctx instanceof Response) return ctx;
  const idCompany = Number(rawCompany);
  if (!Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
  const access = (await getBiomedAccessForUser(prisma, ctx.email)).find((a) => a.idCompany === idCompany);
  if (!access) return jsonNoStore({ error: 'Solo los ingenieros biomédicos y Aseguramiento de Calidad usan este módulo' }, 403);
  return { access, email: ctx.email, actor: { email: ctx.email, ip: ctx.actor.ip ?? null } };
}
