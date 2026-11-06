/*
  PASE SGC · F2 · DESPUÉS DEL CÓDIGO: retiro del módulo viejo, registro y datos de OLP
  Generado por scripts/sgc/pase-produccion/prod/armar-consolidado.mjs el 2026-10-10.
  Base esperada: KRONOSDB en SERFARMA03 (cada lote empieza con una guardia que hace THROW si no coincide).
  Correr SOLO con aplicar-sql.mjs (se detiene en el primer error) y con la autorización del pase.
  Parámetros: integrante SGC-COPIA-NC = subdireccion.reglamentaria@gsslatam.com; sustitutos = subdireccion.reglamentaria@gsslatam.com / ninguno; job del programador = no.
*/
SET NOCOUNT ON;
GO
/* GUARDIA · scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo.sql ===== */
/*
  PASE DEL SGC A PRODUCCIÓN — PASO 7: RETIRO DEL MÓDULO DOCUMENTAL VIEJO EN KRONOSDB.
  Aprobado por Nicolás Rivera el 2026-09-30 («en producción aún no hay nada
  importante; si hay basura también hay que quitarla»).

  ⚠️ VA DESPUÉS de desplegar el código nuevo (el código viejo de main hace JOIN
  a document_version en «Ver actividades»). Requiere la autorización puntual
  de Nicolás para esta corrida de escritura.

  Qué hace, en una transacción:
    1. Vuelve a comprobar que document, document_type y document_version están
       VACÍAS; si alguna tiene filas, se detiene sin tocar nada.
    2. Respalda en dbo.bk_sgc_pase_* los subprocesos /process/document-
       management*, sus asignaciones y sus notificaciones.
    3. Borra notificaciones, asignaciones y los 2 subprocesos (40 y 41).
    4. DROP de document_version, document y document_type (vacías; mismo
       contenido de la migración 20260930100000_sgc_s0_retiro_gestion_documental,
       que se registra como aplicada en el paso de registro).
  NO toca: document_signatures (Orión), el proceso 52, el tipo de autorización
  «Autorización de documento» ni nada fuera de lo listado.
  Idempotente. Reversa: 01-retiro-modulo-viejo-reversa.sql.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

-- Conteos con SQL dinámico: si la tabla ya no existe (segunda corrida), no falla la compilación.
DECLARE @filas BIGINT = 0, @n BIGINT, @t SYSNAME, @q NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (N'document'), (N'document_type'), (N'document_version')) v(name);
OPEN c; FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'dbo.' + @t, N'U') IS NOT NULL
  BEGIN
    SET @q = N'SELECT @x = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@t);
    EXEC sp_executesql @q, N'@x BIGINT OUTPUT', @x = @n OUTPUT;
    SET @filas += @n;
  END
  FETCH NEXT FROM c INTO @t;
END
CLOSE c; DEALLOCATE c;
IF @filas > 0
  THROW 50611, N'Candado: alguna tabla del módulo documental viejo YA TIENE FILAS. No se tocó nada; consultar con Nicolás.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.bk_sgc_pase_subprocess', N'U') IS NULL
  BEGIN
    SELECT * INTO dbo.bk_sgc_pase_subprocess FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%';
    SELECT suc.* INTO dbo.bk_sgc_pase_subprocess_user_company FROM dbo.subprocess_user_company suc
      JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url LIKE N'/process/document-management%';
    SELECT * INTO dbo.bk_sgc_pase_notifications FROM dbo.notifications WHERE url LIKE N'/process/document-management%';
  END

  DELETE FROM dbo.notifications WHERE url LIKE N'/process/document-management%';
  DELETE suc FROM dbo.subprocess_user_company suc JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url LIKE N'/process/document-management%';
  DELETE FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%';

  IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL DROP TABLE dbo.document_version;
  IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NOT NULL DROP TABLE dbo.document_process_subprocess;
  IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NOT NULL DROP TABLE dbo.document_process_category;
  IF OBJECT_ID(N'dbo.document', N'U') IS NOT NULL DROP TABLE dbo.document;
  IF OBJECT_ID(N'dbo.document_type', N'U') IS NOT NULL DROP TABLE dbo.document_type;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS q,
  (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (N'document', N'document_type', N'document_version')) AS tablas_viejas,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos_viejos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_subprocess) AS respaldo_subprocesos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_subprocess_user_company) AS respaldo_asignaciones,
  (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.document_signatures') AND p.index_id IN (0, 1)) AS document_signatures_intacta;
GO
/* GUARDIA · registro-migraciones (generado) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== registro-migraciones (generado) ===== */
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930100000_sgc_s0_retiro_gestion_documental')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'5500dfb0bf7d7ceaba08290ce722a40120619b18b926a1785525b7b7ed6998ab', SYSUTCDATETIME(), N'20260930100000_sgc_s0_retiro_gestion_documental', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930110000_sgc_esquema_base')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'867f668b1fe85e4bf8671439023d3683e8eecc5f8e007dce95776eb60df2fa13', SYSUTCDATETIME(), N'20260930110000_sgc_esquema_base', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930150000_sgc_s1_repositorio')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'91e16c61aff6482d9f542e1a27b813f9711245a855f5fc7fe2daa4c4da4709e9', SYSUTCDATETIME(), N'20260930150000_sgc_s1_repositorio', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930200000_sgc_s2_flujos_tareas_autorizaciones')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'2259c92653306dfe85e9a2785475effd659487c426af4f1510acd53847996de6', SYSUTCDATETIME(), N'20260930200000_sgc_s2_flujos_tareas_autorizaciones', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930230000_sgc_s3_firma_pdf_calidad')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'6adfdb2761650e8ac656927854b03d32ea847b0d71b4230d0af879bf4697c74a', SYSUTCDATETIME(), N'20260930230000_sgc_s3_firma_pdf_calidad', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261001000000_sgc_s4_divulgacion_capacitacion_vigencia')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'160b693d088cabdee29a9c52c1c7ba9a9d47ebc098fe23bc44b59ca5ffefb40f', SYSUTCDATETIME(), N'20261001000000_sgc_s4_divulgacion_capacitacion_vigencia', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261001100000_sgc_s5_relaciones_vencimientos_accesos')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'48412e90eff40b3e012d1d366091cdc25edd1f79843b9f9482c82316ef677d8e', SYSUTCDATETIME(), N'20261001100000_sgc_s5_relaciones_vencimientos_accesos', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261001200000_sgc_s6_endurecimiento')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'9c7307d0de26b09111b3bd282de0459ec37ac737f6bca14fde869d6d15b2ae5d', SYSUTCDATETIME(), N'20261001200000_sgc_s6_endurecimiento', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261003120000_sgc_correcciones_calidad')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'56983776340650f8c90fedaccfacb00e75f5dd19e1240a85ee4b82ba5a8fb4f9', SYSUTCDATETIME(), N'20261003120000_sgc_correcciones_calidad', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008100000_sgc_s8_encabezado_listado_maestro')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'ff74697b9314f7d7fd9f8e06187816485a542d86ae50f1a47550daa24be5a9ab', SYSUTCDATETIME(), N'20261008100000_sgc_s8_encabezado_listado_maestro', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008110000_sgc_s9_archivos_relaciones_correo')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'bc4b482f9d8f36ad9eaa6f5a3e1e2bb73f0718b97f6adde5a69fa36c4318c02b', SYSUTCDATETIME(), N'20261008110000_sgc_s9_archivos_relaciones_correo', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008120000_sgc_s10_capacitacion_opcional')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'06948053cadc28c64920230e12ef4cdb64928651ea0698309459179a7e12e721', SYSUTCDATETIME(), N'20261008120000_sgc_s10_capacitacion_opcional', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008130000_sgc_s11_copias_no_controladas')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'e95fefc85a5b6015cde6655652928fc912deacdb593b086c475b34fc25f6f998', SYSUTCDATETIME(), N'20261008130000_sgc_s11_copias_no_controladas', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008140000_sgc_s12_aprobadores_sustitutos')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'6e05813b68a63b775ec28d158ce71fedd8e546a48533abdde66e335154cf83fc', SYSUTCDATETIME(), N'20261008140000_sgc_s12_aprobadores_sustitutos', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261008150000_sgc_s13_firma_propia_registro')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'3f9e15f1176dcf56dab403c4663318d5a702167bf6b931f8dc1dc85e8e4feb21', SYSUTCDATETIME(), N'20261008150000_sgc_s13_firma_propia_registro', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);
SELECT COUNT(*) AS migraciones_sgc_registradas FROM [dbo].[_prisma_migrations] WHERE migration_name LIKE N'%sgc%';
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s0-cimientos.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s0-cimientos.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 0: cimientos (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP).

  PRERREQUISITO: la migración 20260930110000_sgc_esquema_base (esquema `sgc` y
  tabla sgc.company_config) ya aplicada.

  QUÉ HACE (idempotente, APPEND-ONLY, sin DROP/ALTER/TRUNCATE):
    1. Proceso contenedor del menú: "Sistema de Gestión de Calidad".
    2. Subprocesos-permiso del módulo (los nombres y URLs deben coincidir con
       lib/sgc/constants.ts):
         /process/sgc-documental          SGC documental (entrada del menú, consulta)
         /process/sgc-documental/gestion  gestionar documentos      (marcador)
         /process/sgc-documental/calidad  Aseguramiento de Calidad  (marcador)
         /process/sgc-documental/flujos   administración de flujos  (marcador)
    3. Activa SOLO One Latam Pharma (id_company = 3) en sgc.company_config.
       Las demás empresas se activan después con la skill sgc-activar-empresa.
    4. Otorga los 4 permisos al usuario @AdminEmail ÚNICAMENTE en OLP (si tiene
       company_user en OLP). Nadie más queda con acceso.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (ver la
  memoria "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS;
  en KRONOSDB solo con autorización del pase. Imprime el estado antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s0-cimientos-reversa.sql
*/

SET XACT_ABORT ON;

DECLARE @AdminEmail   NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @IdCompanyOlp INT           = 3;
DECLARE @ProcessName  NVARCHAR(255) = N'Sistema de Gestión de Calidad';

/* Estado ANTES */
SELECT 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url LIKE N'/process/sgc-documental%';
SELECT 'antes' AS momento, id_company, is_active FROM [sgc].[company_config];

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) Proceso contenedor */
  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  /* 2) Subprocesos (idempotentes por subprocess_url) */
  DECLARE @Subs TABLE (subprocess NVARCHAR(255), url NVARCHAR(255));
  INSERT INTO @Subs (subprocess, url) VALUES
    (N'SGC documental',                                      N'/process/sgc-documental'),
    (N'SGC documental · gestionar documentos',               N'/process/sgc-documental/gestion'),
    (N'SGC documental · Aseguramiento de Calidad',           N'/process/sgc-documental/calidad'),
    (N'SGC documental · administración de flujos validados', N'/process/sgc-documental/flujos');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url
  FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  /* 3) Activar OLP en el SGC */
  IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompanyOlp)
    INSERT INTO [sgc].[company_config] (id_company, is_active, storage_root, activated_by, activated_at, change_reason, created_at, updated_at)
    VALUES (@IdCompanyOlp, 1, N'SGC/OLP', @AdminEmail, SYSUTCDATETIME(),
            N'Sprint 0: activación inicial de One Latam Pharma (decisión de Nicolás Rivera, 2026-09-30).',
            SYSUTCDATETIME(), SYSUTCDATETIME());

  /* 4) Permisos del administrador SOLO en OLP */
  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT s.id_subprocess, cu.id_company_user
  FROM [dbo].[subprocess] s
  JOIN @Subs x ON x.url = s.subprocess_url
  JOIN [dbo].[company_user] cu ON cu.id_company = @IdCompanyOlp
  JOIN [dbo].[user] u ON u.id = cu.id_user AND u.email = @AdminEmail
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = s.id_subprocess AND suc.id_company_user = cu.id_company_user
  );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;
