/*
  REVERSA — Conversaciones de Proyectos: renombrar y eliminar (2026-10-29). Deshace
  prisma/migrations/20261029180000_chat_project_conversation_log y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): borra el trigger y la tabla chat_project_conversation_log.

  ⚠️ PÉRDIDA DE DATOS: el registro de quién renombró o eliminó cada conversación. Las conversaciones
  eliminadas siguen con archived = 1 (sus mensajes y adjuntos siguen en la base). Para no perder el
  registro sin querer, exige poner @ConfirmoPerdidaRegistro = 1. Si quiere conservarlo, exporte antes:
    SELECT * FROM dbo.chat_project_conversation_log ORDER BY id_log;
  Para RESTAURAR una conversación eliminada (sin tocar esta tabla):
    UPDATE dbo.chat_conversation SET archived = 0 WHERE id = <id> AND kind = N'project';

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @ConfirmoPerdidaRegistro BIT = 0;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51574, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.chat_project_conversation_log', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.chat_project_conversation_log)
   AND @ConfirmoPerdidaRegistro <> 1
  THROW 51575, N'La tabla tiene registros: expórtelos y ponga @ConfirmoPerdidaRegistro = 1 para continuar.', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.TR_chat_project_conversation_log_inmutable', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[TR_chat_project_conversation_log_inmutable];

IF OBJECT_ID(N'dbo.chat_project_conversation_log', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_conversation_log];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.chat_project_conversation_log', N'U') AS chat_project_conversation_log;
