import { estadoConexion } from '../../../lib/correo/service';
import { puedeCrearTicket } from '../../../lib/correo/ticket';
import { errorResponse, getCorreoContext, jsonNoStore } from './_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo — acceso al módulo y estado de la conexión con Outlook.
 * `empresas`: donde puede crear solicitudes (las mismas de «Nueva solicitud»);
 * `empresaBuzon`: la primera empresa con el módulo Correo (predeterminada).
 * `ticketHabilitado`: «Crear ticket» (solo TI: técnicos de la mesa de ayuda). Es solo para
 * mostrar el botón: /api/correo/ticket lo vuelve a validar en cada llamada.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const [conexion, ticketHabilitado] = await Promise.all([estadoConexion(ctx.deps, ctx.acceso), puedeCrearTicket(ctx.deps, ctx.acceso)]);
    return jsonNoStore({
      usuario: { id: ctx.acceso.idUser, nombre: ctx.acceso.nombre, email: ctx.acceso.email },
      empresas: ctx.acceso.empresasSolicitud,
      empresaBuzon: ctx.acceso.empresas[0]?.idCompany ?? null,
      conexion,
      ticketHabilitado,
      // Dominios del grupo: la ventana de Redactar marca en amarillo a los destinatarios externos.
      dominiosGrupo: ctx.deps.dominiosGrupo,
    });
  } catch (error) {
    return errorResponse(error, 'estado');
  }
}
