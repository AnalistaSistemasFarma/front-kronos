/*
  REVERSA de la migración 20261008110000_sgc_s9_archivos_relaciones_correo
  (SGC, Sprint 9: carga masiva de PDF, relaciones propuestas, cierre de la
  carga inicial y política de correo). Se corre ANTES que la del Sprint 8.

  Deja el esquema `sgc` como estaba al cerrar el Sprint 8: quita las tablas
  bulk_upload y bulk_upload_item (con sus triggers), las columnas nuevas de
  document_relation y company_config (con sus CHECK y DEFAULT) y borra el
  registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Las relaciones PROPUESTAS (aún sin confirmar) quedarían visibles como si
  estuvieran confirmadas: la reversa las RETIRA (is_active = 0, con motivo)
  antes de quitar la columna. Si hay alguna, exige declarar
  sgc_reversa_propuestas = 1 en la sesión. Exportar antes sgc.bulk_upload y
  sgc.bulk_upload_item si se necesitan como evidencia (los documentos y sus
  versiones cargados por la carga masiva NO se tocan).
  ⚠️ El cierre de la carga inicial vive en columnas del Sprint 8: no se revierte aquí.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @propuestas INT = 0;
IF COL_LENGTH(N'sgc.document_relation', N'status') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[document_relation] WHERE [status] = N''propuesta'' AND [is_active] = 1', N'@n INT OUTPUT', @n = @propuestas OUTPUT;
IF @propuestas > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_propuestas') AS INT) IS NULL
  THROW 51072, N'Hay relaciones propuestas sin confirmar: declare sgc_reversa_propuestas = 1 para retirarlas antes de la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008110000_sgc_s9_archivos_relaciones_correo';

IF @propuestas > 0
  EXEC sp_executesql N'UPDATE [sgc].[document_relation] SET [is_active] = 0, [removed_by] = N''reversa-s9'', [removed_at] = SYSUTCDATETIME(), [remove_reason] = N''Reversa del Sprint 9: relación propuesta sin confirmar.'' WHERE [status] = N''propuesta'' AND [is_active] = 1;';

IF OBJECT_ID(N'[sgc].[bulk_upload_item_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[bulk_upload_item_solo_insercion];
IF OBJECT_ID(N'[sgc].[bulk_upload_item]', N'U') IS NOT NULL
  DROP TABLE [sgc].[bulk_upload_item];
IF OBJECT_ID(N'[sgc].[bulk_upload_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[bulk_upload_solo_insercion];
IF OBJECT_ID(N'[sgc].[bulk_upload]', N'U') IS NOT NULL
  DROP TABLE [sgc].[bulk_upload];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
  ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [document_relation_origen_estado_ck];
DECLARE @df SYSNAME;
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[document_relation]') AND c.name = N'origin');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [' + @df + N']');
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[document_relation]') AND c.name = N'status');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.document_relation', N'origin') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [origin];
IF COL_LENGTH(N'sgc.document_relation', N'status') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [status];
IF COL_LENGTH(N'sgc.document_relation', N'confirmed_by') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [confirmed_by];
IF COL_LENGTH(N'sgc.document_relation', N'confirmed_at') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [confirmed_at];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_email_mode_ck')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_email_mode_ck];
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'email_mode');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.company_config', N'email_mode') IS NOT NULL ALTER TABLE [sgc].[company_config] DROP COLUMN [email_mode];
IF COL_LENGTH(N'sgc.company_config', N'email_digest_last_date') IS NOT NULL ALTER TABLE [sgc].[company_config] DROP COLUMN [email_digest_last_date];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008110000_sgc_s9_archivos_relaciones_correo';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
