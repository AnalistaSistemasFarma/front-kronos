import { sql, withMssqlPool } from '../mssqlPool';

/**
 * «Ver sin descargar» (2026-11-24, condición de Calidad OLP para no validar los módulos): los adjuntos de una solicitud
 * de un flujo con ACCESO RESTRINGIDO solo los ven sus participantes y solo en el visor seguro (sin descarga ni
 * impresión). Las demás solicitudes siguen igual.
 */
export async function requestViewOnly(requestId: number): Promise<boolean> {
  if (!Number.isInteger(requestId) || requestId <= 0) return false;
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('r', sql.Int, requestId)
      .query<{ restricted_access: boolean | null }>(
        'SELECT TOP 1 pc.restricted_access FROM process_category_request_general pcrg INNER JOIN process_category pc ON pc.id = pcrg.id_process_category WHERE pcrg.id_request_general = @r'
      );
    return Boolean(r.recordset[0]?.restricted_access);
  });
}

export const VIEW_ONLY_MESSAGE = 'Este flujo es de solo consulta: los adjuntos se ven en el visor de SynerLink y no se descargan.';

/** Only PDFs and images can be shown in the secure viewer. */
export function viewableInline(name: string, mime?: string | null): boolean {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(name) || /^(application\/pdf|image\/(png|jpe?g|gif|webp))/i.test(String(mime ?? ''));
}
