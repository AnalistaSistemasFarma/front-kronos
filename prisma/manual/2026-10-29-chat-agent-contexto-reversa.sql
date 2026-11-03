/*
  REVERSA — Contexto de la sesión de los agentes y orden «Limpiar contexto» (2026-10-29).
  Deshace 2026-10-29-chat-agent-contexto-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior (o se deja: sin las tablas el widget no muestra
  el contexto y los endpoints responden 503) y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): borra chat_agent_command y chat_agent_context.

  PÉRDIDA DE DATOS: la foto de contexto (se vuelve a publicar en un minuto) y el HISTORIAL de
  órdenes de limpiar contexto. Las órdenes también quedan en la hoja de vida del agente
  (agent_cv_entry, kind = 'contexto'), que esta reversa NO toca.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51563, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.chat_agent_command', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_agent_command];
IF OBJECT_ID(N'dbo.chat_agent_context', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_agent_context];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.chat_agent_context', N'U') AS chat_agent_context,
       OBJECT_ID(N'dbo.chat_agent_command', N'U') AS chat_agent_command;
