import { vistaPrevia } from '../../../../../../lib/transferencias-nabuco/motor';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';

/** POST { docEntry } — payload que se enviaría para ese documento (sin enviar). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  const docEntry = parseId(body?.docEntry);
  if (!docEntry) return jsonNoStore({ error: 'Indique un DocEntry válido' }, 400);
  try {
    return jsonNoStore({ payload: await vistaPrevia(r.cfg, docEntry) });
  } catch (e) {
    return errorResponse(e, 'vista-previa');
  }
}
