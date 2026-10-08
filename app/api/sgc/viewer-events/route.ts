import { prisma } from '../../../../lib/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../../../../lib/sgc/audit';
import { SGC_VIEWER_EVENTS, SGC_VIEWER_EVENT_LABELS, viewerResourceOf, type SgcViewerEvent } from '../../../../lib/sgc/uncontrolledCopies';
import { errorResponse, getSgcRequestContext, jsonNoStore, rateLimitResponse, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/viewer-events { event, resource } — Sprint 11: el visor del
 * SGC registra en la AUDITORÍA los intentos de captura («Imprimir pantalla»),
 * de copiar y de imprimir sin permiso. Solo deja constancia (no bloquea nada:
 * un navegador no puede impedir una captura del sistema operativo).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
    const limited = rateLimitResponse('verificacion', ctx.email);
    if (limited) return limited;
    const body = await readJson(request);
    const event = body?.event;
    const resource = viewerResourceOf(body?.resource);
    if (!(SGC_VIEWER_EVENTS as readonly unknown[]).includes(event) || !resource) return jsonNoStore({ error: 'Evento inválido' }, 400);
    await writeSgcAudit(prisma, {
      idCompany: ctx.access.length === 1 ? ctx.access[0].idCompany : null,
      actorEmail: ctx.email,
      action: SGC_AUDIT_ACTIONS.visorEvento,
      entity: 'visor',
      entityId: event as string,
      detail: `${SGC_VIEWER_EVENT_LABELS[event as SgcViewerEvent]} en ${resource}.`,
      ip: ctx.actor.ip,
      userAgent: ctx.actor.userAgent,
    });
    return jsonNoStore({ ok: true }, 201);
  } catch (error) {
    return errorResponse(error, 'visor:evento');
  }
}
