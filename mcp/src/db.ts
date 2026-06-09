/**
 * Acceso a datos. Reutiliza el MISMO esquema Prisma del repo front-kronos
 * (cliente generado en ../app/generated/prisma). No se duplica el schema.
 *
 * En PRODUCCIÓN, la DATABASE_URL que use este servidor debe apuntar a un
 * usuario SQL de SOLO LECTURA / mínimo privilegio. El servidor MCP NUNCA se
 * conecta con la identidad del agente: usa su propio acceso, igual para todos.
 *
 * NOTA: el modelo Prisma del repo es PARCIAL frente a la base real (p.ej. la
 * tabla `requests_general` no está modelada, y `case.company` / `notes.created_by`
 * existen en la DB pero no en el schema). Por eso las consultas con alcance de
 * empresa usan $queryRaw parametrizado (Prisma.sql), que respeta el mismo
 * cliente y parametriza de forma segura.
 */
import { PrismaClient, Prisma } from '../../app/generated/prisma/index.js';
import { assertReadOnlySql } from './readonly.js';

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

/** Permite inyectar un cliente mock en pruebas. */
export function setPrisma(mock: PrismaClient): void {
  client = mock;
}

/**
 * Ejecuta una consulta cruda (Prisma.sql) GARANTIZANDO que es de solo lectura.
 *
 * TODO el SQL crudo del MCP debe pasar por aquí (NUNCA llamar `$queryRaw`
 * directamente desde las tools). Antes de ejecutar, valida con
 * `assertReadOnlySql` la plantilla SQL (sin los valores parametrizados, que
 * siguen viajando como parámetros — no se concatenan). Si la consulta no es de
 * lectura, lanza un error y NO ejecuta nada.
 *
 * Como el MCP reutiliza un usuario de base de datos con permisos de escritura,
 * esta guarda es la línea de defensa principal contra cualquier escritura.
 */
export async function queryReadOnly<T = unknown>(sql: Prisma.Sql): Promise<T[]> {
  // Prisma.Sql expone `.sql` (plantilla con placeholders) y `.values` (params).
  // Validamos solo la plantilla; los valores nunca se interpolan en el texto.
  assertReadOnlySql(sql.sql);
  return getPrisma().$queryRaw<T[]>(sql);
}

export { Prisma };
export type { PrismaClient };
