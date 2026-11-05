/*
  PASE MANUAL (PRUEBAS) — Conversaciones de Proyectos: renombrar y eliminar (2026-10-29).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261029180000_chat_project_conversation_log/migration.sql:
    la tabla NUEVA chat_project_conversation_log (registro inmutable), sus índices, el CHECK y el
    trigger que impide cambiar o borrar filas.

  ORDEN: puede ir antes o después del código. Sin la tabla, renombrar/eliminar responden 503 y el
  resto del módulo sigue igual. Para el multiagente (menciones) NO hace falta SQL.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261029180000_chat_project_conversation_log
  REVERSA: prisma/manual/2026-10-29-chat-project-conversation-log-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51572, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- chat_project_conversation_log ----------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_conversation_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_conversation_log] (
    [id_log]          INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [id_conversation] INT            NOT NULL,
    [action]          NVARCHAR(20)   NOT NULL,
    [title_before]    NVARCHAR(300)  NULL,
    [title_after]     NVARCHAR(300)  NULL,
    [changed_by]      NVARCHAR(1000) NOT NULL,
    [changed_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_conversation_log_changed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_conversation_log_pkey] PRIMARY KEY CLUSTERED ([id_log])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_conversation_log_conv_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_conversation_log]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_conversation_log_conv_idx] ON [dbo].[chat_project_conversation_log]([id_conversation], [changed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_conversation_log_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_conversation_log]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_conversation_log_project_idx] ON [dbo].[chat_project_conversation_log]([id_project], [changed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_conversation_log_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_conversation_log] WITH CHECK ADD CONSTRAINT [chat_project_conversation_log_valores_ck]
    CHECK ([action] IN (N''renombrar'', N''eliminar'') AND LEN([changed_by]) > 0);');

IF OBJECT_ID(N'[dbo].[TR_chat_project_conversation_log_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_conversation_log_inmutable] ON [dbo].[chat_project_conversation_log]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51571, N''El registro de cambios de las conversaciones de Proyectos no se cambia ni se borra.'', 1;
    END;');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.chat_project_conversation_log', N'U') AS chat_project_conversation_log,
       OBJECT_ID(N'dbo.TR_chat_project_conversation_log_inmutable', N'TR') AS trigger_inmutable;
