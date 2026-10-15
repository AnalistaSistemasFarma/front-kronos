import { estadoConexion } from '../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from './_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo — acceso al módulo (empresas) y estado de la conexión con Outlook. */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const conexion = await estadoConexion(ctx.deps, ctx.acceso);
    return jsonNoStore({
      usuario: { id: ctx.acceso.idUser, nombre: ctx.acceso.nombre, email: ctx.acceso.email },
      empresas: ctx.acceso.empresas,
      conexion,
    });
  } catch (error) {
    return errorResponse(error, 'estado');
  }
}
