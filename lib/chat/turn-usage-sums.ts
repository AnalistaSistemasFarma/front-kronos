import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import type { AuditScope } from './audit-access';

/**
 * SUMAS DE CONSUMO DE `chat_agent_turn_usage` SIN DESBORDE.
 *
 * Las columnas de tokens son `INT` y SQL Server suma un `INT` como `INT`: en
 * cuanto el total de un grupo pasa de 2.147.483.647 la consulta entera falla
 * con «Arithmetic overflow error converting expression to data type int»
 * (Prisma P2020). Pasó en producción el 2026-10-21: la lectura de caché de un
 * solo agente ya suma más de 3.900 millones y `GET /api/dashboard/agentes`
 * respondía 500 sin filtro de fechas.
 *
 * El `groupBy` de Prisma no deja convertir antes de sumar, así que la suma se
 * hace con SQL parametrizado y `SUM(CAST(col AS BIGINT))`, sin tocar el
 * esquema. El driver devuelve el BIGINT como `bigint`; se pasa a `number`
 * (cabe holgado: el entero seguro de JavaScript llega a unos 9.000 billones)
 * porque `JSON.stringify` no sabe serializar un `bigint`.
 *
 * Los filtros reproducen los `where` que usaban las rutas con Prisma:
 * fechas sobre `created_at`, agente, conversación, alcance de auditoría
 * (`conversationScopeWhere`) y empresa del hilo.
 */

export type ConsumoTurnos = {
  turnos: number;
  totalTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

export type FiltroConsumo = {
  desde?: Date | null;
  hasta?: Date | null;
  idAgent?: number | null;
  idConversation?: number | null;
  /** Alcance de auditoría; `{ all: true }` = sin restricción. */
  alcance: AuditScope;
  /** Empresa del hilo: la del grupo, o una de las del agente en un hilo directo. */
  idCompany?: number | null;
};

type Agrupacion = 'id_agent' | 'id_conversation';

/** `bigint` | `number` | string | null del driver → `number` (0 si no hay valor). */
export function aNumero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `col IN (...)`; una lista vacía no coincide con nada, igual que `in: []` de Prisma. */
function enLista(columna: Prisma.Sql, ids: number[]): Prisma.Sql {
  return ids.length ? Prisma.sql`${columna} IN (${Prisma.join(ids)})` : Prisma.sql`1 = 0`;
}

/** Arma la consulta. Separada de la ejecución para poder probarla sin base. */
export function consultaConsumoTurnos(por: Agrupacion, f: FiltroConsumo): Prisma.Sql {
  const clave = por === 'id_agent' ? Prisma.sql`u.id_agent` : Prisma.sql`u.id_conversation`;
  const condiciones: Prisma.Sql[] = [];

  if (f.desde) condiciones.push(Prisma.sql`u.created_at >= ${f.desde}`);
  if (f.hasta) condiciones.push(Prisma.sql`u.created_at <= ${f.hasta}`);
  if (f.idAgent) condiciones.push(Prisma.sql`u.id_agent = ${f.idAgent}`);
  if (f.idConversation) condiciones.push(Prisma.sql`u.id_conversation = ${f.idConversation}`);

  if (!f.alcance.all) {
    condiciones.push(Prisma.sql`(
      (c.kind = 'direct' AND ${enLista(Prisma.sql`c.id_agent`, f.alcance.agentIds)})
      OR (c.kind = 'group' AND ${enLista(Prisma.sql`c.id_company`, f.alcance.companyIds)})
    )`);
  }

  if (f.idCompany) {
    condiciones.push(Prisma.sql`(
      (c.kind = 'group' AND c.id_company = ${f.idCompany})
      OR (c.kind = 'direct' AND EXISTS (
        SELECT 1 FROM [agent_company] ac
        WHERE ac.id_agent = c.id_agent AND ac.id_company = ${f.idCompany}
      ))
    )`);
  }

  const where = condiciones.length
    ? Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`
    : Prisma.empty;

  return Prisma.sql`
    SELECT ${clave} AS clave,
      COUNT_BIG(*) AS turnos,
      SUM(CAST(u.total_tokens AS BIGINT)) AS total_tokens,
      SUM(CAST(u.input_tokens AS BIGINT)) AS input_tokens,
      SUM(CAST(u.cache_creation_tokens AS BIGINT)) AS cache_creation_tokens,
      SUM(CAST(u.cache_read_tokens AS BIGINT)) AS cache_read_tokens,
      SUM(CAST(u.output_tokens AS BIGINT)) AS output_tokens,
      SUM(CAST(u.thinking_tokens AS BIGINT)) AS thinking_tokens
    FROM [chat_agent_turn_usage] u
    INNER JOIN [chat_conversation] c ON c.id = u.id_conversation
    ${where}
    GROUP BY ${clave}
  `;
}

type FilaConsumo = {
  clave: number;
  turnos: unknown;
  total_tokens: unknown;
  input_tokens: unknown;
  cache_creation_tokens: unknown;
  cache_read_tokens: unknown;
  output_tokens: unknown;
  thinking_tokens: unknown;
};

/** Consumo agrupado por agente o por conversación, como `number` listo para JSON. */
export async function consumoTurnosPor(
  por: Agrupacion,
  f: FiltroConsumo
): Promise<Array<ConsumoTurnos & { clave: number }>> {
  const filas = await prisma.$queryRaw<FilaConsumo[]>(consultaConsumoTurnos(por, f));
  return filas.map((r) => ({
    clave: aNumero(r.clave),
    turnos: aNumero(r.turnos),
    totalTokens: aNumero(r.total_tokens),
    inputTokens: aNumero(r.input_tokens),
    cacheCreationTokens: aNumero(r.cache_creation_tokens),
    cacheReadTokens: aNumero(r.cache_read_tokens),
    outputTokens: aNumero(r.output_tokens),
    thinkingTokens: aNumero(r.thinking_tokens),
  }));
}
