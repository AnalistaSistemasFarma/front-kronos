/*
  REVERSA — Orden de Procesos por recurrencia (2026-11-04).
  Borra dbo.process_hub_usage. Con el código nuevo en pie no se rompe nada: el hub vuelve a
  ordenar con la copia del navegador de cada persona.
  PÉRDIDA: el conteo de uso guardado en el servidor (se vuelve a armar con el uso).
  Idempotente.
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51613, N'Base no esperada.', 1;
SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') AS process_hub_usage;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') IS NOT NULL DROP TABLE [dbo].[process_hub_usage];
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') AS process_hub_usage;
