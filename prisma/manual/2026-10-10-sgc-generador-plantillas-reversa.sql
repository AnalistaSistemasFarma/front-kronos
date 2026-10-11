/*
  REVERSA de la migración 20261010100000_sgc_generador_plantillas (Generador
  de documentos desde plantillas aprobadas por Calidad) y de su dato
  (generator_enabled). Se corre ANTES que la reversa del Sprint 13.

  Quita las tablas generated_document, generator_template_version y
  generator_template (con sus triggers y CHECK) y la columna
  company_config.generator_enabled (con su DEFAULT), y borra el registro de la
  migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Se pierden las plantillas y los REGISTROS GENERADOS (su consecutivo, sus
  valores y la referencia a su PDF en OneDrive; los PDF quedan en OneDrive):
  expórtelos antes. Si hay algún dato la reversa se niega, salvo
  sgc_reversa_generador = 1 en la sesión.

  Guarda de base: solo KRONOSDB_PRUEBAS (o la CI); en otra base exige
  sgc_generador_bd_autorizada = 1 en la sesión.
  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') AND ISNULL(TRY_CAST(SESSION_CONTEXT(N'sgc_generador_bd_autorizada') AS INT), 0) <> 1
  THROW 51108, N'Generador SGC: esta reversa es para KRONOSDB_PRUEBAS. En otra base declare sgc_generador_bd_autorizada = 1 con la autorización del pase.', 1;

DECLARE @datos INT = 0;
DECLARE @n INT;
IF OBJECT_ID(N'[sgc].[generator_template]', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[generator_template]', N'@n INT OUTPUT', @n = @n OUTPUT;
  SET @datos += @n;
END;
IF OBJECT_ID(N'[sgc].[generated_document]', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[generated_document]', N'@n INT OUTPUT', @n = @n OUTPUT;
  SET @datos += @n;
END;
IF @datos > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_generador') AS INT) IS NULL
  THROW 51109, N'Hay plantillas o registros generados: exporte su historial y declare sgc_reversa_generador = 1 antes de la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261010100000_sgc_generador_plantillas';

IF OBJECT_ID(N'[sgc].[generated_document_inmutable]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[generated_document_inmutable];
IF OBJECT_ID(N'[sgc].[generated_document]', N'U') IS NOT NULL DROP TABLE [sgc].[generated_document];
IF OBJECT_ID(N'[sgc].[generator_template_version_inmutable]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[generator_template_version_inmutable];
IF OBJECT_ID(N'[sgc].[generator_template_version]', N'U') IS NOT NULL DROP TABLE [sgc].[generator_template_version];
IF OBJECT_ID(N'[sgc].[generator_template_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[generator_template_sin_borrado];
IF OBJECT_ID(N'[sgc].[generator_template]', N'U') IS NOT NULL DROP TABLE [sgc].[generator_template];

DECLARE @df SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'generator_enabled');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.company_config', N'generator_enabled') IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP COLUMN [generator_enabled]');

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261010100000_sgc_generador_plantillas';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
