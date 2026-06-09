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

export { Prisma };
export type { PrismaClient };
