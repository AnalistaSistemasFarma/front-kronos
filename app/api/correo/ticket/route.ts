import { crearTicketDesdeHilo, parseEntradaTicket, prepararTicket, ticketDelHilo } from '../../../../lib/correo/ticket';
import { CorreoError } from '../../../../lib/correo/errors';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

const GRAPH_ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

/**
 * «Crear ticket» desde un hilo del Correo — SOLO TI (técnicos de la mesa de ayuda; ver
 * lib/correo/ticket.ts). Cada llamada valida el permiso en el servidor (403 SOLO_TI).
 *
 * GET  ?hilo=<conversationId>             → { ticket: id_case | null } (ficha del hilo)
 * GET  ?hilo=<conversationId>&preparar=1  → formulario precargado con el correo
 * POST { conversationId, idCompany, idSolicitante?, tipo, prioridad, sitio, categoria,
 *        subcategoria, actividad, departamento, tecnico?, asunto, descripcion, adjuntosIds[] }
 *      → 201 { idCase, solicitante, adjuntosSubidos, adjuntosFallidos }
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    const hilo = params.get('hilo') ?? '';
    if (!GRAPH_ID_RE.test(hilo)) throw new CorreoError('Hilo inválido.', 400);
    if (params.get('preparar') === '1') return jsonNoStore(await prepararTicket(ctx.deps, ctx.acceso, hilo));
    return jsonNoStore({ ticket: await ticketDelHilo(ctx.deps, ctx.acceso, hilo) });
  } catch (error) {
    return errorResponse(error, 'ticket');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const entrada = parseEntradaTicket(await readJson(request));
    return jsonNoStore(await crearTicketDesdeHilo(ctx.deps, ctx.acceso, entrada, ctx.ip), 201);
  } catch (error) {
    return errorResponse(error, 'ticket');
  }
}
