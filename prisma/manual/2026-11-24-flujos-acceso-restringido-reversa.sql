/*
  REVERSAL — Restricted access and «SGC templates only» for SynerLink flows (2026-11-24).
  Undoes prisma/manual/2026-11-24-flujos-acceso-restringido-{PRUEBAS,PROD}.sql.
  ORDER: first deploy the previous CODE, then run this reversal.
  Refuses to drop editors or change-log rows unless the session flag is set:
    EXEC sp_set_session_context N'flujos_acceso_reversa_acepta_perdida', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51813, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

DECLARE @editors INT = 0, @logs INT = 0, @restricted INT = 0;
IF OBJECT_ID(N'dbo.process_category_editor', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.process_category_editor', N'@n INT OUTPUT', @n = @editors OUTPUT;
IF OBJECT_ID(N'dbo.process_category_change_log', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.process_category_change_log', N'@n INT OUTPUT', @n = @logs OUTPUT;
IF COL_LENGTH(N'dbo.process_category', N'restricted_access') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.process_category WHERE restricted_access = 1 OR sgc_templates_only = 1', N'@n INT OUTPUT', @n = @restricted OUTPUT;
SELECT DB_NAME() AS db, 'before' AS moment, @editors AS editors, @logs AS change_logs, @restricted AS restricted_flows;

IF (@editors > 0 OR @logs > 0 OR @restricted > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'flujos_acceso_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51814, N'There are editors, change-log rows or restricted flows: set flujos_acceso_reversa_acepta_perdida to confirm.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.process_category_change_log_insert_only', N'TR') IS NOT NULL DROP TRIGGER dbo.process_category_change_log_insert_only;
  IF OBJECT_ID(N'dbo.process_category_change_log', N'U') IS NOT NULL DROP TABLE dbo.process_category_change_log;
  IF OBJECT_ID(N'dbo.process_category_editor', N'U') IS NOT NULL DROP TABLE dbo.process_category_editor;
  IF OBJECT_ID(N'dbo.DF_process_category_sgc_only', N'D') IS NOT NULL ALTER TABLE dbo.process_category DROP CONSTRAINT DF_process_category_sgc_only;
  IF COL_LENGTH(N'dbo.process_category', N'sgc_templates_only') IS NOT NULL ALTER TABLE dbo.process_category DROP COLUMN sgc_templates_only;
  IF OBJECT_ID(N'dbo.DF_process_category_restricted', N'D') IS NOT NULL ALTER TABLE dbo.process_category DROP CONSTRAINT DF_process_category_restricted;
  IF COL_LENGTH(N'dbo.process_category', N'restricted_access') IS NOT NULL ALTER TABLE dbo.process_category DROP COLUMN restricted_access;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, 'after' AS moment, COL_LENGTH(N'dbo.process_category', N'restricted_access') AS restricted_access, OBJECT_ID(N'dbo.process_category_editor', N'U') AS editor_table;
