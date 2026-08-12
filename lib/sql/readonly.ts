import type { PrismaClient } from '../../app/generated/prisma';

/**
 * Candado de SOLO LECTURA compartido (front + MCP) para el Constructor de Vistas SQL.
 *
 * Portado de `mcp/src/readonly.ts` (assertReadOnlySql) y REFORZADO para SQL
 * escrito por humanos (más hostil que las plantillas internas del MCP), según
 * la propuesta técnica §4.1:
 *
 *   - SELECT-only: la consulta debe empezar por SELECT o por un CTE WITH ... SELECT.
 *   - Sin múltiples sentencias (stacked queries por ';').
 *   - Sin DDL/DML/EXEC/CALL/etc. (palabra completa).
 *   - Rechazo explícito de xp_/sp_/fn_ , OPENROWSET/OPENQUERY/OPENDATASOURCE,
 *     WAITFOR, SHUTDOWN, RECONFIGURE, DBCC.
 *   - Comentarios (/* * /, --) eliminados ANTES de validar (anti-evasión).
 *   - WHITELIST ESTRICTA: todas las tablas/vistas tras FROM/JOIN deben estar en
 *     el catálogo (`catalog_source`).
 *
 * Funciones PURAS (sin acceso a base de datos): assertReadOnlySql,
 * extractReferencedObjects, assertWhitelist. La función que consulta el catálogo
 * (async, con acceso a Prisma) es `assertReadOnlyAgainstCatalog`.
 */

/**
 * Palabras clave de escritura/DDL/ejecución prohibidas en cualquier consulta cruda.
 * Se detectan como palabra completa (con límites `\b`), sin importar
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
  // --- Refuerzos para SQL escrito por humanos (§4.1) ---
  'WAITFOR',
  'SHUTDOWN',
  'RECONFIGURE',
  'DBCC',
  'OPENROWSET',
  'OPENQUERY',
  'OPENDATASOURCE',
  'OPENXML',
  'BULK',
] as const;

const FORBIDDEN_RE = new RegExp(`\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

/**
 * Prefijos de procedimientos/funciones peligrosos. Se rechaza cualquier
 * identificador que empiece por xp_ , sp_ o fn_ (p. ej. xp_cmdshell,
 * sp_executesql, fn_get_audit_file). El límite `\b` antes del prefijo evita
 * falsos positivos dentro de palabras (p. ej. una columna "resp_final").
 */
const DANGEROUS_PREFIX_RE = /\b(?:xp_|sp_|fn_)/i;

/** Palabras que TERMINAN una referencia de tabla dentro de una cláusula FROM. */
const STOP_WORDS = new Set([
  'where',
  'group',
  'order',
  'having',
  'union',
  'except',
  'intersect',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'apply',
  'on',
  'pivot',
  'unpivot',
  'for',
  'option',
  'go',
]);

/**
 * Elimina comentarios y normaliza espacios para que un atacante no pueda
 * esconder una sentencia tras comentarios (`/* * /`, `--`) o saltos de línea.
 */
export function stripComments(sql: string): string {
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
 * Función PURA (no toca base de datos).
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

  const dangerous = DANGEROUS_PREFIX_RE.exec(cleaned);
  if (dangerous) {
    throw new Error(
      `Candado de solo lectura: no se permiten procedimientos/funciones con prefijo peligroso ("${dangerous[0].toLowerCase()}").`
    );
  }

  // Defensa adicional: una sola sentencia. Permitimos un ';' final pero no
  // sentencias encadenadas (stacked queries).
  const withoutTrailing = cleaned.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new Error('Candado de solo lectura: no se permiten múltiples sentencias (";").');
  }
}

