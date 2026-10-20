import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { marcarTodoLeido, resumenNoLeidos } from '../../../../lib/proyectos/no-leidos';
import { projectModuleCompanies } from '../../../../lib/chat/projects';
import { estadosTrabajandoVisibles } from '../../../../lib/proyectos/estado-agente-servidor';

export const dynamic = 'force-dynamic';

/**
 * Icono «Proyectos» de la cabecera (2026-10-19, Nicolás Rivera).
 *
 *   GET  /api/proyectos/no-leidos            { noLeidos, mensajes }
 *   GET  /api/proyectos/no-leidos?detalle=1  { noLeidos, mensajes, items[] }  (panel desplegable)
 *   POST /api/proyectos/no-leidos { accion: 'leer-todo' }  marca todo lo visible como leído
 *
 * 401 sin sesión · 403 sin el permiso del módulo en ninguna empresa (el icono no
 * se pinta). `noLeidos` = conversaciones de proyecto con mensajes nuevos; solo
 * cuenta proyectos donde la persona es miembro y conserva el módulo en la
 * empresa del proyecto (lib/proyectos/no-leidos.ts). El fragmento del último
 * mensaje viaja recortado y en texto plano, y solo de esas conversaciones.
 *
 * Con `detalle=1` trae además `trabajando` (2026-10-20): los agentes que están
 * trabajando ahora en conversaciones de proyecto visibles para la persona (la
 * misma puerta). Lo que cambie con el panel abierto llega por el pulso.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const detalle = request.nextUrl.searchParams.get('detalle') === '1';
    const r = await resumenNoLeidos(user, { detalle });
    if (!r) return forbidden('No tiene habilitado el módulo Proyectos.');
    if (detalle) {
      const empresas = (await projectModuleCompanies(user.id)).map((e) => e.idCompany);
      r.trabajando = await estadosTrabajandoVisibles(user.id, empresas);
    }
    return jsonNoStore(r);
  } catch (error) {
    return serverError('GET /api/proyectos/no-leidos', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const payload = (await readJsonBody(request)) ?? {};
    if (payload.accion !== 'leer-todo') return badRequest('Acción no válida.');
    const r = await marcarTodoLeido(user);
    if (!r) return forbidden('No tiene habilitado el módulo Proyectos.');
    return jsonNoStore({ ok: true, ...r });
  } catch (error) {
    return serverError('POST /api/proyectos/no-leidos', error);
  }
}
