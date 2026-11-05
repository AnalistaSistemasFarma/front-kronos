/*
  REVERSA — Automatizaciones programadas: administrar y detectar las muertas (2026-11-04).
  Primero el código anterior (o se deja: sin estas columnas y sin la tabla de órdenes el indicador
  funciona como antes y «Administrar» responde 503), después esto.
  PÉRDIDA: el historial de órdenes (también queda en la hoja de vida de cada agente) y las
  columnas ref/horario_json/ultimas_json (el recolector las vuelve a llenar si se reaplica el pase).
  No toca dbo.agent_scheduled_job en sí (su reversa es 2026-11-04-automatizaciones-programadas-reversa.sql).
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51598, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_scheduled_job_command', N'U') IS NOT NULL DROP TABLE [dbo].[agent_scheduled_job_command];
IF OBJECT_ID(N'dbo.agent_scheduled_job', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.agent_scheduled_job', N'ultimas_json') IS NOT NULL ALTER TABLE [dbo].[agent_scheduled_job] DROP COLUMN [ultimas_json];
  IF COL_LENGTH(N'dbo.agent_scheduled_job', N'horario_json') IS NOT NULL ALTER TABLE [dbo].[agent_scheduled_job] DROP COLUMN [horario_json];
  IF COL_LENGTH(N'dbo.agent_scheduled_job', N'ref') IS NOT NULL ALTER TABLE [dbo].[agent_scheduled_job] DROP COLUMN [ref];
END;
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_scheduled_job_command', N'U') AS agent_scheduled_job_command,
       COL_LENGTH(N'dbo.agent_scheduled_job', N'ref') AS ref;
