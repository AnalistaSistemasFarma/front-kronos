/*
  REVERSA — Errores de IA (2026-11-03). Primero el código anterior (o se deja: sin tablas la
  pantalla dice «aún no habilitado» y el recolector recibe 503), después esto.
  PÉRDIDA: el historial de errores y su estado (resuelto/silenciado). El recolector vuelve a
  llenar lo que siga en los logs de los equipos.
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51603, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_error_event', N'U') IS NOT NULL DROP TABLE [dbo].[agent_error_event];
IF OBJECT_ID(N'dbo.agent_error_issue', N'U') IS NOT NULL DROP TABLE [dbo].[agent_error_issue];
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_error_issue', N'U') AS agent_error_issue, OBJECT_ID(N'dbo.agent_error_event', N'U') AS agent_error_event;
