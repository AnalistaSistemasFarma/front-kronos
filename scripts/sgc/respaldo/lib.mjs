/**
 * Respaldo y restauración LÓGICA del esquema `sgc` (SGC documental) — piezas
 * puras y de acceso a la base que comparten respaldar.mjs, restaurar.mjs y
 * verificar.mjs (Sprint 6, procedimiento de respaldo validado).
 *
 * Por qué JavaScript plano: los servidores (serfarma05 y la .230) corren
 * Node 20 sin cargador de TypeScript; estos scripts se copian y se ejecutan
 * allí con el `mssql` del proyecto, igual que los demás scripts de base.
 *
 * La verificación de la CADENA DE FIRMAS replica `lib/sgc/signature/record.ts`
 * (computeRecordHash / verifySignatureChain). Una prueba de Vitest
 * (`lib/sgc/__tests__/s6.endurecimiento.test.ts`) exige que ambas den exactamente el
 * mismo resultado, para que esta copia no se separe de la del sistema.
 */
import { createHash } from 'node:crypto';

export const SGC_SIGNATURE_SCHEMA = 'sgc-firma-electronica/v1';
export const SGC_SIGNATURE_LABELS = { elaboro: 'Elaboró', reviso: 'Revisó', aprobo: 'Aprobó', leyo: 'Leyó', capacito: 'Capacitó' };

/** Migraciones del esquema `sgc` en orden (la de retiro del S0 toca `dbo` y NO se incluye). */
export const SGC_SCHEMA_MIGRATIONS = [
  '20260930110000_sgc_esquema_base',
  '20260930150000_sgc_s1_repositorio',
  '20260930200000_sgc_s2_flujos_tareas_autorizaciones',
  '20260930230000_sgc_s3_firma_pdf_calidad',
  '20261001000000_sgc_s4_divulgacion_capacitacion_vigencia',
  '20261001100000_sgc_s5_relaciones_vencimientos_accesos',
  '20261001200000_sgc_s6_endurecimiento',
  '20261003120000_sgc_correcciones_calidad',
  '20261008100000_sgc_s8_encabezado_listado_maestro',
  '20261008110000_sgc_s9_archivos_relaciones_correo',
  '20261008120000_sgc_s10_capacitacion_opcional',
];

export function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** Convierte la cadena de Prisma (sqlserver://HOST:PUERTO;database=..;user=..) a la configuración de `mssql`. */
export function mssqlConfigFromUrl(url) {
  if (!url || !/^sqlserver:\/\//.test(url)) throw new Error('DATABASE_URL no es una cadena sqlserver:// de Prisma');
  const [hostPart, ...rest] = url.replace(/^sqlserver:\/\//, '').split(';');
  const kv = Object.fromEntries(
    rest.filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
    })
  );
  const [server, port] = hostPart.split(':');
  const unq = (s) => (s || '').replace(/^\{|\}$/g, '');
  return {
    server,
    port: Number(port || 1433),
    database: unq(kv.database || kv['initial catalog']),
    user: unq(kv.user || kv.username),
    password: unq(kv.password),
    options: { encrypt: kv.encrypt === 'true', trustServerCertificate: true, useUTC: true },
    requestTimeout: 300000,
  };
}

/** Lee DATABASE_URL del entorno o de un .env (ENVFILE). Nunca la imprime. */
export function databaseUrlFromEnv(fs) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = process.env.ENVFILE || '.env';
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = text.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`No hay DATABASE_URL en ${file}`);
  return m[1];
}

/** Nombre de esquema seguro (solo letras, números y guion bajo). */
export function assertSchemaName(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error(`Nombre de esquema no válido: ${name}`);
  return name;
}

/**
 * Reescribe el SQL de una migración del esquema `sgc` para aplicarla sobre
 * OTRO esquema (la base temporal de la prueba de restauración). Solo cambia
 * las referencias al esquema; no toca `dbo` ni textos como `sgc_review_alerts`.
 */
