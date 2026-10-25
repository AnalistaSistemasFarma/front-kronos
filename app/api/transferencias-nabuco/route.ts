import { getNabucoContext, jsonNoStore } from './_lib/context';

export const dynamic = 'force-dynamic';

/** Empresas y permisos del usuario en Transferencias Nabuco. */
export async function GET() {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  return jsonNoStore({ companies: ctx.access });
}
