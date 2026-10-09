/** Lado servidor de la importación desde Microsoft Forms: dónde está el servicio y cabeceras comunes. */
export const SIN_CACHE = { 'Cache-Control': 'no-store' };

/** URL del servicio `importador-forms` (loopback) o null si este ambiente no lo tiene configurado. */
export function urlImportador(): string | null {
  const v = (process.env.PORTAL_TH_IMPORTADOR_FORMS ?? '').trim().replace(/\/+$/, '');
  return v || null;
}
