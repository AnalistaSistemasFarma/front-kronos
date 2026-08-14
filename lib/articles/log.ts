import { sapGetAll, sapPost, type SapSession } from '../sap/serviceLayer';

/**
 * Bitácora de cambios de artículos.
 *
 * Cada cambio (crear/editar/cargue masivo) se registra como una fila en un UDO
 * de SAP (tipo MasterData) cuyo nombre varía por empresa y se configura en
 * `sap_endpoints.articles_log_object` (ej. `ART_CHG_LOG` en OLP). Si la empresa
 * no tiene log configurado, no se escribe nada.
 *
 * Campos del UDO:
 *   Code (clave única) | Name | U_ItemCode | U_Action | U_Changes (JSON) |
 *   U_UserEmail | U_ChangedAt (ISO).
 *
 * El registro es BEST-EFFORT: si falla, no debe tumbar la operación principal
 * (el artículo ya se guardó en SAP). Por eso se captura el error y se loguea.
 */

export type ArticleLogAction = 'crear' | 'actualizar';

export interface ArticleLogEntry {
  code: string;
  itemCode: string;
  action: string;
  changes: Record<string, unknown> | string | null;
  userEmail: string;
  changedAt: string;
}

/** Genera un Code único para la fila del UDO (MasterData exige Code único). */
function buildCode(itemCode: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
  // Acota a 50 chars (límite del campo Code de un UDO).
  return `${itemCode}-${stamp}${rnd}`.slice(0, 50);
}

/**
 * Escribe un registro de cambio en el UDO de la empresa. Best-effort: nunca
 * lanza (la operación de SAP del artículo ya ocurrió).
 */
export async function registrarCambioArticulo(
  session: SapSession,
  logObject: string | null | undefined,
  data: {
    itemCode: string;
    action: ArticleLogAction;
    changes: Record<string, unknown>;
    userEmail: string;
  }
): Promise<void> {
  if (!logObject) return; // empresa sin bitácora configurada
  try {
    const changedAt = new Date().toISOString();
    await sapPost(session, logObject, {
      Code: buildCode(data.itemCode),
      Name: `${data.action} ${data.itemCode}`.slice(0, 100),
      U_ItemCode: data.itemCode,
      U_Action: data.action,
      U_Changes: JSON.stringify(data.changes ?? {}),
      U_UserEmail: data.userEmail,
      U_ChangedAt: changedAt,
    });
  } catch (err) {
    // No interrumpe la respuesta: el cambio del artículo ya quedó en SAP.
    console.error(
      `[articles/log] No se pudo registrar el log de ${data.itemCode} (${logObject}):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Lee el historial de cambios de un artículo, más reciente primero.
 * Devuelve [] si la empresa no tiene log configurado.
 */
export async function leerHistorialArticulo(
  session: SapSession,
  logObject: string | null | undefined,
  itemCode: string
): Promise<ArticleLogEntry[]> {
  if (!logObject) return [];
  const safe = itemCode.replace(/'/g, "''");
  const rows = await sapGetAll<Record<string, unknown>>(
    session,
    `${logObject}?$filter=U_ItemCode eq '${safe}'`,
    { pageSize: 200, cap: 2000 }
  );

  const entries: ArticleLogEntry[] = rows.map((r) => {
    let changes: ArticleLogEntry['changes'] = null;
    const raw = r.U_Changes;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        changes = JSON.parse(raw);
      } catch {
        changes = raw; // si no es JSON válido, se muestra crudo
      }
    }
    return {
      code: String(r.Code ?? ''),
      itemCode: String(r.U_ItemCode ?? ''),
      action: String(r.U_Action ?? ''),
      changes,
      userEmail: String(r.U_UserEmail ?? ''),
      changedAt: String(r.U_ChangedAt ?? ''),
    };
  });

  // Más reciente primero (ChangedAt ISO ordena lexicográficamente).
  entries.sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0));
  return entries;
}
