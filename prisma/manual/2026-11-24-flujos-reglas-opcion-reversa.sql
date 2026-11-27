/*
  REVERSAL — Option rules for SynerLink flows (2026-11-24). Undoes 2026-11-24-flujos-reglas-opcion-{PRUEBAS,PROD}.sql.
  ORDER: first deploy the previous CODE, then run this reversal.
  Refuses to drop rules, assignees, counters or request consecutives unless the session flag is set:
    EXEC sp_set_session_context N'flujos_reglas_reversa_acepta_perdida', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51822, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

DECLARE @rules INT = 0, @assignees INT = 0, @counters INT = 0, @consecutives INT = 0;
IF OBJECT_ID(N'dbo.process_option_rule', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.process_option_rule', N'@n INT OUTPUT', @n = @rules OUTPUT;
IF OBJECT_ID(N'dbo.task_option_assignee', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.task_option_assignee', N'@n INT OUTPUT', @n = @assignees OUTPUT;
IF OBJECT_ID(N'dbo.request_consecutive_counter', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.request_consecutive_counter', N'@n INT OUTPUT', @n = @counters OUTPUT;
IF COL_LENGTH(N'dbo.requests_general', N'consecutive') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.requests_general WHERE consecutive IS NOT NULL OR sla_value IS NOT NULL', N'@n INT OUTPUT', @n = @consecutives OUTPUT;
SELECT DB_NAME() AS db, 'before' AS moment, @rules AS rules, @assignees AS assignees, @counters AS counters, @consecutives AS requests_with_data;

IF (@rules > 0 OR @assignees > 0 OR @counters > 0 OR @consecutives > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'flujos_reglas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51823, N'There are rules, assignees, counters or request consecutives: set flujos_reglas_reversa_acepta_perdida to confirm.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_requests_general_consecutive' AND object_id = OBJECT_ID(N'dbo.requests_general')) DROP INDEX IX_requests_general_consecutive ON dbo.requests_general;
  IF OBJECT_ID(N'dbo.request_consecutive_counter', N'U') IS NOT NULL DROP TABLE dbo.request_consecutive_counter;
  IF OBJECT_ID(N'dbo.task_option_assignee', N'U') IS NOT NULL DROP TABLE dbo.task_option_assignee;
  IF OBJECT_ID(N'dbo.process_option_rule', N'U') IS NOT NULL DROP TABLE dbo.process_option_rule;
  IF COL_LENGTH(N'dbo.requests_general', N'sla_unit') IS NOT NULL ALTER TABLE dbo.requests_general DROP COLUMN sla_unit;
  IF COL_LENGTH(N'dbo.requests_general', N'sla_value') IS NOT NULL ALTER TABLE dbo.requests_general DROP COLUMN sla_value;
  IF COL_LENGTH(N'dbo.requests_general', N'consecutive') IS NOT NULL ALTER TABLE dbo.requests_general DROP COLUMN consecutive;
  IF COL_LENGTH(N'dbo.process_category', N'consecutive_prefix') IS NOT NULL ALTER TABLE dbo.process_category DROP COLUMN consecutive_prefix;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, 'after' AS moment, OBJECT_ID(N'dbo.process_option_rule', N'U') AS option_rule, COL_LENGTH(N'dbo.requests_general', N'consecutive') AS request_consecutive;
