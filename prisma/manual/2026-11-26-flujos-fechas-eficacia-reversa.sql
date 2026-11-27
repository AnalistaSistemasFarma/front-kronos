/*
  REVERSAL — Committed dates and deferred tasks (2026-11-26). Deploy the previous CODE first.
  Refuses if there is configuration or pending deferred tasks unless:
    EXEC sp_set_session_context N'flujos_fechas_reversa_acepta_perdida', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51842, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

DECLARE @cfg INT = 0, @def INT = 0, @delay INT = 0;
IF OBJECT_ID(N'dbo.process_date_tracking', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.process_date_tracking', N'@n INT OUTPUT', @n = @cfg OUTPUT;
IF OBJECT_ID(N'dbo.task_deferred', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.task_deferred WHERE done_at IS NULL', N'@n INT OUTPUT', @n = @def OUTPUT;
IF COL_LENGTH(N'dbo.task_process_category', N'start_delay_days') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.task_process_category WHERE start_delay_days IS NOT NULL', N'@n INT OUTPUT', @n = @delay OUTPUT;
SELECT DB_NAME() AS db, 'before' AS moment, @cfg AS tracking_configs, @def AS pending_deferred, @delay AS delayed_tasks;
IF (@cfg > 0 OR @def > 0 OR @delay > 0) AND ISNULL(CAST(SESSION_CONTEXT(N'flujos_fechas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51843, N'There is configuration or pending deferred tasks: set flujos_fechas_reversa_acepta_perdida to confirm.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'DELETE r FROM dbo.scheduled_job_run r JOIN dbo.scheduled_job j ON j.id = r.id_job WHERE j.job_type = N''workflow_followups'';';
    EXEC sp_executesql N'DELETE FROM dbo.scheduled_job WHERE job_type = N''workflow_followups'';';
  END;
  IF OBJECT_ID(N'dbo.task_deferred', N'U') IS NOT NULL DROP TABLE dbo.task_deferred;
  IF COL_LENGTH(N'dbo.task_process_category', N'start_delay_days') IS NOT NULL ALTER TABLE dbo.task_process_category DROP COLUMN start_delay_days;
  IF OBJECT_ID(N'dbo.process_date_tracking', N'U') IS NOT NULL DROP TABLE dbo.process_date_tracking;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
SELECT DB_NAME() AS db, 'after' AS moment, OBJECT_ID(N'dbo.task_deferred', N'U') AS task_deferred;
