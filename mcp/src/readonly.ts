/**
 * Candado de SOLO LECTURA reforzado por código.
 *
 * Como el MCP REUTILIZA el usuario de base de datos de la app Kronos (que SÍ
 * tiene permisos de escritura), no podemos confiar únicamente en los permisos
 * de la base. Esta guarda garantiza, a nivel de aplicación, que TODA consulta
 * cruda (`$queryRaw` / `Prisma.sql`) sea de lectura:
 *
 *   - Debe empezar por `SELECT` o por un CTE `WITH ... SELECT`.
 *   - No puede contener NINGUNA sentencia de escritura/DDL/ejecución.
 *
 * Las tools que usan la API de modelos de Prisma (`prisma.model.findMany`, etc.)
 * son de lectura POR CONSTRUCCIÓN: el cliente no expone mutaciones desde ellas,
 * por lo que no necesitan pasar por esta guarda. Solo el SQL crudo la requiere.
 */

/**
 * Palabras clave de escritura/DDL/ejecución prohibidas en cualquier consulta
 * cruda. Se detectan como palabra completa (con límites `\b`), sin importar
 * mayúsculas/minúsculas ni espacios/comentarios alrededor.
 */
const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'REPLACE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'DENY',
  'EXEC',
  'EXECUTE',
  'CALL',
  'SP_EXECUTESQL',
  'INTO', // SELECT ... INTO crea/escribe una tabla en SQL Server.
  'BACKUP',
  'RESTORE',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'SET', // SET sin contexto de UPDATE; reservado por seguridad.
  'USE',
] as const;

const FORBIDDEN_RE = new RegExp(`\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

/**
 * Elimina comentarios y normaliza espacios para que un atacante no pueda
 * esconder una sentencia tras comentarios (`/* * /`, `--`) o saltos de línea.
 */
function stripComments(sql: string): string {
  return sql
    // comentarios de bloque /* ... */ (incluye multilínea)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // comentarios de línea -- ... hasta fin de línea
    .replace(/--[^\n\r]*/g, ' ')
    // colapsa cualquier espacio en blanco a uno solo
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valida que `sql` sea una consulta de SOLO LECTURA. Lanza un error claro si no.
 *
 * @param sql Texto SQL crudo (la plantilla, sin los valores parametrizados).
 */
export function assertReadOnlySql(sql: string): void {
  const cleaned = stripComments(sql);

  if (cleaned.length === 0) {
    throw new Error('Candado de solo lectura: consulta vacía no permitida.');
  }

  // Debe empezar por SELECT o por un CTE WITH ... (que termina en SELECT).
  const startsOk = /^(?:SELECT|WITH)\b/i.test(cleaned);
  if (!startsOk) {
    throw new Error(
      'Candado de solo lectura: solo se permiten consultas que empiecen por SELECT o WITH...SELECT.'
    );
  }

  // Un CTE debe desembocar en un SELECT (no en INSERT/UPDATE/DELETE).
  if (/^WITH\b/i.test(cleaned) && !/\bSELECT\b/i.test(cleaned)) {
    throw new Error('Candado de solo lectura: un CTE (WITH) debe terminar en SELECT.');
  }

  const forbidden = FORBIDDEN_RE.exec(cleaned);
  if (forbidden) {
    throw new Error(
      `Candado de solo lectura: la consulta contiene una palabra clave prohibida ("${forbidden[0].toUpperCase()}"). Solo se permiten lecturas.`
    );
  }

  // Defensa adicional: una sola sentencia. Permitimos un ';' final pero no
  // sentencias encadenadas (stacked queries).
  const withoutTrailing = cleaned.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new Error('Candado de solo lectura: no se permiten múltiples sentencias (";").');
  }
}
