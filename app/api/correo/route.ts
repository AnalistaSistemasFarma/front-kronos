import { estadoConexion } from '../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from './_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo — acceso al módulo y estado de la conexión con Outlook.
 * `empresas`: donde puede crear solicitudes (las mismas de «Nueva solicitud»);
 * `empresaBuzon`: la primera empresa con el módulo Correo (predeterminada).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const conexion = await estadoConexion(ctx.deps, ctx.acceso);
    return jsonNoStore({
      usuario: { id: ctx.acceso.idUser, nombre: ctx.acceso.nombre, email: ctx.acceso.email },
      empresas: ctx.acceso.empresasSolicitud,
      empresaBuzon: ctx.acceso.empresas[0]?.idCompany ?? null,
      conexion,
    });
  } catch (error) {
    return errorResponse(error, 'estado');
  }
}
