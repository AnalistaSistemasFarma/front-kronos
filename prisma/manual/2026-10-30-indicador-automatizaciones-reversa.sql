/*
  REVERSA — Indicador de automatizaciones (2026-10-30). Primero el código anterior (o se deja: sin
  tablas la pantalla dice «aún no habilitado»), después esto. PÉRDIDA: cortes y corridas del
  análisis (se pueden volver a calcular).
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51593, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_automation_case', N'U') IS NOT NULL DROP TABLE [dbo].[agent_automation_case];
IF OBJECT_ID(N'dbo.agent_automation_run', N'U') IS NOT NULL DROP TABLE [dbo].[agent_automation_run];
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_automation_case', N'U') AS agent_automation_case, OBJECT_ID(N'dbo.agent_automation_run', N'U') AS agent_automation_run;
