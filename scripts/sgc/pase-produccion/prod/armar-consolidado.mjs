#!/usr/bin/env node
/**
 * Arma el SQL CONSOLIDADO del pase del SGC documental a producción a partir de
 * los archivos del repositorio, sin copiar ni reescribir su contenido. Cada
 * componente va en su propio lote (GO), precedido de un lote de GUARDIA que
 * hace THROW si la base no es la esperada. Pensado para correrse con
 * scripts/sgc/pase-produccion/aplicar-sql.mjs, que se detiene en el primer error.
 *
 * Salida (en --out, por defecto scripts/sgc/pase-produccion/prod/salida):
 *   F0-verificacion-previa.sql   solo lectura; THROW si algo no está como se espera
 *   F1-ddl-antes-del-codigo.sql  esquema sgc del primer pase (S0–S13: 14 migraciones, idempotentes)
 *   F2-despues-del-codigo.sql    retiro del módulo viejo, registro de migraciones,
 *                                datos de OLP y correo de avisos apagado
 *   R1-reversa-sgc.sql           reversa del SGC (datos + esquema), de la más nueva a la más antigua
 *   R2-restaurar-modulo-viejo.sql  recrea las tablas del módulo documental viejo y sus
 *                                subprocesos; SOLO si también se revierte el código
 *   MANIFIESTO.txt               SHA-256 de cada componente y de cada salida
 *
 * Uso:
 *   node scripts/sgc/pase-produccion/prod/armar-consolidado.mjs \
 *     [--db KRONOSDB] [--server SERFARMA03] \
 *     [--integrante-copias <correo>] [--sustituto1 <correo>] [--sustituto2 <correo>] \
 *     [--programador no|si] [--acepto-perdidas] [--out <carpeta>]
 *
 * --programador no (por defecto): el SQL del S5 NO crea el job sgc_review_alerts
 *   aunque dbo.scheduled_job exista (en KRONOSDB existe desde el 2026-10-01).
 * --acepto-perdidas: la reversa R1 declara en la sesión las banderas con que
 *   cada reversa acepta borrar datos. Sin ella, una reversa con datos se detiene.
 * Para un ENSAYO sobre una copia restaurada: --db KRONOSDB_ENSAYO_SGC --server SERFARMA03.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const DB = opt('db', 'KRONOSDB');
const SERVER = opt('server', 'SERFARMA03');
const COPIAS = opt('integrante-copias', null);
const SUST1 = opt('sustituto1', null);
const SUST2 = opt('sustituto2', null);
const PROGRAMADOR = opt('programador', 'no');
const ACEPTO = flag('acepto-perdidas');
const OUT = opt('out', 'scripts/sgc/pase-produccion/prod/salida');
if (!['si', 'no'].includes(PROGRAMADOR)) throw new Error('--programador debe ser si o no');
const email = (v) => {
  if (v === null) return 'NULL';
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) throw new Error(`Correo inválido: ${v}`);
  return `N'${v.toLowerCase()}'`;
};

const sha = (t) => createHash('sha256').update(t).digest('hex');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const guard = (etiqueta) => `/* GUARDIA · ${etiqueta} */
IF DB_NAME() <> N'${DB}' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'${SERVER}'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en ${DB} de ${SERVER}. No se ejecutó nada.', 1;`;
const manifest = [];
const part = (archivo, texto) => {
  manifest.push(`${sha(texto)}  ${archivo}`);
  return `${guard(archivo)}\nGO\n/* ===== ${archivo} ===== */\n${texto.trim()}\nGO`;
};
const file = (p) => part(p, read(p));
// Componente condicional: cada lote (separado por GO) corre con sp_executesql solo si se cumple `cond`.
const partCond = (archivo, texto, cond) => {
  manifest.push(`${sha(texto)}  ${archivo}`);
  const lotes = texto.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
  const cuerpo = lotes
    .map((b) => `IF ${cond}\n  EXEC sp_executesql N'${conFlags(b).replace(/'/g, "''")}';\nELSE PRINT N'${path.basename(archivo)}: nada que revertir, se omite.';`)
    .join('\nGO\n');
  return `${guard(archivo)}\nGO\n/* ===== ${archivo} (condicional: ${cond}) ===== */\n${cuerpo}\nGO`;
};
const replaceOnce = (texto, de, a, archivo) => {
  const n = texto.split(de).length - 1;
  if (n !== 1) throw new Error(`${archivo}: se esperaba 1 ocurrencia de «${de}» y hay ${n}`);
  return texto.replace(de, a);
};

