import { accionManualEnvio, obtenerEnvio } from '../../../../../lib/transferencias-nabuco/db';
import { correrConfig, textoResumen } from '../../../../../lib/transferencias-nabuco/motor';
import { errorResponse, getNabucoContext, jsonNoStore, parseId, readJson, requireEmpresa } from '../../_lib/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function cargar(params: Promise<{ id: string }>, nivel: 'leer' | 'admin') {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Envío no válido' }, 400);
  const envio = await obtenerEnvio(id);
  if (!envio) return jsonNoStore({ error: 'Envío no encontrado' }, 404);
  const denegado = requireEmpresa(ctx, envio.id_company, nivel);
  if (denegado) return denegado;
  return { ctx, envio };
}

/** Detalle del envío: payload enviado y respuesta de Nabuco. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargar(params, 'leer');
  if (r instanceof Response) return r;
  return jsonNoStore({ envio: r.envio });
}

/** POST { accion: 'reintentar' | 'descartar' | 'enviar' } — solo administradores del módulo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargar(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  const accion = body?.accion;
  if (accion !== 'reintentar' && accion !== 'descartar' && accion !== 'enviar') return jsonNoStore({ error: 'Acción no válida' }, 400);
  try {
    if (r.envio.estado === 'enviado') return jsonNoStore({ error: 'El documento ya fue enviado a Nabuco: no se reenvía.' }, 409);
    const ok = await accionManualEnvio(r.envio.id_envio, accion === 'descartar' ? 'descartar' : 'reintentar', r.ctx.email);
    if (!ok) return jsonNoStore({ error: 'El envío cambió de estado; recargue.' }, 409);
    if (accion !== 'enviar') return jsonNoStore({ ok: true });
    const res = await correrConfig(r.envio.id_config, { usuario: r.ctx.email, soloDocEntry: r.envio.doc_entry });
    return jsonNoStore({ ok: true, resumen: res, texto: textoResumen(res, res.simulacion) });
  } catch (e) {
    return errorResponse(e, 'envios:post');
  }
}
