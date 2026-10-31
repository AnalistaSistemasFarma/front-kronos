/*
  REVERSA — Auditoría de agentes → Casos de uso (2026-10-29).
  Primero el código anterior (o se deja: sin tablas la pantalla dice «aún no habilitado»), después esto.
  PÉRDIDA DE DATOS: los cortes cargados del análisis (se pueden volver a cargar).
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51583, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_use_case', N'U') IS NOT NULL DROP TABLE [dbo].[agent_use_case];
IF OBJECT_ID(N'dbo.agent_use_summary', N'U') IS NOT NULL DROP TABLE [dbo].[agent_use_summary];
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_use_summary', N'U') AS agent_use_summary, OBJECT_ID(N'dbo.agent_use_case', N'U') AS agent_use_case;
