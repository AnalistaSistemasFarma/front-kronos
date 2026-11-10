/* REVERSA — Ventas: automatización (2026-11-03-ventas-automatizacion-{PRUEBAS,PROD}.sql).
   Borra la tarea del programador y las tablas sales_automation_*. */
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB') THROW 51510, N'Base no esperada.', 1;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NOT NULL
    EXEC sp_executesql N'DELETE r FROM dbo.scheduled_job_run r JOIN dbo.scheduled_job j ON j.id = r.id_job WHERE j.job_type = N''ventas_automatizar'';
                         DELETE FROM dbo.scheduled_job WHERE job_type = N''ventas_automatizar'';';
  IF OBJECT_ID(N'dbo.sales_automation_run', N'U') IS NOT NULL DROP TABLE [dbo].[sales_automation_run];
  IF OBJECT_ID(N'dbo.sales_automation_doc', N'U') IS NOT NULL DROP TABLE [dbo].[sales_automation_doc];
  IF OBJECT_ID(N'dbo.sales_automation_config', N'U') IS NOT NULL DROP TABLE [dbo].[sales_automation_config];
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.sales_automation_config', N'U') AS tabla_config;