const MIG = 'prisma/migrations';
const MAN = 'prisma/manual';
const SQLD = 'scripts/sgc/pase-produccion/sql';
// El consolidado es el del PRIMER pase del SGC (S0–S13, en producción desde el
// 2026-10-10). Las migraciones posteriores (S14 en adelante) van en su propio
// pase con aplicar-sql.mjs, así que se corta en la última del S13: si no, el
// conteo de migraciones y de tablas de F1 y la reversa R1 dejan de cuadrar.
const ULTIMA_MIGRACION_CONSOLIDADO = '20261008150000_sgc_s13_firma_propia_registro';
const migraciones = fs.readdirSync(MIG).filter((d) => /_sgc_/.test(d) && d <= ULTIMA_MIGRACION_CONSOLIDADO).sort();
const ddl = migraciones.filter((d) => d !== '20260930100000_sgc_s0_retiro_gestion_documental');
if (ddl.length !== 14) throw new Error(`Se esperaban 14 migraciones DDL del SGC y hay ${ddl.length}`);

const encabezado = (titulo, extra = '') => `/*
  ${titulo}
  Generado por scripts/sgc/pase-produccion/prod/armar-consolidado.mjs el ${new Date().toISOString().slice(0, 10)}.
  Base esperada: ${DB} en ${SERVER} (cada lote empieza con una guardia que hace THROW si no coincide).
  Correr SOLO con aplicar-sql.mjs (se detiene en el primer error) y con la autorización del pase.${extra}
*/
SET NOCOUNT ON;
GO`;

// ---------- F0 ----------
const f0 = [encabezado('PASE SGC · F0 · VERIFICACIÓN PREVIA (solo lectura)'), file(`${SQLD}/00-verificacion-previa.sql`)];

// ---------- F1 ----------
const f1 = [encabezado('PASE SGC · F1 · ESTRUCTURA DEL ESQUEMA sgc (ANTES del código)', '\n  Aditivo: solo crea objetos en el esquema sgc y el trigger de base sgc_proteger_esquema. Idempotente.')];
for (const d of ddl) f1.push(file(`${MIG}/${d}/migration.sql`));
f1.push(part('verificacion-F1', `DECLARE @t INT = (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = N'sgc');
DECLARE @tr BIT = (SELECT is_disabled FROM sys.triggers WHERE parent_class = 0 AND name = N'sgc_proteger_esquema');
SELECT @t AS tablas_sgc, @tr AS trigger_deshabilitado;
IF @t <> 56 OR @tr IS NULL OR @tr = 1 THROW 50901, N'F1 incompleta: se esperaban 56 tablas en sgc y el trigger sgc_proteger_esquema habilitado.', 1;`));

// ---------- F2 ----------
const f2 = [encabezado('PASE SGC · F2 · DESPUÉS DEL CÓDIGO: retiro del módulo viejo, registro y datos de OLP',
  `\n  Parámetros: integrante SGC-COPIA-NC = ${COPIAS ?? 'ninguno'}; sustitutos = ${SUST1 ?? 'ninguno'} / ${SUST2 ?? 'ninguno'}; job del programador = ${PROGRAMADOR}.`)];
