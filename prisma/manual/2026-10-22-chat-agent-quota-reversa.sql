/*
  REVERSA — Medidor del consumo de Anthropic (2026-10-22). Deshace
  prisma/migrations/20261022120000_chat_agent_quota y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): borra la tabla chat_agent_quota.

  PÉRDIDA DE DATOS: solo el último cupo reportado por cada agente; el puente lo vuelve a publicar en
  minutos si la tabla se crea otra vez. Por eso no exige bandera de pérdida.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51547, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.chat_agent_quota', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_agent_quota];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.chat_agent_quota', N'U') AS chat_agent_quota;
