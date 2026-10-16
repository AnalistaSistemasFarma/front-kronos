import { buscarUsuariosEmpresa } from '../../../../lib/correo/db';
import { puedeUsarEmpresa } from '../../../../lib/correo/service';
import { empresaParam, errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/usuarios?empresa=<id>&q=<texto> — solicitantes posibles (usuarios activos de esa empresa). */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const empresa = empresaParam(request.url);
    if (!empresa || !puedeUsarEmpresa(ctx.acceso, empresa)) return jsonNoStore({ error: 'Usted no pertenece a esa empresa.' }, 403);
    const usuarios = await buscarUsuariosEmpresa(ctx.deps.db, empresa, new URL(request.url).searchParams.get('q') ?? '');
    return jsonNoStore({ usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, correo: u.correo })) });
  } catch (error) {
    return errorResponse(error, 'usuarios');
  }
}