SELECT 'despues' AS momento, id_company, is_active, storage_root, activated_by FROM [sgc].[company_config];
SELECT 'despues' AS momento, u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url LIKE N'/process/sgc-documental%'
ORDER BY c.company, s.subprocess_url;
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 1: maestros de One Latam Pharma (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP,
  ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930150000_sgc_s1_repositorio aplicada y OLP
  (id_company = 3) con fila en sgc.company_config.

  QUÉ HACE (idempotente, solo INSERT de lo que falta; no modifica lo que
  Calidad ya haya ajustado desde «Configuración del SGC»):
    1. Guía de codificación de OLP: prefijo OLP, patrón estilo Farmalógica
       {PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO} con 3 dígitos → OLP-GC-PR-001.
    2. Tipos de proceso: Estratégicos (E), Misionales (M), Soporte o apoyo (S)
       y Funciones y responsabilidades (F).
    3. Procesos: PROPUESTA INICIAL a partir de los departamentos existentes,
       para que Calidad la ajuste (nombres, códigos, dueños) en la pantalla de
       configuración. El departamento se busca por nombre; si no existe queda
       sin dueño.
    4. Tipos documentales del SGC: MA, PR, IN, FO, PT, PL, ES, AN, con
       revisión cada 36 meses, alerta 2 meses antes y capacitación obligatoria
       (decisión de Nicolás del 2026-09-30).
  Cada alta queda en sgc.audit_log (maestro.creado / guia_codificacion.editada).

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s1-repositorio-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 1: maestros iniciales de One Latam Pharma (propuesta para ajuste de Calidad), autorizado por Nicolás Rivera el 2026-09-30.';

/* Estado ANTES */
SELECT 'antes' AS momento,
  (SELECT COUNT(*) FROM [sgc].[coding_guide]  WHERE id_company = @IdCompany) AS guia,
  (SELECT COUNT(*) FROM [sgc].[process_type]  WHERE id_company = @IdCompany) AS tipos_proceso,
  (SELECT COUNT(*) FROM [sgc].[process_map]   WHERE id_company = @IdCompany) AS procesos,
  (SELECT COUNT(*) FROM [sgc].[document_type] WHERE id_company = @IdCompany) AS tipos_documentales;

IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51001, N'OLP no está configurada en sgc.company_config (falta el pase del S0).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* sgc.audit_log tiene un trigger (solo inserción) y SQL Server no permite
     OUTPUT INTO directo a una tabla con triggers: se recoge en @Alta y se
     inserta después. */
  DECLARE @Alta TABLE (entity NVARCHAR(60), entity_id NVARCHAR(60), after_json NVARCHAR(MAX));

  /* 1) Guía de codificación */
  IF NOT EXISTS (SELECT 1 FROM [sgc].[coding_guide] WHERE id_company = @IdCompany)
  BEGIN
    INSERT INTO [sgc].[coding_guide] (id_company, prefix, pattern, sequence_digits, updated_by, change_reason, created_at, updated_at)
    VALUES (@IdCompany, N'OLP', N'{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}', 3, @Actor, @Motivo, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'guia_codificacion.editada', N'coding_guide', CAST(@IdCompany AS NVARCHAR(60)),
            N'{"prefix":"OLP","pattern":"{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}","sequence_digits":3}', @Motivo);
  END

  /* 2) Tipos de proceso */
  DECLARE @Tipos TABLE (code NVARCHAR(10), name NVARCHAR(150), color NVARCHAR(20), sort_order INT);
  INSERT INTO @Tipos VALUES
    (N'E', N'Procesos estratégicos', N'indigo', 1),
    (N'M', N'Procesos misionales', N'teal', 2),
    (N'S', N'Procesos de soporte o apoyo', N'blue', 3),
    (N'F', N'Funciones y responsabilidades', N'grape', 4);

  INSERT INTO [sgc].[process_type] (id_company, code, name, color, sort_order, is_active, created_at, updated_at)
  OUTPUT N'process_type', CAST(inserted.id_process_type AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'"}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, t.code, t.name, t.color, t.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Tipos t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[process_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  /* 3) Procesos (propuesta inicial; el dueño se busca por nombre de departamento) */
  DECLARE @Procesos TABLE (tipo NVARCHAR(10), code NVARCHAR(10), name NVARCHAR(200), dept NVARCHAR(255), sort_order INT);
  INSERT INTO @Procesos VALUES
    (N'E', N'GE', N'Gerencia general', N'GERENCIA', 1),
    (N'E', N'GC', N'Gestión de calidad', N'GARANTÍA DE CALIDAD', 2),
    (N'E', N'CU', N'Cumplimiento', N'OFICIAL DE CUMPLIMIENTO', 3),
    (N'M', N'DT', N'Dirección técnica', N'DIRECCIÓN TÉCNICA', 1),
    (N'M', N'CO', N'Comercial', N'COMERCIAL', 2),
    (N'M', N'AC', N'Abastecimiento y comercio exterior', N'ABASTECIMIENTO Y COMEX', 3),
    (N'M', N'LO', N'Logística', N'LOGÍSTICA', 4),
    (N'S', N'TH', N'Talento humano', N'TALENTO HUMANO', 1),
    (N'S', N'CF', N'Contabilidad y finanzas', N'CONTABILIDAD Y FINANZAS', 2),
    (N'S', N'TE', N'Tesorería', N'TESORERIA', 3),
    (N'S', N'CA', N'Cartera', N'CARTERA', 4),
    (N'S', N'SI', N'Sistemas', N'SISTEMAS%', 5),
    (N'S', N'AD', N'Administración', N'ADMINISTRACIÓN', 6),
    (N'S', N'JU', N'Jurídica', N'ABOGADOS', 7),
    (N'F', N'FR', N'Perfiles de cargo: funciones y responsabilidades', N'TALENTO HUMANO', 1);

  INSERT INTO [sgc].[process_map] (id_company, id_process_type, code, name, id_department, sort_order, is_active, created_at, updated_at)
  OUTPUT N'process_map', CAST(inserted.id_process_map AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'","id_department":', COALESCE(CAST(inserted.id_department AS NVARCHAR(20)), N'null'), N'}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, pt.id_process_type, p.code, p.name,
         (SELECT TOP 1 d.id_department FROM [dbo].[department] d WHERE d.department LIKE p.dept ORDER BY d.id_department),
         p.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Procesos p
  JOIN [sgc].[process_type] pt ON pt.id_company = @IdCompany AND pt.code = p.tipo
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[process_map] x WHERE x.id_company = @IdCompany AND x.code = p.code);

  /* 4) Tipos documentales */
  DECLARE @TiposDoc TABLE (code NVARCHAR(10), name NVARCHAR(100), plural_name NVARCHAR(100), sort_order INT);
  INSERT INTO @TiposDoc VALUES
    (N'MA', N'Manual', N'Manuales', 1),
    (N'PR', N'Procedimiento', N'Procedimientos', 2),
    (N'IN', N'Instructivo', N'Instructivos', 3),
    (N'FO', N'Formato', N'Formatos', 4),
    (N'PT', N'Protocolo', N'Protocolos', 5),
    (N'PL', N'Plan', N'Planes', 6),
    (N'ES', N'Especificación', N'Especificaciones', 7),
    (N'AN', N'Anexo', N'Anexos', 8);

  INSERT INTO [sgc].[document_type] (id_company, code, name, plural_name, requires_training, review_months, alert_months, sort_order, is_active, created_at, updated_at)
  OUTPUT N'document_type', CAST(inserted.id_document_type AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'","review_months":36,"alert_months":2,"requires_training":true}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, t.code, t.name, t.plural_name, 1, 36, 2, t.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @TiposDoc t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[document_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor, N'maestro.creado', a.entity, a.entity_id, a.after_json, @Motivo FROM @Alta a;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, prefix, pattern, sequence_digits FROM [sgc].[coding_guide] WHERE id_company = @IdCompany;
SELECT 'despues' AS momento, pt.code AS tipo, p.code, p.name, d.department
FROM [sgc].[process_map] p
JOIN [sgc].[process_type] pt ON pt.id_process_type = p.id_process_type
LEFT JOIN [dbo].[department] d ON d.id_department = p.id_department
WHERE p.id_company = @IdCompany ORDER BY pt.sort_order, p.sort_order;
SELECT 'despues' AS momento, code, name, review_months, alert_months, requires_training FROM [sgc].[document_type] WHERE id_company = @IdCompany ORDER BY sort_order;
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s2-flujo-documental-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s2-flujo-documental-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 2: flujo documental v1, Autorizaciones
  SGC y matriz de responsables de EJEMPLO para One Latam Pharma (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP,
  ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930200000_sgc_s2_flujos_tareas_autorizaciones
  aplicada y OLP (id_company = 3) con maestros del S1.

  QUÉ HACE (idempotente, solo INSERT de lo que falta; no modifica lo que ya se
  haya configurado desde el administrador de flujos):
    1. Tipos de Autorización SGC (tablas propias; NO dbo.types_authorization):
       SGC-APROBACION  «Aprobación de documento SGC»
       SGC-VERIF-CALIDAD «Verificación de estructura documental (Calidad)»,
       con Nicolás Rivera como integrante inicial del grupo de Calidad.
    2. Proceso validado «DOC — Gestión documental» con su versión 1 VIGENTE:
       6 pasos (solicitud, elaboración, revisión, aprobación, divulgación y
       capacitación; las dos últimas definidas pero en espera hasta el S4),
       12 transiciones y 3 campos. Es la misma definición que
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    3. Matriz de responsables de EJEMPLO (is_example = 1, por cargo) para que
       Calidad vea cómo funciona; se reemplaza con la matriz que entregue
       Nicolás (supuesto a validar).
  Cada alta queda en sgc.config_change_log y en sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s2-flujos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 2: flujo documental v1 (6 pasos) y Autorizaciones SGC de One Latam Pharma, según las decisiones de Nicolás Rivera del 2026-09-30.';

SELECT 'antes' AS momento,
  (SELECT COUNT(*) FROM [sgc].[authorization_type] WHERE id_company = @IdCompany) AS tipos_autorizacion,
  (SELECT COUNT(*) FROM [sgc].[flow_process] WHERE id_company = @IdCompany) AS flujos,
  (SELECT COUNT(*) FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany) AS matriz;

IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51001, N'OLP no está configurada en sgc.company_config (falta el pase del S0).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* sgc.config_change_log y sgc.audit_log tienen triggers de solo inserción:
     SQL Server no permite OUTPUT INTO directo a ellas; se recoge y se inserta después. */
  DECLARE @Cambio TABLE (entity NVARCHAR(40), entity_id NVARCHAR(60), action NVARCHAR(40), after_json NVARCHAR(MAX), id_flow_process INT NULL, id_flow_version INT NULL);

  /* 1) Tipos de Autorización SGC */
  DECLARE @Tipos TABLE (code NVARCHAR(40), name NVARCHAR(150), description NVARCHAR(1000));
  INSERT INTO @Tipos VALUES
    (N'SGC-APROBACION', N'Aprobación de documento SGC', N'Aprobación de los responsables del área en el paso 3 del flujo documental (firma «Aprobó»).'),
    (N'SGC-VERIF-CALIDAD', N'Verificación de estructura documental (Calidad)', N'Aseguramiento de Calidad verifica guía de codificación, formato y anexos dentro de la aprobación.');

  INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
  OUTPUT N'authorization_type', CAST(inserted.id_authorization_type AS NVARCHAR(60)), N'autorizacion.tipo_creado',
         CONCAT(N'{"code":"', inserted.code, N'"}'), NULL, NULL
    INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
  SELECT @IdCompany, t.code, t.name, t.description, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Tipos t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
  OUTPUT N'authorization_type_user', CAST(inserted.id_authorization_type_user AS NVARCHAR(60)), N'autorizacion.grupo_agregado',
         CONCAT(N'{"email":"', inserted.user_email, N'"}'), NULL, NULL
    INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
  SELECT t.id_authorization_type, @Actor, @Actor, N'Integrante inicial del grupo de Calidad (Sprint 2); Calidad lo ajusta desde Autorizaciones SGC.', SYSUTCDATETIME()
  FROM [sgc].[authorization_type] t
  WHERE t.id_company = @IdCompany AND t.code = N'SGC-VERIF-CALIDAD'
    AND NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.user_email = @Actor AND u.revoked_at IS NULL);

  /* 2) Flujo documental v1 */
  DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
  IF @IdProcess IS NULL
  BEGIN
    INSERT INTO [sgc].[flow_process] (id_company, code, name, description, category, owner_email, is_active, created_by, created_at, updated_at)
    VALUES (@IdCompany, N'DOC', N'Gestión documental', N'Flujo documental del SGC: solicitud, elaboración, revisión, aprobación con verificación de Calidad, divulgación y capacitación.', N'documental', @Actor, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME());
    SET @IdProcess = SCOPE_IDENTITY();
    INSERT INTO @Cambio VALUES (N'flow_process', CAST(@IdProcess AS NVARCHAR(60)), N'proceso.creado', N'{"code":"DOC","name":"Gestión documental"}', @IdProcess, NULL);
  END

  IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess)
  BEGIN
    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, 1, N'vigente', @Motivo, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME(), @Actor, SYSUTCDATETIME());
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES
      (@IdVersion, N'solicitud',    N'Solicitud documental', 0, N'solicitante',  N'solicitante', 0, NULL,        NULL,       NULL, NULL, 0, NULL, NULL, 1, N'El dueño del proceso registra la necesidad (nuevo, nueva versión o modificación) con su justificación.'),
      (@IdVersion, N'elaboracion',  N'Elaboración',          1, N'elaborador',   N'elaborador',  0, NULL,        N'elaboro', 10,   NULL, 0, NULL, NULL, 1, N'El elaborador carga el borrador (Word) y asigna revisores y aprobadores, con su modo de firma.'),
      (@IdVersion, N'revision',     N'Revisión',             2, N'revisor',      N'firmantes',   1, N'paralelo', N'reviso',  5,    NULL, 0, NULL, NULL, 1, N'Los revisores dejan observaciones y aprueban o devuelven a elaboración.'),
      (@IdVersion, N'aprobacion',   N'Aprobación',           3, N'aprobador',    N'firmantes',   1, N'orden',    N'aprobo',  5,    NULL, 1, N'SGC-APROBACION', N'SGC-VERIF-CALIDAD', 1, N'Aprueban los responsables del área; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental.'),
      (@IdVersion, N'divulgacion',  N'Divulgación',          4, N'alcance',      N'calidad',     0, NULL,        N'leyo',    10,   NULL, 0, NULL, N'SGC-VERIF-CALIDAD', 0, N'Lectura obligatoria firmada por las personas del alcance (se habilita en el Sprint 4).'),
      (@IdVersion, N'capacitacion', N'Capacitación',         5, N'capacitacion', N'calidad',     0, NULL,        N'capacito', 15,  N'tipo_exige_capacitacion', 0, NULL, N'SGC-VERIF-CALIDAD', 0, N'Video, evaluación y carga de resultados (obligatoria para todos los tipos; se habilita en el Sprint 4).');

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES
      (@IdVersion, N'solicitud',    N'aprobar',  N'elaboracion', NULL),
      (@IdVersion, N'solicitud',    N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'elaboracion',  N'aprobar',  N'revision',    NULL),
      (@IdVersion, N'elaboracion',  N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'revision',     N'aprobar',  N'aprobacion',  NULL),
      (@IdVersion, N'revision',     N'devolver', N'elaboracion', NULL),
      (@IdVersion, N'revision',     N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'aprobacion',   N'aprobar',  N'divulgacion', NULL),
      (@IdVersion, N'aprobacion',   N'devolver', N'elaboracion', NULL),
      (@IdVersion, N'aprobacion',   N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'divulgacion',  N'aprobar',  N'capacitacion', NULL),
      (@IdVersion, N'capacitacion', N'aprobar',  NULL,           N'completada');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order)
    VALUES
      (@IdVersion, NULL, N'referencia_cambio', N'Referencia de control de cambios', N'texto', 0, NULL, N'Número del control de cambios que origina la solicitud, si existe.', 1),
      (@IdVersion, NULL, N'urgencia', N'Prioridad', N'seleccion', 1, N'["Normal","Alta","Requerimiento regulatorio"]', NULL, 2),
      (@IdVersion, N'elaboracion', N'resumen_cambios', N'Resumen de los cambios frente a la versión anterior', N'texto_largo', 0, NULL, N'Para nuevas versiones y modificaciones.', 3);

    INSERT INTO @Cambio VALUES (N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), N'version.publicada', N'{"version":1,"tareas":6,"transiciones":12,"campos":3}', @IdProcess, @IdVersion);
  END

  /* 3) Matriz de responsables de EJEMPLO (por cargo; solo sugiere) */
  DECLARE @Gc INT = (SELECT id_process_map FROM [sgc].[process_map] WHERE id_company = @IdCompany AND code = N'GC');
  DECLARE @Pr INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'PR');
  IF NOT EXISTS (SELECT 1 FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany AND is_example = 1)
  BEGIN
    INSERT INTO [sgc].[responsible_matrix] (id_company, id_process_map, id_document_type, role, user_email, id_cargo, cargo_name, sort_order, is_active, is_example, updated_by, created_at, updated_at)
    OUTPUT N'responsible_matrix', CAST(inserted.id_responsible AS NVARCHAR(60)), N'matriz.fila_agregada',
           CONCAT(N'{"role":"', inserted.role, N'","cargo":"', inserted.cargo_name, N'","ejemplo":true}'), NULL, NULL
      INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
    VALUES
      (@IdCompany, @Gc,  @Pr,  N'elaborador', NULL, NULL, N'Analista de Aseguramiento de Calidad', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, @Gc,  @Pr,  N'revisor',    NULL, NULL, N'Coordinador(a) de Aseguramiento de Calidad', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, NULL, NULL, N'revisor',    NULL, NULL, N'Jefe del área dueña del proceso', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, NULL, NULL, N'aprobador',  NULL, NULL, N'Director(a) Técnico(a)', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME());
  END

  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, after_json)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor, c.entity, c.entity_id, c.id_flow_process, c.id_flow_version, c.action, @Motivo, c.after_json FROM @Cambio c;

  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor,
         CASE WHEN c.entity LIKE N'flow%' THEN CASE WHEN c.action = N'version.publicada' THEN N'flujo.publicado' ELSE N'flujo.configurado' END
              WHEN c.entity = N'responsible_matrix' THEN N'matriz.editada'
              ELSE N'autorizacion.configurada' END,
         c.entity, c.entity_id, c.after_json, @Motivo
  FROM @Cambio c;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, p.code, p.name, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version) AS campos
