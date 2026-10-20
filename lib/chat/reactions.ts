import 'server-only';
import { prisma } from '../prisma';
import { MAX_REACCIONES_POR_PERSONA } from './reactions-catalog';
import { ExtrasNoDisponibles, reaccionesDe, tablaAusente } from './message-extras';
import type { ChatReactionDto } from './media-rules';

/**
 * PONER o QUITAR una reacción (2026-10-20).
 *
 * Cada cambio BORRA la fila de esa llave (mensaje, persona, emoji) y crea otra:
 * así el `id` crece con cada cambio —también al quitar, que deja una lápida con
 * `active = false`— y el sondeo del hilo y el pulso lo detectan con un MAX(id)
 * barato, sin columnas de «modificado» ni un sondeo propio. Ver el modelo
 * ChatMessageReaction en prisma/schema.prisma.
 *
 * LAS REACCIONES NO DESPIERTAN AL AGENTE: aquí no se crean entregas
 * (chat_message_delivery) ni se toca `delivered_at`, así que ninguna bandeja
 * de agente las ve y no se gasta un turno por un 👍. Es la recomendación; si
 * Nicolás decide otra cosa, el cambio va aquí.
 */

export type AccionReaccion = 'add' | 'remove' | 'toggle';

export class ReaccionError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ReaccionError';
  }
}

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Aplica la reacción y devuelve el resumen VIGENTE del mensaje para quien
 * reaccionó. El mensaje ya debe estar validado contra la conversación.
 */
export async function cambiarReaccion(params: {
  idConversation: number;
  idMessage: number;
  idUser: string;
  emoji: string;
  accion: AccionReaccion;
}): Promise<ChatReactionDto[]> {
  const { idConversation, idMessage, idUser, emoji, accion } = params;
  try {
    await prisma.$transaction(async (tx) => {
      const actual = await tx.chatMessageReaction.findUnique({
        where: { id_message_id_user_emoji: { id_message: idMessage, id_user: idUser, emoji } },
        select: { id: true, active: true },
      });
      const yaActiva = Boolean(actual?.active);
      const quiereActiva = accion === 'add' ? true : accion === 'remove' ? false : !yaActiva;
      // Nada que cambiar: idempotente (dos clics rápidos no duplican nada).
      if (quiereActiva === yaActiva) return;

      if (quiereActiva) {
        const otras = await tx.chatMessageReaction.count({
          where: { id_message: idMessage, id_user: idUser, active: true },
        });
        if (otras >= MAX_REACCIONES_POR_PERSONA) {
          throw new ReaccionError(`Puede poner hasta ${MAX_REACCIONES_POR_PERSONA} reacciones distintas por mensaje.`, 400);
        }
      }

      if (actual) await tx.chatMessageReaction.delete({ where: { id: actual.id } });
      await tx.chatMessageReaction.create({
        data: {
          id_message: idMessage,
          id_conversation: idConversation,
          id_user: idUser,
          emoji,
          active: quiereActiva,
        },
      });
    });
  } catch (error) {
    if (error instanceof ReaccionError) throw error;
    if (tablaAusente(error)) throw new ExtrasNoDisponibles();
    // Dos pestañas de la misma persona al mismo tiempo: la otra ya dejó la
    // fila. No es un error para quien toca: se devuelve el estado vigente.
    if (!esDuplicado(error)) throw error;
  }
  return (await reaccionesDe([idMessage], idUser)).get(idMessage) ?? [];
}

/** Lee la acción del cuerpo: por defecto 'toggle'. */
export function leerAccion(valor: unknown): AccionReaccion | null {
  if (valor === undefined || valor === null || valor === '') return 'toggle';
  return valor === 'add' || valor === 'remove' || valor === 'toggle' ? valor : null;
}
