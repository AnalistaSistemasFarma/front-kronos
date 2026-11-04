/*
  REVERSA — Automatizaciones programadas (2026-11-04). Primero el código anterior (o se deja: sin la
  tabla la pestaña dice «aún no habilitado» y el indicador del chat sigue igual), después esto.
  PÉRDIDA: el inventario publicado (el recolector lo vuelve a armar en su siguiente corrida).
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51595, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_scheduled_job', N'U') IS NOT NULL DROP TABLE [dbo].[agent_scheduled_job];
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_scheduled_job', N'U') AS agent_scheduled_job;
