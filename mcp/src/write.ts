/**
 * Camino de ESCRITURA acotado y SEPARADO del candado de solo lectura.
 *
 * IMPORTANTE: este módulo NO toca `assertReadOnlySql` ni `queryReadOnly`. Las 11
 * tools de lectura siguen pasando, intactas, por el candado de solo lectura
 * (`src/readonly.ts` → `queryReadOnly` en `src/db.ts`). Este camino es exclusivo
 * de las DOS tools de escritura de categorización (kronos_categorize_case y
 * kronos_categorize_request) y de NADA más.
 *
 * Diseño:
 * - Usa el MISMO PrismaClient del repo (vía `getPrisma()`), no abre una segunda
 *   conexión ni cambia de usuario.
 * - Toda la lógica de una tool de escritura corre dentro de UNA transacción
 *   (`prisma.$transaction`), de modo que validaciones + escritura sean atómicas:
 *   si una validación falla, se lanza y NADA se persiste.
 *   • `tx.$queryRaw` para los SELECT de validación dentro de la transacción.
 *   • `tx.$executeRaw` para los UPDATE/INSERT.
 * - TODOS los valores viajan PARAMETRIZADOS con `Prisma.sql` (interpolación de
 *   plantilla de Prisma), nunca concatenados. No existe construcción de SQL por
 *   string crudo aquí.
 *
 * Por qué un módulo aparte y no `queryReadOnly`: el candado de solo lectura es
 * la línea de defensa principal de las tools de consulta. Debilitarlo (añadir
 * excepciones para UPDATE/INSERT) abriría una grieta para las 11 tools de
 * lectura. En su lugar, la escritura tiene su propia puerta, estrecha y
 * auditada, que solo invocan las dos tools de categorización.
 */
import type { Prisma as PrismaNS, PrismaClient } from '../../app/generated/prisma/index.js';
import { getPrisma } from './db.js';

/**
 * Cliente transaccional de Prisma (el `tx` que recibe el callback de
 * `$transaction`). Expone `$queryRaw` y `$executeRaw` parametrizados.
 */
export type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Ejecuta una unidad de trabajo de escritura dentro de una transacción.
 *
 * El callback recibe el cliente transaccional `tx`. Cualquier error que se lance
 * dentro hace rollback automático de toda la transacción (validaciones +
 * escrituras), por lo que las validaciones de existencia/alcance/coherencia que
 * lancen antes del UPDATE garantizan que no se escriba nada inválido.
 *
 * Esta función es el ÚNICO punto del MCP donde se permiten `$executeRaw`.
 */
export async function executeWrite<T>(
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  const prisma = getPrisma();
  return prisma.$transaction(fn);
}

/** Re-exporta el namespace Prisma para construir `Prisma.sql` parametrizado. */
export type { PrismaNS };