FROM [sgc].[flow_process] p JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_company = @IdCompany;
SELECT 'despues' AS momento, t.code, t.name, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany;
SELECT 'despues' AS momento, COUNT(*) AS filas_matriz FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany;
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 3: flujo documental v2 de One Latam
  Pharma con la LISTA DE CHEQUEO de estructura documental de Calidad dentro
  de la Aprobación (datos). Autorizado por Nicolás Rivera el 2026-09-30 (plan
  del SGC documental de OLP, ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930230000_sgc_s3_firma_pdf_calidad aplicada y
  el flujo DOC v1 del S2 sembrado.

  QUÉ HACE (idempotente; si la versión vigente de DOC ya tiene lista de
  chequeo, no hace nada):
    1. Crea la versión N+1 del flujo DOC como COPIA de la vigente (tareas,
       transiciones y campos) y le agrega 3 puntos de chequeo de Calidad en la
       tarea «aprobacion» (campos con quality_check = 1): codificación,
       formato y anexos. Es la misma definición que SGC_DOCUMENT_FLOW_V2 de
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    2. La publica: la anterior queda RETIRADA (las solicitudes en curso
       siguen con la versión con la que arrancaron).
  Queda en sgc.config_change_log y en sgc.audit_log, con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 3: lista de chequeo de estructura documental de Calidad (codificación, formato y anexos) dentro de la Aprobación, como formulario configurable del flujo. Supuesto a validar con Calidad.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51010, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;

DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51011, N'El flujo DOC no tiene versión vigente.', 1;

SELECT 'antes' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1) AS puntos_chequeo
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev AND quality_check = 1)
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
    DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, to_task_key, terminal_status FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, N'aprobacion', x.field_key, x.label, N'si_no', x.required, NULL, x.help_text, x.sort_order, 1
    FROM (VALUES
      (N'chk_codificacion', N'Codificación conforme a la guía de codificación', 1, N'Código, versión y tipo documental según la guía de la empresa.', 10),
      (N'chk_formato', N'Formato institucional (encabezado, estructura y numeración)', 1, N'Plantilla vigente, secciones obligatorias y paginación.', 11),
      (N'chk_anexos', N'Anexos y formatos relacionados completos y referenciados', 0, N'Si el documento no tiene anexos, marque «No aplica».', 12)
    ) AS x (field_key, label, required, help_text, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = @IdVersion AND f.task_key = N'aprobacion' AND f.field_key = x.field_key);

    DECLARE @After NVARCHAR(MAX) = CONCAT(N'{"vigente":', @Number, N',"cambios":["Campo agregado: Codificación conforme a la guía de codificación (aprobacion.chk_codificacion).","Campo agregado: Formato institucional (encabezado, estructura y numeración) (aprobacion.chk_formato).","Campo agregado: Anexos y formatos relacionados completos y referenciados (aprobacion.chk_anexos)."]}');
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'), @After);

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N'}'), @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version) AS campos,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1) AS puntos_chequeo
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
GO
/* GUARDIA · prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 4: flujo documental de One Latam
  Pharma con los pasos 4 (Divulgación con lectura obligatoria firmada) y 5
  (Capacitación) HABILITADOS (datos). Autorizado por Nicolás Rivera el
  2026-09-30 (plan del SGC documental de OLP, ejecución sprint por sprint
  hasta testing).

  PRERREQUISITO: migración 20261001000000_sgc_s4_divulgacion_capacitacion_vigencia
  aplicada y el flujo DOC del S3 (con la lista de chequeo de Calidad) vigente.

  QUÉ HACE (idempotente; si la versión vigente de DOC ya tiene la divulgación
  habilitada, no hace nada):
    1. Crea la versión N+1 del flujo DOC como COPIA de la vigente (tareas,
       transiciones y campos) y en ella:
         - «divulgacion»: asignación «alcance» (cada persona del alcance firma
           su lectura), habilitada; la administra el grupo SGC-VERIF-CALIDAD;
         - «capacitacion»: habilitada (grupo de Calidad, firma «Capacitó»);
         - agrega «cancelar» desde divulgación y capacitación (solo Calidad
           lo puede usar; la versión aprobada se anula y nunca llega a vigente).
       Es la misma definición que SGC_DOCUMENT_FLOW_V3 de
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    2. La publica: la anterior queda RETIRADA. Las solicitudes en curso siguen
       con la versión con la que arrancaron (las que ya estaban «en espera» en
       la divulgación de una versión anterior siguen en espera: se cancelan y
       se vuelven a pedir si hace falta).
  Queda en sgc.config_change_log y en sgc.audit_log, con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-10-01-sgc-s4-divulgacion-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 4: se habilitan la Divulgación (lectura obligatoria hasta el final y firma «Leyó» de cada persona del alcance) y la Capacitación (sesión o video, evaluación de Microsoft Forms y firma «Capacitó»); al terminar, la versión pasa a vigente y la anterior a obsoleta. En estos pasos solo Calidad cancela.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51030, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;

DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51031, N'El flujo DOC no tiene versión vigente.', 1;

SELECT 'antes' AS momento, v.version_number, v.status,
  (SELECT TOP 1 CONCAT(t.assignment, N'/', CAST(t.is_enabled AS NVARCHAR(1))) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'divulgacion') AS divulgacion,
  (SELECT TOP 1 CAST(t.is_enabled AS NVARCHAR(1)) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'capacitacion') AS capacitacion
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion' AND assignment = N'alcance' AND is_enabled = 1)
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
    DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    UPDATE [sgc].[flow_task_def]
      SET assignment = N'alcance', multi_assignee = 0, signing_mode_default = NULL, is_enabled = 1, is_authorization = 0, authorization_type_code = NULL,
          pool_authorization_type_code = N'SGC-VERIF-CALIDAD', signature_meaning = N'leyo',
          description = N'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance (departamentos, cargos, personas o toda la empresa). La administra Aseguramiento de Calidad.'
      WHERE id_flow_version = @IdVersion AND task_key = N'divulgacion';
    UPDATE [sgc].[flow_task_def]
      SET is_enabled = 1,
          description = N'Sesión o video y evaluación en Microsoft Forms; Calidad carga el Excel de resultados (nota mínima configurable) y firma «Capacitó». Obligatoria para todos los tipos documentales.'
      WHERE id_flow_version = @IdVersion AND task_key = N'capacitacion';

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, to_task_key, terminal_status FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, x.from_task_key, N'cancelar', NULL, N'cancelada'
    FROM (VALUES (N'divulgacion'), (N'capacitacion')) AS x (from_task_key)
    WHERE NOT EXISTS (SELECT 1 FROM [sgc].[flow_transition] t WHERE t.id_flow_version = @IdVersion AND t.from_task_key = x.from_task_key AND t.action = N'cancelar');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    DECLARE @After NVARCHAR(MAX) = CONCAT(N'{"vigente":', @Number, N',"cambios":["Tarea Divulgación (divulgacion) cambió: assignment, isEnabled, description.","Tarea Capacitación (capacitacion) cambió: isEnabled, description.","Transición agregada: divulgacion:cancelar->cancelada.","Transición agregada: capacitacion:cancelar->cancelada."]}');
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'), @After);

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N'}'), @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version) AS campos,
  (SELECT TOP 1 CONCAT(t.assignment, N'/', CAST(t.is_enabled AS NVARCHAR(1))) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'divulgacion') AS divulgacion,
  (SELECT TOP 1 CAST(t.is_enabled AS NVARCHAR(1)) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'capacitacion') AS capacitacion
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
GO
/* GUARDIA · prisma/manual/2026-10-01-sgc-s5-vencimientos-olp.sql (sin job del programador) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-01-sgc-s5-vencimientos-olp.sql (sin job del programador) ===== */
/*
  PASE MANUAL — SGC documental, Sprint 5: avisos anticipados de vencimiento
  de One Latam Pharma (datos) y job del programador central. Autorizado por
  Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP, ejecución
  sprint por sprint hasta testing; calendario pedido el 2026-09-30 19:42).

  PRERREQUISITO: migración 20261001100000_sgc_s5_relaciones_vencimientos_accesos
  aplicada y el CÓDIGO del S5 desplegado (el programador debe conocer el
  job_type `sgc_review_alerts`; si el job existe antes que el código, el
  programador lo registra como «job_type desconocido» y lo pospone).

  QUÉ HACE (idempotente):
    1. Configuración GENERAL de avisos de la empresa (sgc.review_alert_config,
       alcance «empresa»), si no existe: 60, 30, 15 y 7 días antes y el día del
       vencimiento; aviso de vencido repetido cada 7 días (escalado a Calidad);
       recordatorio automático de lectura cada 7 días; correo encendido.
       Calidad la ajusta luego desde «Calendario de vencimientos → Avisos».
       Queda en sgc.audit_log con el motivo.
    2. Job GLOBAL del programador central (dbo.scheduled_job; uno solo para
       todas las empresas activas), si no existe: `sgc_review_alerts`, todos
       los días a las 6:00 a. m. (hora del servidor, Colombia). Es una FILA de
       datos en la tabla compartida del programador (no cambia su estructura).

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Reason NVARCHAR(1000) = N'Sprint 5 del SGC documental: avisos por defecto a 60, 30, 15 y 7 días y el día del vencimiento (pedido de Nicolás Rivera, 2026-09-30 19:42).';

SELECT 'antes' AS momento, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
     AND NOT EXISTS (SELECT 1 FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany AND scope_key = N'empresa')
  BEGIN
    INSERT INTO [sgc].[review_alert_config] (id_company, scope, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled, extra_emails_json, is_active, change_reason, updated_by)
    VALUES (@IdCompany, N'empresa', N'empresa', N'[60,30,15,7,0]', 7, 7, 1, N'[]', 1, @Reason, @Actor);
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'vencimiento.configurado', N'review_alert_config', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), NULL,
            N'{"scope":"empresa","offsets":[60,30,15,7,0],"overdueEveryDays":7,"readingReminderDays":7,"emailEnabled":true}', @Reason);
  END;

  IF 1 = 0 /* --programador no: sin job sgc_review_alerts */ AND OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM [dbo].[scheduled_job] WHERE job_type = N'sgc_review_alerts')
  BEGIN
    -- Próximas 6:00 a. m. (hora del servidor).
    DECLARE @Next DATETIME = DATEADD(HOUR, 6, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
    IF @Next <= GETDATE() SET @Next = DATEADD(DAY, 1, @Next);
    EXEC sp_executesql N'INSERT INTO [dbo].[scheduled_job] (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
      VALUES (N''SGC · avisos de vencimiento y recordatorios de lectura'', N''sgc_review_alerts'', NULL, N''0 6 * * *'', @Next, 1, N''sgc-documental'', @Actor, GETDATE());',
      N'@Next DATETIME, @Actor NVARCHAR(255)', @Next = @Next, @Actor = @Actor;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany;
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''job'' AS q, id, name, job_type, cron_expression, next_run_date, active, source_module FROM [dbo].[scheduled_job] WHERE job_type = N''sgc_review_alerts'';';
GO
/* GUARDIA · prisma/manual/2026-10-03-sgc-correcciones-calidad-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-03-sgc-correcciones-calidad-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, correcciones de Calidad de One Latam Pharma
  (reunión del 2026-10-02 con Juan Sebastián Mora; implementadas el
  2026-10-03 por encargo de Nicolás Rivera): DATOS de la empresa.

  PRERREQUISITO: migración 20261003120000_sgc_correcciones_calidad aplicada
  (antes del código).

  QUÉ HACE (idempotente; solo llena lo que esté vacío):
    1. Dominios de correo de la empresa para la divulgación automática:
       «toda la empresa», departamentos y cargos solo incluyen correos
       @onelatampharma.com (Calidad OLP: «no me puede aparecer ningún correo de
       GSS, solamente One Latam»). Otras personas, solo elegidas a mano.
    2. Logo del encabezado institucional: el logo de la plantilla de
       procedimiento de Calidad (imagen del encabezado de «Platilla para
       procedimiento.docx», PNG 112×111, SHA-256 87778a4a07e10e5f8d1f4544c87976ab7e34a1e6e8e94869d579aedd2512f284).
       Calidad lo cambia desde «Configuración → Encabezado y divulgación».
    3. El umbral de aviso de avance de lectura queda en 90 % (valor por
       defecto de la columna; Calidad lo ajusta en la misma pantalla).
    Cada cambio queda en sgc.audit_log con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.
  Para otra empresa: cambiar @IdCompany (id DE ESA BASE), @Domains y el logo.

  REVERSA: prisma/manual/2026-10-03-sgc-correcciones-calidad-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Domains NVARCHAR(500) = N'onelatampharma.com';
DECLARE @Reason NVARCHAR(1000) = N'Correcciones de Calidad OLP (reunión 2026-10-02): divulgación «toda la empresa» solo con correos de la empresa y logo del encabezado institucional (plantilla de procedimiento de Calidad).';
DECLARE @Logo NVARCHAR(MAX) = N'data:image/png;base64,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';

SELECT 'antes' AS momento, id_company, dissemination_domains, read_threshold_pct, CASE WHEN logo_data_url IS NULL THEN 0 ELSE LEN(logo_data_url) END AS logo_chars FROM [sgc].[company_config] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany AND dissemination_domains IS NULL)
  BEGIN
    UPDATE [sgc].[company_config] SET dissemination_domains = @Domains, updated_at = SYSUTCDATETIME() WHERE id_company = @IdCompany;
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'configuracion.empresa', N'company_config', CAST(@IdCompany AS NVARCHAR(60)), N'{"disseminationDomains":null}', CONCAT(N'{"disseminationDomains":"', @Domains, N'"}'), @Reason);
  END;

  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany AND logo_data_url IS NULL)
  BEGIN
    UPDATE [sgc].[company_config] SET logo_data_url = @Logo, updated_at = SYSUTCDATETIME() WHERE id_company = @IdCompany;
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'configuracion.empresa', N'company_config', CAST(@IdCompany AS NVARCHAR(60)), N'{"logo":null}', N'{"logo":{"bytes":12306,"sha256":"87778a4a07e10e5f8d1f4544c87976ab7e34a1e6e8e94869d579aedd2512f284"}}', @Reason);
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, id_company, dissemination_domains, read_threshold_pct, CASE WHEN logo_data_url IS NULL THEN 0 ELSE LEN(logo_data_url) END AS logo_chars FROM [sgc].[company_config] WHERE id_company = @IdCompany;
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql ===== */
/*
  PASE MANUAL — SGC documental, Sprint 10 («DOC v6» del plan): FLUJO con la
  capacitación preparada ANTES de la divulgación y OPCIONAL por solicitud
  (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008120000_sgc_s10_capacitacion_opcional y el
  CÓDIGO del S10 desplegados (el código anterior no conoce la tarea
  «material» ni la condición «requiere_capacitacion»).

  QUÉ HACE (idempotente: solo si la versión vigente de DOC aún no tiene la
  preparación de la capacitación):
    1. Publica una versión NUEVA de DOC copiada de la vigente (que queda
       retirada; las solicitudes en curso siguen con su versión) con:
         - «Preparación de la capacitación» (preparacion_capacitacion, orden 4,
           grupo de Calidad, sin firma, condición «requiere_capacitacion»):
           Calidad registra el video o la sesión y la evaluación en Microsoft
           Forms o Google Forms; la divulgación no abre sin ese material;
         - Divulgación pasa al orden 5 y Capacitación al 6, con la condición
           «requiere_capacitacion» (la bandera de la solicitud);
         - Aprobación → Preparación → Divulgación; la preparación se puede cancelar.
    2. Deja el cambio en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.
  Para otra empresa: cambiar @IdCompany (id DE ESA BASE).

  REVERSA: prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql
  (publica otra versión sin la preparación; nunca edita ni borra versiones).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 10 (socialización con Calidad OLP 2026-10-07): la capacitación es opcional por solicitud y su material (video y evaluación en Microsoft Forms o Google Forms) se prepara ANTES de la divulgación; la lectura lo muestra debajo del documento; cuentan 2 intentos y quien no aprueba queda en recapacitación.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51083, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51084, N'El flujo DOC no tiene versión vigente.', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion' AND assignment = N'alcance' AND is_enabled = 1)
  THROW 51085, N'La versión vigente de DOC no tiene la divulgación habilitada (falta el SQL del S4).', 1;

SELECT 'antes' AS momento, v.version_number, v.status, (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'preparacion_capacitacion')
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
    DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();
    DECLARE @OrdenDivulgacion INT = (SELECT step_order FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion');

    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    -- Copia de las tareas; las que van desde la divulgación corren un lugar.
    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, CASE WHEN step_order >= @OrdenDivulgacion THEN step_order + 1 ELSE step_order END, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days,
           CASE WHEN task_key = N'capacitacion' THEN N'requiere_capacitacion' ELSE condition_key END,
           is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled,
           CASE WHEN task_key = N'capacitacion' THEN N'Calidad carga los resultados de la evaluación (Microsoft Forms o Google Forms; cuentan 2 intentos), registra la recapacitación de quien no aprobó y firma «Capacitó». Solo si la solicitud requiere capacitación.'
                WHEN task_key = N'divulgacion' THEN N'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance; si la solicitud requiere capacitación, debajo del documento van el video y la evaluación.'
                ELSE description END
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES (@IdVersion, N'preparacion_capacitacion', N'Preparación de la capacitación', @OrdenDivulgacion, N'material', N'calidad', 0, NULL, NULL, 5, N'requiere_capacitacion', 0, NULL, N'SGC-VERIF-CALIDAD', 1,
            N'Antes de la divulgación, Calidad registra el material de la capacitación: video o sesión y evaluación en Microsoft Forms o Google Forms. Solo si la solicitud requiere capacitación.');

    -- Transiciones: la aprobación lleva a la preparación, y la preparación a la divulgación.
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, CASE WHEN from_task_key = N'aprobacion' AND action = N'aprobar' THEN N'preparacion_capacitacion' ELSE to_task_key END, terminal_status
    FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES (@IdVersion, N'preparacion_capacitacion', N'aprobar', N'divulgacion', NULL),
           (@IdVersion, N'preparacion_capacitacion', N'cancelar', NULL, N'cancelada');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'),
            CONCAT(N'{"vigente":', @Number, N',"cambios":["Tarea agregada: preparacion_capacitacion (Preparación de la capacitación).","Transición cambiada: aprobacion:aprobar->preparacion_capacitacion.","Transiciones agregadas: preparacion_capacitacion:aprobar->divulgacion, preparacion_capacitacion:cancelar->cancelada.","Tarea Capacitación (capacitacion) cambió: conditionKey, stepOrder, description."]}'));

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N'}'), @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-olp.sql (@Integrante=subdireccion.reglamentaria@gsslatam.com) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-olp.sql (@Integrante=subdireccion.reglamentaria@gsslatam.com) ===== */
/*
  PASE MANUAL — SGC documental, Sprint 11: COPIAS NO CONTROLADAS de One Latam
  Pharma (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008130000_sgc_s11_copias_no_controladas.

  QUÉ HACE (idempotente):
    1. Crea el tipo de autorización SGC-COPIA-NC («Copias no controladas»):
       el GRUPO EXCLUSIVO que decide las copias (Calidad pidió que llegue solo
       a María Camila, nunca al jefe del área).
    2. Si se indica @Integrante (el correo de María Camila u otra persona que
       Calidad designe), lo agrega al grupo con motivo. Si queda vacío, Calidad
       lo agrega desde «Autorizaciones → Tipos de autorización».
    3. Deja la configuración por defecto de la empresa (decisión D5): formatos
       FO y FR, 30 días por defecto y 90 como máximo (ya la pone la migración).
    Todo queda en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.

  REVERSA: la reversa del Sprint 11 desactiva el tipo (no lo borra).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Integrante NVARCHAR(255) = N'subdireccion.reglamentaria@gsslatam.com'; -- p. ej. N'<correo de María Camila>'
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 11 (socialización con Calidad OLP 2026-10-07): las copias no controladas las decide solo el grupo exclusivo de Calidad (María Camila), nunca el jefe del área.';

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-COPIA-NC')
  BEGIN
    INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
    VALUES (@IdCompany, N'SGC-COPIA-NC', N'Copias no controladas (Calidad)', N'Grupo exclusivo que autoriza o rechaza las copias no controladas (impresión con marca y vencimiento).', 1, @Actor, @Now, @Now);
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'authorization_type', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), N'autorizacion.tipo_creado', @Motivo, N'{"code":"SGC-COPIA-NC"}');
  END;
  IF @Integrante IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM [sgc].[authorization_type_user] u JOIN [sgc].[authorization_type] t ON t.id_authorization_type = u.id_authorization_type
    WHERE t.id_company = @IdCompany AND t.code = N'SGC-COPIA-NC' AND u.user_email = LOWER(@Integrante) AND u.revoked_at IS NULL)
  BEGIN
    INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
    SELECT id_authorization_type, LOWER(@Integrante), @Actor, @Motivo, @Now FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-COPIA-NC';
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'autorizacion.configurada', N'authorization_type_user', N'SGC-COPIA-NC', CONCAT(N'{"email":"', LOWER(@Integrante), N'"}'), @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT t.code, t.name, t.is_active, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany AND t.code = N'SGC-COPIA-NC';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s12-sustitutos-olp.sql (@Integrante1=subdireccion.reglamentaria@gsslatam.com, @Integrante2=NULL) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s12-sustitutos-olp.sql (@Integrante1=subdireccion.reglamentaria@gsslatam.com, @Integrante2=NULL) ===== */
/*
  PASE MANUAL — SGC documental, Sprint 12: FIRMANTES SUSTITUTOS de One Latam
  Pharma (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008140000_sgc_s12_aprobadores_sustitutos.

  QUÉ HACE (idempotente):
    1. Crea el tipo de autorización SGC-SUSTITUTOS («Firmantes sustitutos»):
       el GRUPO EXCLUSIVO que asigna un firmante sustituto sobre un cupo
       pendiente cuando el titular está ausente (decisión D8: María Camila y
       un suplente nombrado por Dirección Técnica).
    2. Si se indican @Integrante1 / @Integrante2 (correos de María Camila y de
       su suplente), los agrega al grupo con motivo. Si quedan vacíos, Calidad
       los agrega desde «Autorizaciones → Tipos de autorización».
    NO carga la lista de APROBADORES AUTORIZADOS: la entrega Calidad y la
    registra María Camila en «Aprobadores autorizados» (pantalla del SGC).
    Mientras la lista esté vacía, el servidor no restringe a los aprobadores.
    Todo queda en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.

  REVERSA: la reversa del Sprint 12 desactiva el tipo (no lo borra).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Integrante1 NVARCHAR(255) = N'subdireccion.reglamentaria@gsslatam.com'; -- p. ej. N'<correo de María Camila>'
DECLARE @Integrante2 NVARCHAR(255) = NULL; -- p. ej. N'<correo del suplente nombrado por Dirección Técnica>'
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 12 (socialización con Calidad OLP 2026-10-07, decisión D8): el firmante sustituto lo asigna solo el grupo exclusivo de Calidad (María Camila y su suplente).';

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-SUSTITUTOS')
  BEGIN
    INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
    VALUES (@IdCompany, N'SGC-SUSTITUTOS', N'Firmantes sustitutos (Calidad)', N'Grupo exclusivo que asigna un firmante sustituto a un cupo pendiente cuando el titular está ausente (con motivo y periodo).', 1, @Actor, @Now, @Now);
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'authorization_type', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), N'autorizacion.tipo_creado', @Motivo, N'{"code":"SGC-SUSTITUTOS"}');
  END;
  DECLARE @Integrantes TABLE (email NVARCHAR(255));
  INSERT INTO @Integrantes SELECT LOWER(LTRIM(RTRIM(e))) FROM (VALUES (@Integrante1), (@Integrante2)) AS x(e) WHERE e IS NOT NULL AND LTRIM(RTRIM(e)) <> N'';
  INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
  SELECT t.id_authorization_type, i.email, @Actor, @Motivo, @Now
  FROM @Integrantes i CROSS JOIN [sgc].[authorization_type] t
  WHERE t.id_company = @IdCompany AND t.code = N'SGC-SUSTITUTOS'
    AND NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.user_email = i.email AND u.revoked_at IS NULL);
  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, @Now, @Actor, N'autorizacion.configurada', N'authorization_type_user', N'SGC-SUSTITUTOS', CONCAT(N'{"email":"', i.email, N'"}'), @Motivo
  FROM @Integrantes i
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[audit_log] a WHERE a.id_company = @IdCompany AND a.entity = N'authorization_type_user' AND a.entity_id = N'SGC-SUSTITUTOS' AND a.after_json = CONCAT(N'{"email":"', i.email, N'"}'));
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT t.code, t.name, t.is_active, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany AND t.code = N'SGC-SUSTITUTOS';
GO
/* GUARDIA · scripts/sgc/pase-produccion/sql/05-correo-avisos-apagado.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== scripts/sgc/pase-produccion/sql/05-correo-avisos-apagado.sql ===== */
/*
  PASE DEL SGC A PRODUCCIÓN — PASO 9b (decisión pendiente de Calidad):
  el SQL del S5 deja el correo de avisos de vencimiento ENCENDIDO por defecto.
  Mientras Calidad no confirme destinatarios y textos, se deja APAGADO (la
  campana/push sigue funcionando). Para encenderlo después: «Calendario de
  vencimientos → Avisos (Calidad)», con motivo (queda en auditoría).
*/
UPDATE sgc.review_alert_config SET email_enabled = 0,
  change_reason = N'Pase a producción: correo de avisos apagado hasta que Aseguramiento de Calidad confirme destinatarios y textos (la campana y el push siguen activos).',
  updated_by = N'nicolas.rivera@gsslatam.com', updated_at = SYSUTCDATETIME()
WHERE id_company = 3 AND scope_key = N'empresa' AND email_enabled = 1;
IF @@ROWCOUNT > 0
  INSERT INTO sgc.audit_log (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  VALUES (3, SYSUTCDATETIME(), N'nicolas.rivera@gsslatam.com', N'vencimiento.configurado', N'review_alert_config', N'empresa', N'{"emailEnabled":false}', N'Pase a producción: correo de avisos apagado hasta confirmación de Calidad.');
SELECT scope_key, offsets_json, email_enabled FROM sgc.review_alert_config WHERE id_company = 3;
GO
/* GUARDIA · verificacion-F2 */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== verificacion-F2 ===== */
SELECT id_company, is_active, storage_root, header_mandatory, email_mode, self_signature_enabled FROM sgc.company_config;
SELECT t.code, (SELECT COUNT(*) FROM sgc.authorization_type_user u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes FROM sgc.authorization_type t WHERE t.id_company = 3 ORDER BY t.code;
IF NOT EXISTS (SELECT 1 FROM sgc.company_config WHERE id_company = 3 AND is_active = 1 AND storage_root = N'SGC/OLP')
  THROW 50902, N'F2: OLP no quedó activa en SGC/OLP.', 1;
IF EXISTS (SELECT 1 FROM sgc.company_config WHERE id_company <> 3 AND is_active = 1)
  THROW 50903, N'F2: hay otra empresa activa en el SGC; solo debe estar OLP.', 1;
IF EXISTS (SELECT 1 FROM sgc.company_config WHERE self_signature_enabled = 1)
  THROW 50904, N'F2: la firma propia (S13) quedó encendida; debe subir apagada.', 1;
IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL THROW 50905, N'F2: el módulo documental viejo sigue en la base.', 1;
GO
