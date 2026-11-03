import { prisma } from '../prisma';

/**
 * Cuántas entregas pendientes se leen por tanda del índice
 * `chat_message_delivery_pendiente_idx` antes de filtrarlas por conversación.
 * Muy por debajo del tope de 2.100 parámetros de SQL Server.
 */
export const ENTREGAS_PENDIENTES_TANDA = 200;

/**
 * Mensajes con una ENTREGA PENDIENTE de este agente (fila de
 * `chat_message_delivery` con `delivered_at` en null) que además cumplen un
 * filtro sobre el mensaje o su conversación (tipo, proyecto…), en orden de
 * `id_message` ascendente y como máximo `limit`.
 *
 * POR QUÉ EN DOS PASOS (incidente 2026-11-03, CPU de KRONOSDB al 97–99 %):
 * escrito como UNA consulta Prisma
 * (`chatMessageDelivery.findMany({ where: { id_agent, delivered_at: null,
 * message: { conversation: { kind } } }, orderBy: id_message, take })`), Prisma
 * lo traduce a un LEFT JOIN chat_message + chat_conversation con
 * ORDER BY id_message OFFSET/FETCH, y SQL Server puede elegir recorrer
 * `chat_message` entero en orden de PK buscando la primera fila que cumpla.
 * Como casi nunca hay ninguna, el TOP no corta y cada sondeo leía las ~28.000
 * filas (≈100 ms de CPU) — 40 veces por segundo.
 *
 * Aquí el plan no tiene de dónde equivocarse:
 *   1. Entregas pendientes de ESTE agente, solo por el índice
 *      (id_agent, delivered_at, id_message). Son pocas.
 *   2. Los mensajes de esos ids (`id IN (…)`, búsqueda por la PK) con el
 *      filtro de conversación, vía `buscar`. Nunca recorre `chat_message`.
 *
 * El resultado es idéntico al de la consulta original: si una tanda no alcanza
 * a llenar `limit` (entregas de otras conversaciones que no pasan el filtro),
 * se pide la siguiente tanda a partir del último id visto, hasta llenar o
 * agotar las pendientes.
 *
 * `buscar(ids, take)` debe devolver los mensajes de `ids` que pasan el filtro,
 * ordenados por id ascendente y como máximo `take`; así cada llamador conserva
 * su `include` y sus tipos.
 */
export async function mensajesConEntregaPendiente<T extends { id: number }>(
  idAgent: number,
  limit: number,
  buscar: (ids: number[], take: number) => Promise<T[]>,
): Promise<T[]> {
  const resultado: T[] = [];
  let desde: number | null = null;

  while (resultado.length < limit) {
    const tanda: { id_message: number }[] = await prisma.chatMessageDelivery.findMany({
      where: {
        // ANCLA DE SEGURIDAD: las entregas son de ESTE agente.
        id_agent: idAgent,
        delivered_at: null,
        ...(desde !== null ? { id_message: { gt: desde } } : {}),
      },
      orderBy: { id_message: 'asc' },
      take: ENTREGAS_PENDIENTES_TANDA,
      select: { id_message: true },
    });
    if (tanda.length === 0) break;

    const ids = tanda.map((t) => t.id_message);
    const mensajes = await buscar(ids, limit - resultado.length);
    resultado.push(...mensajes);

    if (tanda.length < ENTREGAS_PENDIENTES_TANDA) break;
    desde = ids[ids.length - 1];
  }

  return resultado.slice(0, limit);
}