f2.push(file(`${SQLD}/01-retiro-modulo-viejo.sql`));
let reg = '';
for (const d of migraciones) {
  const sum = sha(fs.readFileSync(path.join(MIG, d, 'migration.sql')));
  reg += `IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'${d}')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'${sum}', SYSUTCDATETIME(), N'${d}', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);\n`;
}
reg += `SELECT COUNT(*) AS migraciones_sgc_registradas FROM [dbo].[_prisma_migrations] WHERE migration_name LIKE N'%sgc%';`;
f2.push(part('registro-migraciones (generado)', reg));
for (const f of ['2026-09-30-sgc-s0-cimientos.sql', '2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql',
  '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) f2.push(file(`${MAN}/${f}`));
{
  const p = `${MAN}/2026-10-01-sgc-s5-vencimientos-olp.sql`;
  let t = read(p);
  if (PROGRAMADOR === 'no') {
    t = replaceOnce(t, `IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL\n     AND NOT EXISTS`, `IF 1 = 0 /* --programador no: sin job sgc_review_alerts */ AND OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL\n     AND NOT EXISTS`, p);
  }
  f2.push(part(`${p}${PROGRAMADOR === 'no' ? ' (sin job del programador)' : ''}`, t));
}
f2.push(file(`${MAN}/2026-10-03-sgc-correcciones-calidad-olp.sql`));
f2.push(file(`${MAN}/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql`));
{
  const p = `${MAN}/2026-10-08-sgc-s11-copias-no-controladas-olp.sql`;
  f2.push(part(`${p} (@Integrante=${COPIAS ?? 'NULL'})`, replaceOnce(read(p), "DECLARE @Integrante NVARCHAR(255) = NULL;", `DECLARE @Integrante NVARCHAR(255) = ${email(COPIAS)};`, p)));
}
{
  const p = `${MAN}/2026-10-08-sgc-s12-sustitutos-olp.sql`;
  let t = replaceOnce(read(p), "DECLARE @Integrante1 NVARCHAR(255) = NULL;", `DECLARE @Integrante1 NVARCHAR(255) = ${email(SUST1)};`, p);
  t = replaceOnce(t, "DECLARE @Integrante2 NVARCHAR(255) = NULL;", `DECLARE @Integrante2 NVARCHAR(255) = ${email(SUST2)};`, p);
  f2.push(part(`${p} (@Integrante1=${SUST1 ?? 'NULL'}, @Integrante2=${SUST2 ?? 'NULL'})`, t));
}
f2.push(file(`${SQLD}/05-correo-avisos-apagado.sql`));
f2.push(part('verificacion-F2', `SELECT id_company, is_active, storage_root, header_mandatory, email_mode, self_signature_enabled FROM sgc.company_config;
SELECT t.code, (SELECT COUNT(*) FROM sgc.authorization_type_user u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes FROM sgc.authorization_type t WHERE t.id_company = 3 ORDER BY t.code;
IF NOT EXISTS (SELECT 1 FROM sgc.company_config WHERE id_company = 3 AND is_active = 1 AND storage_root = N'SGC/OLP')
  THROW 50902, N'F2: OLP no quedó activa en SGC/OLP.', 1;
IF EXISTS (SELECT 1 FROM sgc.company_config WHERE id_company <> 3 AND is_active = 1)
  THROW 50903, N'F2: hay otra empresa activa en el SGC; solo debe estar OLP.', 1;
IF EXISTS (SELECT 1 FROM sgc.company_config WHERE self_signature_enabled = 1)
  THROW 50904, N'F2: la firma propia (S13) quedó encendida; debe subir apagada.', 1;
IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL THROW 50905, N'F2: el módulo documental viejo sigue en la base.', 1;`));

// ---------- R1 ----------
const flags = ['sgc_reversa_pendientes_archivo', 'sgc_reversa_padres', 'sgc_reversa_propuestas', 'sgc_reversa_recapacitaciones', 'sgc_reversa_flujo_s10', 'sgc_reversa_copias', 'sgc_reversa_sustitutos', 'sgc_reversa_firma_propia'];
// Las banderas viven en la sesión: se repiten al inicio de CADA lote del componente
// (aplicar-sql.mjs usa un pool y dos lotes pueden ir por conexiones distintas).
const flagSql = flags.map((f) => `EXEC sp_set_session_context N'${f}', 1;`).join('\n');
const conFlags = (t) => (ACEPTO ? `${flagSql}\n${t.replace(/^(\s*GO\s*)$/gim, `$1\n${flagSql}`)}` : t);
const r1 = [encabezado('PASE SGC · R1 · REVERSA DEL SGC (datos y esquema sgc)',
  `\n  ${ACEPTO ? 'CON --acepto-perdidas: las reversas borran los datos del SGC que encuentren.' : 'SIN --acepto-perdidas: una reversa con datos que perder se DETIENE (THROW).'}\n  No toca dbo.scheduled_job/_run (existen en KRONOSDB desde antes del SGC): la reversa del S5 solo quita el job sgc_review_alerts.\n  La app vieja no usa el esquema sgc: R1 solo hace falta si se abandona el SGC; para volver al código anterior basta R2.`)];
for (const f of ['2026-10-08-sgc-s13-firma-propia-reversa.sql', '2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql', '2026-10-08-sgc-s11-copias-no-controladas-reversa.sql',
  '2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql', '2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql', '2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql',
  '2026-10-03-sgc-correcciones-calidad-reversa.sql', '2026-10-01-sgc-s6-endurecimiento-reversa.sql', '2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql',
  '2026-10-01-sgc-s4-divulgacion-reversa.sql', '2026-09-30-sgc-s3-firma-reversa.sql', '2026-09-30-sgc-s2-flujos-reversa.sql', '2026-09-30-sgc-s1-repositorio-reversa.sql',
  '2026-09-30-sgc-s0-cimientos-reversa.sql']) {
  const p = `${MAN}/${f}`;
  // Re-ejecutable: cada reversa es idempotente mientras existan las tablas de los
  // sprints anteriores (p. ej. la del S12 usa sgc.authorization_type, del S2). Si
  // R1 se corta y se vuelve a correr, se omite lo que ya no tiene sobre qué actuar.
  const cond = /s[01]-(cimientos|repositorio)-reversa/.test(f) ? "SCHEMA_ID(N'sgc') IS NOT NULL" : "OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL";
  r1.push(partCond(p, read(p), cond));
}
r1.push(part('registro-migraciones (reversa)', `DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name LIKE N'%[_]sgc[_]%' AND migration_name <> N'20260930100000_sgc_s0_retiro_gestion_documental';
SELECT SCHEMA_ID(N'sgc') AS esquema_sgc, (SELECT COUNT(*) FROM sys.triggers WHERE parent_class = 0 AND name = N'sgc_proteger_esquema') AS trigger_bd,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/sgc-documental%') AS subprocesos_sgc;`));

// ---------- R2 ----------
const wrap = (p, cond) => {
  const t = read(p);
  return part(`${p} (solo si ${cond})`, `IF ${cond}\n  EXEC sp_executesql N'${t.replace(/'/g, "''")}';\nELSE PRINT N'${path.basename(path.dirname(p))}: ya aplicada, se omite.';`);
};
const r2 = [encabezado('PASE SGC · R2 · RESTAURAR EL MÓDULO DOCUMENTAL VIEJO (solo con reversa del CÓDIGO)',
  '\n  El código anterior de main hace JOIN a dbo.document_version en «Ver actividades»: correr R2 ANTES de arrancar el código anterior.')];
r2.push(wrap(`${MIG}/20260821000000_add_document_management/migration.sql`, "OBJECT_ID(N'dbo.document', N'U') IS NULL"));
r2.push(wrap(`${MIG}/20260821120000_document_management_workflow/migration.sql`, "COL_LENGTH(N'dbo.document_version', N'id_request_general') IS NULL"));
r2.push(file(`${SQLD}/01-retiro-modulo-viejo-reversa.sql`));
r2.push(part('registro-migraciones (retiro, reversa)', `DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930100000_sgc_s0_retiro_gestion_documental';
SELECT OBJECT_ID(N'dbo.document_version', N'U') AS document_version, (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos_viejos;`));

fs.mkdirSync(OUT, { recursive: true });
const outs = {
  'F0-verificacion-previa.sql': f0, 'F1-ddl-antes-del-codigo.sql': f1, 'F2-despues-del-codigo.sql': f2,
  'R1-reversa-sgc.sql': r1, 'R2-restaurar-modulo-viejo.sql': r2,
};
const lines = [`Base ${DB} en ${SERVER} · programador ${PROGRAMADOR} · acepto-perdidas ${ACEPTO} · copias ${COPIAS ?? '-'} · sustitutos ${SUST1 ?? '-'} / ${SUST2 ?? '-'}`, '', 'Componentes:', ...manifest, '', 'Salidas:'];
for (const [n, parts] of Object.entries(outs)) {
  const text = `${parts.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT, n), `﻿${text}`);
  lines.push(`${sha(text)}  ${n}  (${parts.length - 1} componentes)`);
}
fs.writeFileSync(path.join(OUT, 'MANIFIESTO.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
