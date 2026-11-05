import { EntradaInvalida, simularDocumentos, validarDocEntries } from '../../../../../../lib/transferencias-nabuco/asistida';
import { errorResponse, jsonNoStore, readJson } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST { docEntries: number[] } (máx. 200) — arma la solicitud de cada documento SIN enviarla y
 * registra los válidos como 'simulado' en nabuco_envio (no pisa enviados). 409 si la config está ocupada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  try {
    const docEntries = validarDocEntries(body.docEntries);
    return jsonNoStore({ resultados: await simularDocumentos(r.cfg, docEntries, r.ctx.email) });
  } catch (e) {
    if (e instanceof EntradaInvalida) return jsonNoStore({ error: e.message }, 400);
    return errorResponse(e, 'simular');
  }
}
