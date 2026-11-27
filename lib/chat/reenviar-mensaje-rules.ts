/**
 * REENVIAR UN MENSAJE del chat — reglas puras (2026-11-17).
 *
 * Pedido de Nicolás Rivera: «ayúdame a poder reenviar un mensaje a un chat o a
 * un proyecto». El mensaje reenviado lo publica quien reenvía (es su mensaje en
 * el destino) con una línea que dice de quién era el original, el texto tal
 * cual y una copia de sus adjuntos.
 *
 * Las menciones del texto original se NEUTRALIZAN: si una respuesta decía
 * «@zoe», reenviarla a un proyecto no debe despertar a Zoe. El comentario de
 * quien reenvía sí conserva sus menciones: esas las escribió esa persona.
 */
import { MAX_AGENT_MESSAGE_CHARS } from './constants';
import { MAX_NOTA_REENVIO } from './compartir';

/** Tope del mensaje reenviado: el original más largo posible, el comentario y el encabezado. */
export const MAX_MENSAJE_REENVIADO = MAX_AGENT_MESSAGE_CHARS + MAX_NOTA_REENVIO + 400;

/** Adjuntos que se copian como máximo en un reenvío. */
export const MAX_ADJUNTOS_REENVIO = 10;

/** «@handle» al inicio o tras un espacio → «@⁠handle»: se ve igual y ya no es mención. */
export function neutralizarMenciones(texto: string): string {
  // Mismo criterio que extraerMenciones (lib/chat/groups.ts): una arroba que no
  // va pegada a texto. El WORD JOINER (U+2060) no se ve y corta la mención.
  return texto.replace(/(^|[^\w@.])@(?=[A-Za-z0-9])/g, '$1@\u2060');
}

/** Nombre del autor sin los caracteres que el Markdown interpretaría. */
function nombreSeguro(nombre: string): string {
  const limpio = nombre.replace(/[*_`[\]<>#|\\]/g, '').replace(/\s+/g, ' ').trim();
  return limpio.slice(0, 120) || 'Sin nombre';
}

export function armarCuerpoReenvio(opciones: { nota: string; autor: string; original: string }): string {
  const partes: string[] = [];
  const nota = opciones.nota.trim();
  if (nota) partes.push(nota);
  partes.push(`↪️ **Reenviado · mensaje de ${nombreSeguro(opciones.autor)}**`);
  const original = neutralizarMenciones(opciones.original.trim());
  if (original) partes.push(original);
  return partes.join('\n\n');
}

/** Aviso que ve quien reenvió. */
export function avisoMensajeReenviado(destino: { titulo: string; tipo: 'persona' | 'grupo' | 'proyecto' | 'agente' }): string {
  if (destino.tipo === 'persona') return `Mensaje reenviado a ${destino.titulo}.`;
  return `Mensaje reenviado al ${destino.tipo} ${destino.titulo}.`;
}