export function rewriteSchema(sqlText, target) {
  assertSchemaName(target);
  if (target === 'sgc') return sqlText;
  return sqlText
    // Las migraciones preguntan por un CHECK solo por su nombre; en la MISMA base ese nombre ya existe
    // en `sgc`, así que la pregunta se acota al esquema destino.
    .replace(/(FROM sys\.check_constraints WHERE name = N'[^']+')/g, `$1 AND SCHEMA_NAME(schema_id) = N'${target}'`)
    .replace(/\[sgc\]\./g, `[${target}].`)
    .replace(/\bsgc\.(?=[A-Za-z_[])/g, `${target}.`)
    .replace(/N'sgc'/g, `N'${target}'`)
    .replace(/'sgc'/g, `'${target}'`)
    .replace(/SCHEMA::\[?sgc\]?/gi, `SCHEMA::[${target}]`)
    .replace(/CREATE SCHEMA \[?sgc\]?/gi, `CREATE SCHEMA [${target}]`)
    .replace(/DROP SCHEMA \[?sgc\]?/gi, `DROP SCHEMA [${target}]`);
}

/** Valor normalizado para el JSON del respaldo y para la huella (mismo valor ⇒ mismo texto). */
export function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return { $b64: v.toString('base64') };
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export function normalizeRow(row, columns) {
  const out = {};
  for (const c of columns) out[c] = normalizeValue(row[c]);
  return out;
}

/** Huella de una tabla: SHA-256 de sus filas normalizadas, una por línea, en orden de clave primaria. */
export function tableDigest(rows) {
  const h = createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(r) + '\n');
  return h.digest('hex');
}

/** Orden de inserción que respeta las claves foráneas internas del esquema (padres primero). */
export function topologicalOrder(tables, edges) {
  const names = [...tables].sort();
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of edges) {
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  }
  const out = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (n) => {
    if (done.has(n)) return;
    if (visiting.has(n)) throw new Error(`Ciclo de claves foráneas en ${n}`);
    visiting.add(n);
    for (const p of [...deps.get(n)].sort()) visit(p);
    visiting.delete(n);
    done.add(n);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out;
}

// --- Cadena de firmas (réplica de lib/sgc/signature/record.ts) -------------

export function canonicalJson(value) {
  const norm = (v) => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter((k) => v[k] !== undefined)
          .map((k) => [k, norm(v[k])])
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

const trimOrNull = (s) => (s === null || s === undefined ? null : String(s).trim());
/** Fecha de la base: Date, o texto ISO del respaldo (sin zona = UTC, con hasta 7 decimales). */
const asDate = (d) => {
  if (d instanceof Date) return d;
  const s = String(d);
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
};

export function payloadFromRow(row) {
  return {
    schema: SGC_SIGNATURE_SCHEMA,
    uid: String(row.signature_uid).trim(),
    idCompany: Number(row.id_company),
    idRequest: Number(row.id_request),
    idTask: Number(row.id_task),
    idTaskAssignee: Number(row.id_task_assignee),
    signerEmail: row.signer_email,
    signerName: row.signer_name ?? null,
    meaning: row.meaning,
    meaningLabel: SGC_SIGNATURE_LABELS[row.meaning] ?? row.meaning,
    reason: row.reason,
    signedAt: asDate(row.signed_at).toISOString(),
    content: { kind: row.content_kind, ref: row.content_ref, name: row.content_name, sha256: String(row.content_sha256).trim() },
    authMethod: row.auth_method,
    consentVersion: row.consent_version,
    masterSha256: trimOrNull(row.master_sha256),
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
  };
}

export function computeRecordHash(payload, evidenceSha256, prevRecordHash) {
  return sha256Hex(`${canonicalJson(payload)}\n${evidenceSha256}\n${prevRecordHash ?? 'GENESIS'}`);
}

export function verifySignatureRow(row) {
  return computeRecordHash(payloadFromRow(row), String(row.evidence_sha256).trim(), trimOrNull(row.prev_record_hash)) === String(row.record_hash).trim();
}

/** Verifica la cadena de UNA empresa (filas en orden de id_signature). */
export function verifySignatureChain(rows) {
  let prev = null;
  for (const r of rows) {
    const uid = String(r.signature_uid).trim();
    if (!verifySignatureRow(r)) return { ok: false, checked: rows.length, brokenAt: uid, problem: 'El registro no coincide con su huella (fue alterado).' };
    if (trimOrNull(r.prev_record_hash) !== prev) return { ok: false, checked: rows.length, brokenAt: uid, problem: 'La cadena de firmas está rota (falta o sobra un registro).' };
    prev = String(r.record_hash).trim();
  }
  return { ok: true, checked: rows.length, brokenAt: null, problem: null };
}

/** Verifica las cadenas de todas las empresas presentes en las filas de sgc.signature. */
export function verifyAllChains(rows) {
  const byCompany = new Map();
  for (const r of [...rows].sort((a, b) => Number(a.id_signature) - Number(b.id_signature))) {
    const k = Number(r.id_company);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(r);
  }
  return [...byCompany.entries()].map(([idCompany, list]) => ({ idCompany, ...verifySignatureChain(list) }));
}

// --- Catálogo de la base -----------------------------------------------------

/** Tablas, columnas, clave primaria e identidad de un esquema. */
export async function readCatalog(pool, schema) {
  assertSchemaName(schema);
  const cols = (
    await pool.request().input('s', schema).query(`
      SELECT t.name AS tbl, c.name AS col, c.column_id, ty.name AS type, c.max_length, c.precision, c.scale,
             c.is_nullable, c.is_identity
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE s.name = @s
      ORDER BY t.name, c.column_id`)
  ).recordset;
  const pks = (
    await pool.request().input('s', schema).query(`
      SELECT t.name AS tbl, c.name AS col, ic.key_ordinal
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
      WHERE s.name = @s
      ORDER BY t.name, ic.key_ordinal`)
  ).recordset;
  const fks = (
    await pool.request().input('s', schema).query(`
      SELECT tc.name AS child, tp.name AS parent
      FROM sys.foreign_keys fk
      JOIN sys.tables tc ON tc.object_id = fk.parent_object_id
      JOIN sys.tables tp ON tp.object_id = fk.referenced_object_id
      WHERE SCHEMA_NAME(tc.schema_id) = @s AND SCHEMA_NAME(tp.schema_id) = @s`)
  ).recordset;
  const tables = new Map();
  for (const c of cols) {
    if (!tables.has(c.tbl)) tables.set(c.tbl, { name: c.tbl, columns: [], pk: [], identity: null });
    const t = tables.get(c.tbl);
    t.columns.push({ name: c.col, type: c.type, maxLength: c.max_length, precision: c.precision, scale: c.scale, nullable: !!c.is_nullable });
    if (c.is_identity) t.identity = c.col;
  }
  for (const p of pks) tables.get(p.tbl)?.pk.push(p.col);
  return { tables, fks };
}

/** Estructura comparable de un esquema: columnas, índices, CHECK, FK y triggers (sin nombres de esquema). */
export async function readStructure(pool, schema) {
  assertSchemaName(schema);
  const q = async (text) => (await pool.request().input('s', schema).query(text)).recordset;
  const columns = await q(`SELECT t.name tbl, c.name col, ty.name type, c.max_length len, c.precision prec, c.scale sc, c.is_nullable nul, c.is_identity ident
    FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    WHERE SCHEMA_NAME(t.schema_id)=@s ORDER BY t.name, c.column_id`);
  const indexes = await q(`SELECT t.name tbl, i.name idx, i.is_unique uq, i.is_primary_key pk, ISNULL(i.filter_definition,'') filt,
      STUFF((SELECT ','+c.name+CASE WHEN ic.is_descending_key=1 THEN ' DESC' ELSE '' END+CASE WHEN ic.is_included_column=1 THEN ' INC' ELSE '' END
             FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
             WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id ORDER BY ic.is_included_column, ic.key_ordinal, c.name FOR XML PATH('')),1,1,'') cols
    FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id WHERE SCHEMA_NAME(t.schema_id)=@s AND i.type>0 ORDER BY t.name, i.name`);
  const checks = await q(`SELECT t.name tbl, cc.name chk, cc.definition def FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id=cc.parent_object_id
    WHERE SCHEMA_NAME(t.schema_id)=@s ORDER BY t.name, cc.name`);
  const foreignKeys = await q(`SELECT tc.name tbl, fk.name fk, SCHEMA_NAME(tp.schema_id) psch, tp.name ptbl FROM sys.foreign_keys fk
    JOIN sys.tables tc ON tc.object_id=fk.parent_object_id JOIN sys.tables tp ON tp.object_id=fk.referenced_object_id
    WHERE SCHEMA_NAME(tc.schema_id)=@s ORDER BY tc.name, fk.name`);
  const triggers = await q(`SELECT t.name tbl, tr.name trg, tr.is_disabled dis, OBJECTPROPERTY(tr.object_id,'ExecIsInsteadOfTrigger') instead_of
    FROM sys.triggers tr JOIN sys.tables t ON t.object_id=tr.parent_id WHERE SCHEMA_NAME(t.schema_id)=@s ORDER BY t.name, tr.name`);
  // El esquema de la FK hacia sí mismo se normaliza para comparar sgc contra la copia.
  for (const f of foreignKeys) if (f.psch === schema) f.psch = '<propio>';
  return { columns, indexes, checks, foreignKeys, triggers };
}

/** Diferencias entre dos estructuras (vacío = idénticas). */
export function diffStructures(a, b) {
  const out = [];
  for (const k of ['columns', 'indexes', 'checks', 'foreignKeys', 'triggers']) {
    const sa = new Set(a[k].map((r) => JSON.stringify(r)));
    const sb = new Set(b[k].map((r) => JSON.stringify(r)));
    for (const x of sa) if (!sb.has(x)) out.push({ kind: k, only: 'origen', item: JSON.parse(x) });
    for (const x of sb) if (!sa.has(x)) out.push({ kind: k, only: 'copia', item: JSON.parse(x) });
  }
  return out;
}

/** Filas de una tabla en orden de clave primaria. */
export async function readRows(pool, schema, table) {
  assertSchemaName(schema);
  const order = table.pk.length ? table.pk : table.columns.map((c) => c.name);
  // Fechas como texto ISO EXACTO (datetime2 guarda hasta 100 ns; un Date de JavaScript solo ms).
  const cols = table.columns
    .map((c) =>
      c.type === 'datetime2' || c.type === 'datetime'
        ? `CONVERT(VARCHAR(33), [${c.name}], 126) AS [${c.name}]`
        : c.type === 'date'
          ? `CONVERT(VARCHAR(10), [${c.name}], 23) AS [${c.name}]`
          : `[${c.name}]`
    )
    .join(', ');
  const r = await pool.request().query(`SELECT ${cols} FROM [${schema}].[${table.name}] ORDER BY ${order.map((c) => `[${c}]`).join(', ')}`);
  return r.recordset;
}

/** Tipo de `mssql` para insertar un valor de la columna. */
export function mssqlType(sql, col) {
  switch (col.type) {
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'smallint': return sql.SmallInt;
    case 'tinyint': return sql.TinyInt;
    case 'bit': return sql.Bit;
    // Las fechas viajan como texto ISO exacto y SQL Server las convierte al insertar.
    case 'date':
    case 'datetime':
    case 'datetime2': return sql.VarChar(40);
    case 'decimal':
    case 'numeric': return sql.Decimal(col.precision, col.scale);
    case 'float': return sql.Float;
    case 'char': return sql.Char(col.maxLength);
    case 'nchar': return sql.NChar(col.maxLength / 2);
    case 'varchar': return col.maxLength === -1 ? sql.VarChar(sql.MAX) : sql.VarChar(col.maxLength);
    case 'nvarchar': return col.maxLength === -1 ? sql.NVarChar(sql.MAX) : sql.NVarChar(col.maxLength / 2);
    case 'varbinary': return col.maxLength === -1 ? sql.VarBinary(sql.MAX) : sql.VarBinary(col.maxLength);
    case 'uniqueidentifier': return sql.UniqueIdentifier;
    default: throw new Error(`Tipo de columna no soportado en el respaldo: ${col.type}`);
  }
}

/** Valor del JSON del respaldo listo para insertar. */
export function denormalizeValue(v, col) {
  if (v === null || v === undefined) return null;
  if (v && typeof v === 'object' && '$b64' in v) return Buffer.from(v.$b64, 'base64');
  if (col.type === 'datetime2' || col.type === 'datetime' || col.type === 'date') return v instanceof Date ? v.toISOString() : String(v);
  return v;
}
