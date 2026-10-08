/*
  REVERSA de la migración 20261008140000_sgc_s12_aprobadores_sustitutos (SGC,
  Sprint 12) y de su dato (tipo de autorización SGC-SUSTITUTOS, que se
  DESACTIVA, no se borra). Se corre ANTES que la del Sprint 11.

  Quita las tablas approver_authorization y signer_substitution (con sus
  triggers), la columna task_assignee.on_behalf_of y la columna
  company_config.approver_list_enforced (con su DEFAULT), y borra el registro
  de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Se pierde la LISTA de aprobadores autorizados y el HISTORIAL de
  sustituciones (exportarlos antes). Si hay alguna de las dos, la reversa se
  niega, salvo sgc_reversa_sustitutos = 1 en la sesión.
  ⚠️ signature.on_behalf_of SOLO se quita si ninguna firma la usa: una firma
  hecha por un sustituto lleva «en sustitución de» dentro de su registro
  encadenado (record_hash). Borrar ese dato haría ver la firma como alterada,
  así que en ese caso la columna SE CONSERVA (es nullable y el código anterior
  no la lee) y la reversa lo informa.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @datos INT = 0;
IF OBJECT_ID(N'[sgc].[approver_authorization]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[approver_authorization]', N'@n INT OUTPUT', @n = @datos OUTPUT;
DECLARE @sust INT = 0;
IF OBJECT_ID(N'[sgc].[signer_substitution]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[signer_substitution]', N'@n INT OUTPUT', @n = @sust OUTPUT;
IF (@datos + @sust) > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_sustitutos') AS INT) IS NULL
  THROW 51102, N'Hay aprobadores autorizados o sustituciones de firmantes: exporte la lista y el historial y declare sgc_reversa_sustitutos = 1 antes de la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008140000_sgc_s12_aprobadores_sustitutos';

UPDATE [sgc].[authorization_type] SET [is_active] = 0, [updated_by] = N'reversa-s12', [updated_at] = SYSUTCDATETIME() WHERE [code] = N'SGC-SUSTITUTOS' AND [is_active] = 1;

IF OBJECT_ID(N'[sgc].[signer_substitution_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signer_substitution_solo_insercion];
IF OBJECT_ID(N'[sgc].[signer_substitution]', N'U') IS NOT NULL DROP TABLE [sgc].[signer_substitution];
IF OBJECT_ID(N'[sgc].[approver_authorization_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[approver_authorization_sin_borrado];
IF OBJECT_ID(N'[sgc].[approver_authorization]', N'U') IS NOT NULL DROP TABLE [sgc].[approver_authorization];

IF COL_LENGTH(N'sgc.task_assignee', N'on_behalf_of') IS NOT NULL
  ALTER TABLE [sgc].[task_assignee] DROP COLUMN [on_behalf_of];

DECLARE @firmasSust INT = 0;
IF COL_LENGTH(N'sgc.signature', N'on_behalf_of') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[signature] WHERE [on_behalf_of] IS NOT NULL', N'@n INT OUTPUT', @n = @firmasSust OUTPUT;
  IF @firmasSust = 0
    ALTER TABLE [sgc].[signature] DROP COLUMN [on_behalf_of];
  ELSE
    PRINT CONCAT(N'AVISO: se CONSERVA sgc.signature.on_behalf_of: ', @firmasSust, N' firma(s) de sustitutos la llevan en su registro encadenado.');
END;

DECLARE @df SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'approver_list_enforced');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.company_config', N'approver_list_enforced') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [approver_list_enforced];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008140000_sgc_s12_aprobadores_sustitutos';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
