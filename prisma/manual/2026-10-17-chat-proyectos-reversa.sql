/*
  REVERSA — Proyectos (hilos de agente) del chat. Deshace
  prisma/manual/2026-10-17-chat-proyectos-PRUEBAS.sql / -PROD.sql (y la
  migración 20261017120000_chat_projects).

  ⚠️ ORDEN: primero se revierte el CÓDIGO (o se apaga CHAT_PROJECTS_AGENTS y
  se despliega la versión anterior) y DESPUÉS esta reversa: con el código
  nuevo arriba y la columna borrada, TODO el chat falla.

  PÉRDIDA DE DATOS: borra las conversaciones de proyecto (con sus mensajes,
  adjuntos, estados y consumo, por cascada), los proyectos, sus miembros y sus
  archivos (las referencias; los archivos de OneDrive quedan). Si hay
  proyectos, el script se DETIENE salvo que la sesión declare que acepta
  perderlos:
      EXEC sp_set_session_context N'chat_proyectos_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51472, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.chat_project', N'U') IS NOT NULL
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'chat_proyectos_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @hay INT;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project', N'@n INT OUTPUT', @n = @hay OUTPUT;
  IF @hay > 0
    THROW 51473, N'Hay proyectos registrados. Respáldelos y declare chat_proyectos_reversa_acepta_perdida = 1.', 1;
END;

BEGIN TRY
BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.chat_conversation', N'id_project') IS NOT NULL
    EXEC(N'DELETE FROM [dbo].[chat_conversation] WHERE [kind] = ''project'' OR [id_project] IS NOT NULL;');

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_project_ck')
    ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_project_ck];

  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_conversation_id_project_fkey')
    ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_id_project_fkey];

  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_conversation_id_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
    DROP INDEX [chat_conversation_id_project_idx] ON [dbo].[chat_conversation];

  IF COL_LENGTH(N'dbo.chat_conversation', N'id_project') IS NOT NULL
    ALTER TABLE [dbo].[chat_conversation] DROP COLUMN [id_project];

  -- El CHECK de kind vuelve a las tres clases de antes.
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck' AND definition LIKE '%project%')
  BEGIN
    ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_kind_ck];
    EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
      ADD CONSTRAINT [chat_conversation_kind_ck]
      CHECK ([kind] IN (''direct'', ''group'', ''people''));');
  END;

  IF OBJECT_ID(N'dbo.chat_project_file', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_file];
  IF OBJECT_ID(N'dbo.chat_project_member', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_member];
  IF OBJECT_ID(N'dbo.chat_project', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project];

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

PRINT N'Reversa de proyectos del chat aplicada.';
