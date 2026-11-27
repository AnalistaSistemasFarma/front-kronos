/*
  REVERSAL — Several linked requests from one task (2026-11-26). Deploy the previous CODE first.
  Refuses if a task uses it unless: EXEC sp_set_session_context N'flujos_vinculados_reversa_acepta_perdida', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51832, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

DECLARE @n INT = 0;
IF COL_LENGTH(N'dbo.task_process_category', N'linked_multiple') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.task_process_category WHERE linked_multiple = 1', N'@n INT OUTPUT', @n = @n OUTPUT;
IF @n > 0 AND ISNULL(CAST(SESSION_CONTEXT(N'flujos_vinculados_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51833, N'There are tasks with several linked requests: set flujos_vinculados_reversa_acepta_perdida to confirm.', 1;

IF OBJECT_ID(N'dbo.DF_task_process_category_linked_multiple', N'D') IS NOT NULL ALTER TABLE dbo.task_process_category DROP CONSTRAINT DF_task_process_category_linked_multiple;
IF COL_LENGTH(N'dbo.task_process_category', N'linked_multiple') IS NOT NULL ALTER TABLE dbo.task_process_category DROP COLUMN linked_multiple;
SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.task_process_category', N'linked_multiple') AS linked_multiple;
