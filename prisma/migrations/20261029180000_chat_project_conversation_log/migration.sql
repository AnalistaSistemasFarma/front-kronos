/*
  Migración: RENOMBRAR y ELIMINAR conversaciones de un proyecto (2026-10-29).
  Pedido de Nicolás Rivera (2026-10-29, 17:45 COT): varios agentes por hilo, renombrar y eliminar hilos.

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente. Crea UNA tabla nueva y aparte,
  chat_project_conversation_log (registro inmutable de quién renombró o eliminó qué y cuándo), y no
  toca ni copia ningún dato existente. El borrado es LÓGICO con la columna que YA existe
  chat_conversation.archived: mensajes y adjuntos no se borran.

  ORDEN: antes o después del código. Sin la tabla, renombrar y eliminar responden 503 (no se cambia
  nada sin registro) y todo lo demás sigue igual.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/hilos-sql.test.ts verifica que no se separen).
*/

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
