import { NextRequest, NextResponse } from 'next/server';
import { badRequest, jsonNoStore, NO_STORE, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { isCollectorRequest } from '../../../../../../lib/agent-audit/collector-auth';
import { diaColombia, esDia, sumarDias } from '../../../../../../lib/agent-audit/cv';
import {
  calcularMetricas,
  reconstruirHistorial,
  VENTANA_NOCTURNA_DIAS,
} from '../../../../../../lib/agent-audit/cv-db';

export const dynamic = 'force-dynamic';

/**
 * CORRIDA NOCTURNA DE LA HOJA DE VIDA (F2) — la dispara el job de la Mac de
 * horus (launchd com.horus.agent-cv-nocturno), con la misma llave del
 * recolector del inventario (AGENT_INVENTORY_COLLECTOR_KEY).
 *
 *   POST /api/chat/auditoria/hoja-de-vida/nocturno
 *   { "desde"?: "YYYY-MM-DD", "hasta"?: "YYYY-MM-DD", "historialCompleto"?: true }
 *
 * 1. Recalcula las métricas diarias de la ventana (por defecto los últimos
 *    7 días, incluido hoy) desde lo que ya registra la auditoría.
 * 2. Completa la línea de tiempo (altas, cambios de inventario, hallazgos).
 *
 * Idempotente: repetirla no duplica nada. La aplicación no corre esto sola a
 * propósito: así el cálculo pesado tiene una hora fija y queda en el log del job.
 */
const MAX_DIAS = 400;

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }
    const body = (await readJsonBody(request)) ?? {};
    const hoy = diaColombia(new Date());
    const hasta = esDia(body.hasta) ? body.hasta : hoy;
    const desde = esDia(body.desde) ? body.desde : sumarDias(hasta, -(VENTANA_NOCTURNA_DIAS - 1));
    if (desde > hasta) return badRequest('«desde» no puede ser posterior a «hasta».');
    const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
    if (dias > MAX_DIAS) return badRequest(`La ventana no puede pasar de ${MAX_DIAS} días.`);

    const t0 = Date.now();
    const metricas = await calcularMetricas(desde, hasta);
    const historial = await reconstruirHistorial({
      desde: body.historialCompleto === true ? null : new Date(Date.now() - 15 * 86_400_000),
    });
    return jsonNoStore({ ok: true, metricas, historial, ms: Date.now() - t0 });
  } catch (error) {
    return serverError('POST /api/chat/auditoria/hoja-de-vida/nocturno', error);
  }
}
