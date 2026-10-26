import { proyectosDeHilos, vinculosDeHilos } from '../../../../lib/correo/db';
import { auditarLectura, proveedorDe } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/mensajes?carpeta&desde&hasta&de&noLeidos=1&conAdjuntos=1&buscar&cursor
 * Una página de la bandeja PROPIA (25), con la solicitud vinculada de cada hilo y los proyectos del chat donde
 * se vinculó (para avisar antes de eliminar un correo ligado).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams;
    const prov = await proveedorDe(ctx.deps, ctx.acceso);
    const pagina = await prov.mensajes(
      {
        carpetaId: q.get('carpeta'),
        desde: q.get('desde'),
        hasta: q.get('hasta'),
        de: q.get('de'),
        noLeidos: q.get('noLeidos') === '1',
        conAdjuntos: q.get('conAdjuntos') === '1',
        buscar: q.get('buscar'),
      },
      q.get('cursor')
    );
    // Auditoría de la lectura: qué filtros y cuántos correos (sin contenido).
    const filtros = ['carpeta', 'desde', 'hasta', 'de', 'noLeidos', 'conAdjuntos', 'buscar'].filter((k) => q.get(k)).join(',');
    await auditarLectura(
      ctx.deps,
      ctx.acceso,
      { accion: 'LEER_BANDEJA', detalle: `${pagina.mensajes.length} correo(s)${q.get('cursor') ? ', página siguiente' : ''}${filtros ? `, filtros: ${filtros}` : ''}` },
      ctx.ip
    );
    const hilos = pagina.mensajes.map((m) => m.conversationId);
    const [vinculos, proyectos] = await Promise.all([
      vinculosDeHilos(ctx.deps.db, ctx.acceso.idUser, hilos),
      proyectosDeHilos(ctx.deps.db, ctx.acceso.email, hilos),
    ]);
    return jsonNoStore({
      mensajes: pagina.mensajes.map((m) => ({ ...m, solicitud: vinculos.get(m.conversationId)?.idRequest ?? null, proyectos: proyectos.get(m.conversationId) ?? [] })),
      siguiente: pagina.siguiente,
    });
  } catch (error) {
    return errorResponse(error, 'mensajes');
  }
}
