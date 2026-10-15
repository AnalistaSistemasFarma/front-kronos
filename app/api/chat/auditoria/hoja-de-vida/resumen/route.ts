import { NextRequest, NextResponse } from 'next/server';
import { badRequest, jsonNoStore, NO_STORE, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { isCollectorRequest } from '../../../../../../lib/agent-audit/collector-auth';
import { diaColombia, esDia, limpiarResumen, lunesDe, ResumenInvalidoError, sumarDias } from '../../../../../../lib/agent-audit/cv';
import { guardarResumenes, insumosResumen } from '../../../../../../lib/agent-audit/cv-db';

export const dynamic = 'force-dynamic';

/**
 * RESUMEN SEMANAL DE LA HOJA DE VIDA (F2) — lo usa el job semanal de la Mac de
 * horus (launchd com.horus.agent-cv-semanal), con la llave del recolector.
 *
 *   GET  /api/chat/auditoria/hoja-de-vida/resumen?semana=YYYY-MM-DD
 *        → los INSUMOS de cada agente: SOLO datos estructurados (cifras,
 *          inventario, hallazgos, historial). Nunca texto de conversaciones.
 *          Por defecto, la semana anterior completa (lunes a domingo).
 *
 *   POST /api/chat/auditoria/hoja-de-vida/resumen
 *        { "semana": "YYYY-MM-DD", "resumenes": [{ "code", "summary", "model", "inputHash" }] }
 *        → guarda lo que redactó la IA (uno por agente y semana; se reemplaza).
 */
function semanaPorDefecto(): string {
  return lunesDe(sumarDias(diaColombia(new Date()), -7));
}

export async function GET(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }
    const raw = request.nextUrl.searchParams.get('semana');
    const semana = esDia(raw) ? raw : semanaPorDefecto();
    return jsonNoStore(await insumosResumen(semana));
  } catch (error) {
    return serverError('GET /api/chat/auditoria/hoja-de-vida/resumen', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }
    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');
    const semana = esDia(body.semana) ? body.semana : null;
    if (!semana) return badRequest('Falta «semana» (YYYY-MM-DD).');
    if (!Array.isArray(body.resumenes) || body.resumenes.length === 0 || body.resumenes.length > 200) {
      return badRequest('«resumenes» debe ser una lista de 1 a 200 elementos.');
    }
    const items: { code: string; summary: string; model: string | null; inputHash: string | null }[] = [];
    for (const r of body.resumenes as Record<string, unknown>[]) {
      if (!r || typeof r.code !== 'string' || !r.code.trim()) return badRequest('Cada resumen necesita «code».');
      try {
        items.push({
          code: r.code.trim().toLowerCase().slice(0, 60),
          summary: limpiarResumen(r.summary),
          model: typeof r.model === 'string' ? r.model.slice(0, 120) : null,
          inputHash: typeof r.inputHash === 'string' && /^[a-f0-9]{64}$/.test(r.inputHash) ? r.inputHash : null,
        });
      } catch (err) {
        if (err instanceof ResumenInvalidoError) return badRequest(`${r.code}: ${err.message}`);
        throw err;
      }
    }
    return jsonNoStore({ ok: true, ...(await guardarResumenes(semana, items)) });
  } catch (error) {
    return serverError('POST /api/chat/auditoria/hoja-de-vida/resumen', error);
  }
}
