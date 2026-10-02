import { NextRequest, NextResponse } from 'next/server';
import { canAuditAgents } from '../../../../../lib/chat/audit-access';
import {
  badRequest,
  jsonNoStore,
  NO_STORE,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';
import { isCollectorRequest } from '../../../../../lib/agent-audit/collector-auth';
import {
  InventoryValidationError,
  parseInventoryPayload,
} from '../../../../../lib/agent-audit/inventory';
import {
  guardarInventario,
  leerInventarioVigente,
  SolicitudInvalidaError,
  vencerSolicitudesColgadas,
} from '../../../../../lib/agent-audit/inventory-db';
import { reconstruirHistorial } from '../../../../../lib/agent-audit/cv-db';

export const dynamic = 'force-dynamic';

/**
 * INVENTARIO DE AGENTES — pestaña "Inventario" de la Auditoría de agentes (F1).
 *
 *   GET  /api/chat/auditoria/inventario   → sesión + permiso de auditoría.
 *        El último inventario de cada agente registrado, sus hallazgos
 *        abiertos y el estado del último escaneo.
 *
 *   POST /api/chat/auditoria/inventario   → SOLO el recolector, con su llave
 *        (Authorization: Bearer AGENT_INVENTORY_COLLECTOR_KEY). Publica una
 *        corrida. Ver lib/agent-audit/collector-auth.ts.
 *
 * Decisiones de Nicolás (2026-10-02): recolector central por SSH desde la Mac
 * de horus, cada noche y con el botón "Re-escanear"; solo agentes ya
 * registrados en SynerLink; y nunca secretos (ni tokens, ni contraseñas, ni
 * valores de variables de entorno). El POST pasa todo por
 * parseInventoryPayload, que además oculta lo que parezca una credencial.
 */

/** Tope del cuerpo: un inventario completo de la flota ronda decenas de KB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        {
          error: 'La auditoría de agentes está reservada a la administración.',
        },
        { status: 403 }
      );
    }

    await vencerSolicitudesColgadas();
    return jsonNoStore(await leerInventarioVigente());
  } catch (error) {
    return serverError('GET /api/chat/auditoria/inventario', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Sin pistas del motivo: igual que la API del agente.
    if (!isCollectorRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return jsonNoStore({ error: 'El inventario es demasiado grande.' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest('El cuerpo no es JSON válido.');
    }

    let payload;
    try {
      payload = parseInventoryPayload(body);
    } catch (err) {
      if (err instanceof InventoryValidationError) return badRequest(err.message);
      throw err;
    }

    try {
      const r = await guardarInventario(payload);
      // Hoja de vida (F2): los cambios de este escaneo entran de una vez a la
      // línea de tiempo. Si falla, el inventario ya quedó guardado y la
      // corrida nocturna lo completa: no se le devuelve error al recolector.
      try {
        await reconstruirHistorial({ desde: new Date(Date.now() - 2 * 86_400_000) });
      } catch (err) {
        console.error('[inventario] no se pudo actualizar la hoja de vida', err);
      }
      return jsonNoStore({ ok: true, ...r });
    } catch (err) {
      if (err instanceof SolicitudInvalidaError) {
        return jsonNoStore({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    return serverError('POST /api/chat/auditoria/inventario', error);
  }
}