/** Normaliza un identificador de objeto: quita corchetes, comillas y esquema; minúsculas. */
export function normalizeObjectName(token: string): string {
  // Toma la última parte tras el punto (esquema.objeto -> objeto) y limpia [] y "".
  const parts = token.split('.');
  let last = parts[parts.length - 1] ?? '';
  last = last.replace(/[\[\]"'`]/g, '').trim();
  return last.toLowerCase();
}

/**
 * Extrae los nombres de tablas/vistas referenciados tras FROM y JOIN.
 * Función PURA. Devuelve nombres normalizados (sin esquema/corchetes, minúsculas).
 *
 * - Ignora subconsultas/derivadas (`FROM ( SELECT ... )`) y funciones de tabla
 *   (`FROM fn(...)`), cuyos FROM/JOIN internos se recorren igual por el escaneo global.
 * - Excluye los nombres definidos por CTE (`WITH x AS (...)`), que son alias locales.
 * - Recorre listas separadas por comas en la cláusula FROM (`FROM a, b`).
 */
export function extractReferencedObjects(sql: string): string[] {
  const cleaned = stripComments(sql);
  const cteNames = extractCteNames(cleaned);
  const found: string[] = [];

  const re = /\b(?:from|join)\b\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    let i = re.lastIndex;
    const isFrom = /from/i.test(m[0]);

    // Recorre la lista de refs (varias solo tras FROM por comas).
    // Para JOIN normalmente hay una sola ref (seguida de ON/keyword).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      while (i < cleaned.length && cleaned[i] === ' ') i++;
      if (i >= cleaned.length) break;
      if (cleaned[i] === '(') break; // derivada / función de tabla -> se ignora

      // Lee el token de la tabla (identificador: letras, dígitos, _ $ # @ . [ ] " `)
      const start = i;
      while (i < cleaned.length && /[A-Za-z0-9_$#@.\[\]"`]/.test(cleaned[i])) i++;
      const token = cleaned.slice(start, i);
      if (token) {
        const name = normalizeObjectName(token);
        if (name && !cteNames.has(name)) found.push(name);
      }

      // Salta alias / hints (WITH (NOLOCK)) hasta encontrar ',' (sigue lista) o keyword/paren (para).
      let sawComma = false;
      while (i < cleaned.length) {
        while (i < cleaned.length && cleaned[i] === ' ') i++;
        if (i >= cleaned.length) break;
        const ch = cleaned[i];
        if (ch === ',') {
          sawComma = true;
          i++;
          break;
        }
        if (ch === ')' || ch === '(' || ch === ';') break;
        // lee la siguiente palabra
        const ws = i;
        while (i < cleaned.length && /[A-Za-z0-9_$#@]/.test(cleaned[i])) i++;
        const w = cleaned.slice(ws, i).toLowerCase();
        if (w === '') {
          // caracter no identificador (p.ej. '=') -> fin de esta ref
          i++;
          break;
        }
        if (STOP_WORDS.has(w)) {
          // fin de la lista FROM/JOIN
          i = ws; // deja el keyword para el escaneo global si aplica
          break;
        }
        // si no es keyword ni coma, es alias o palabra de hint -> seguir saltando
      }

      if (!isFrom || !sawComma) break; // solo FROM continúa con la lista por comas
    }
  }

  return [...new Set(found)];
}

/** Extrae los nombres definidos por CTE en `WITH x AS (...), y AS (...)`. */
function extractCteNames(cleaned: string): Set<string> {
  const names = new Set<string>();
  if (!/^WITH\b/i.test(cleaned)) return names;
  // Captura "nombre AS (" al inicio de cada CTE. Tolerante a lista de columnas.
  const re = /(?:\bWITH\b|,)\s*([A-Za-z0-9_$#@\[\]"`]+)\s*(?:\([^)]*\))?\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    names.add(normalizeObjectName(m[1]));
  }
  return names;
}

/**
 * WHITELIST ESTRICTA (pura): exige que TODAS las tablas/vistas referenciadas
 * estén en `allowed` (nombres normalizados en minúsculas). Lanza error con la
 * lista de objetos no permitidos.
 */
export function assertWhitelist(sql: string, allowed: Set<string>): void {
  const referenced = extractReferencedObjects(sql);
  if (referenced.length === 0) {
    throw new Error(
      'Whitelist: no se detectó ninguna tabla/vista en la consulta (¿falta FROM?).'
    );
  }
  const notAllowed = referenced.filter((r) => !allowed.has(r));
  if (notAllowed.length > 0) {
    throw new Error(
      `Whitelist: la consulta referencia objetos no autorizados en el catálogo: ${notAllowed.join(
        ', '
      )}. Solo se permiten las fuentes registradas en el catálogo de vistas.`
    );
  }
}

/**
 * Validación COMPLETA contra el catálogo (async, consulta la tabla `catalog_source`):
 * 1) candado de solo lectura + refuerzos, 2) whitelist estricta contra las
 * fuentes activas del catálogo.
 *
 * @param sql   SQL crudo del usuario.
 * @param prisma Cliente Prisma (o cualquier objeto con `catalogSource.findMany`).
 */
export async function assertReadOnlyAgainstCatalog(
  sql: string,
  prisma: PrismaClient
): Promise<void> {
  assertReadOnlySql(sql);
  const sources = await prisma.catalogSource.findMany({
    where: { is_active: true },
    select: { object_name: true },
  });
  const allowed = new Set(sources.map((s) => s.object_name.toLowerCase()));
  assertWhitelist(sql, allowed);
}
