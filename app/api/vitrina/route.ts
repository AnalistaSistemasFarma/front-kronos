import { getVitrinaContext, jsonNoStore } from './_lib/context';

export const dynamic = 'force-dynamic';

/** Empresas y permisos del usuario en la Vitrina Comercial (sin credenciales). */
export async function GET() {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  return jsonNoStore({ companies: ctx.access });
}
