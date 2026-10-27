/**
 * ARCHIVOS QUE GENERA EL AGENTE en el chat de un proyecto (2026-10-23).
 *
 * Requisito de Nicolás Rivera (2026-10-23 14:12 COT): «todos los documentos que
 * genere desde el chat de un proyecto deben archivarse en los Archivos del
 * proyecto». Aplica a todos los agentes, usuarios y proyectos.
 *
 * Reglas puras (sin servidor), con pruebas:
 *  - Un nombre que ya existe en el proyecto NO se pisa ni se repite en silencio:
 *    se le suma un sufijo de versión, «informe.pdf» → «informe (2).pdf».
 *  - La comparación ignora mayúsculas (OneDrive tampoco las distingue).
 */
import { MAX_CHAT_ATTACHMENT_NAME_CHARS } from '../chat/attachments';

/** Separa «base» y «.ext» (la extensión solo si es corta y no es todo el nombre). */
function partir(nombre: string): { base: string; ext: string } {
  const punto = nombre.lastIndexOf('.');
  if (punto > 0 && nombre.length - punto <= 12) return { base: nombre.slice(0, punto), ext: nombre.slice(punto) };
  return { base: nombre, ext: '' };
}

/**
 * Nombre que no choca con `ocupados` (en minúsculas). Si `nombre` está libre se
 * devuelve igual; si no, «base (n).ext» con el primer n ≥ 2 libre. Respeta el
 * largo máximo de nombre del chat recortando la base, nunca la extensión.
 */
export function nombreSinChoque(nombre: string, ocupados: ReadonlySet<string>): string {
  if (!ocupados.has(nombre.toLowerCase())) return nombre;
  const { base, ext } = partir(nombre);
  // Si ya trae « (n)», se sigue contando desde ahí («informe (2).pdf» → «informe (3).pdf»).
  const previo = /^(.*) \((\d{1,4})\)$/.exec(base);
  const raiz = previo ? previo[1] : base;
  for (let n = previo ? Number(previo[2]) + 1 : 2; n < 10_000; n++) {
    const sufijo = ` (${n})`;
    const cabe = Math.max(1, MAX_CHAT_ATTACHMENT_NAME_CHARS - ext.length - sufijo.length);
    const candidato = `${raiz.slice(0, cabe)}${sufijo}${ext}`;
    if (!ocupados.has(candidato.toLowerCase())) return candidato;
  }
  // Inalcanzable con el tope de archivos por proyecto; por si acaso, una marca de tiempo.
  return `${raiz.slice(0, 80)} (${Date.now()})${ext}`;
}

/**
 * Nombres finales de un lote: cada uno sin chocar con lo que ya hay en el
 * proyecto NI con los anteriores del mismo lote.
 */
export function nombresDelLote(nombres: string[], existentes: string[]): string[] {
  const ocupados = new Set(existentes.map((n) => n.toLowerCase()));
  return nombres.map((n) => {
    const final = nombreSinChoque(n, ocupados);
    ocupados.add(final.toLowerCase());
    return final;
  });
}

/** Texto de autoría de un archivo que subió un agente («Orus · conversación 27»). */
export function autoriaAgente(nombreAgente: string | null, idConversation: number | null): string {
  const quien = nombreAgente?.trim() || 'el asistente';
  return idConversation ? `subido por ${quien} en la conversación ${idConversation}` : `subido por ${quien}`;
}
