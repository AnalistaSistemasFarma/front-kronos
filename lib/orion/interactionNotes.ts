/**
 * Notas de progreso Orion / firma que no deben ir al historial de interacciones.
 * El seguimiento de firma vive en Archivos adjuntos.
 * Las notas de carga de archivos SÍ se muestran en el historial.
 */
export function isOrionDocumentInteractionNote(note?: string | null): boolean {
  const text = String(note || '').trim();
  if (!text) return false;
  // Adjuntos: visibles en historial (no filtrar).
  if (
    /Se cargaron archivos/i.test(text) ||
    /Documento adjunto:/i.test(text) ||
    /^Archivo adjunto:/i.test(text)
  ) {
    return false;
  }
  return (
    /GSS\s*Firma/i.test(text) ||
    /v[ií]a\s+GSS\s*Firma/i.test(text) ||
    /Documento firmado v[ií]a/i.test(text) ||
    /complet[oó]\s+su\s+firma/i.test(text) ||
    /turno de firma/i.test(text) ||
    /todos los documentos firmados/i.test(text) ||
    /documento rechazado/i.test(text) ||
    /documento devuelto/i.test(text) ||
    /PDF firmado/i.test(text) ||
    /orionFile:/i.test(text) ||
    /Documento adjunto/i.test(text)
  );
}
