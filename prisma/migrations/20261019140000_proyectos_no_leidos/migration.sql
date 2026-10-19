/*
  Migración: proyectos_no_leidos — LECTURA por persona de las conversaciones de PROYECTO.
  Pedido de Nicolás Rivera del 2026-10-19: «quiero que en el header también tenga su iconito y si
  alguien escribe en alguno de los chats se pueda ver». Ver lib/proyectos/no-leidos.ts.

  ADITIVO e IDEMPOTENTE, se puede aplicar en caliente (el código anterior no lee nada de esto):
    - chat_project_read  marca de agua por (conversación, persona): el último mensaje que esa persona
                         ya vio. La misma idea de chat_participant.last_read_message_id del chat, en una
                         tabla aparte porque los miembros de un proyecto no son participantes del chat.
  No copia ni toca datos: sin fila = la persona nunca abrió esa conversación.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/no-leidos-sql.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

IF COL_LENGTH(N'dbo.chat_conversation', N'id_project') IS NULL
  THROW 51502, N'Falta la migración 20261017120000_chat_projects (chat_conversation.id_project). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_read]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_read] (
    [id_project_read]      INT            IDENTITY(1,1) NOT NULL,
    [id_conversation]      INT            NOT NULL,
    [id_user]              NVARCHAR(1000) NOT NULL,
    [last_read_message_id] INT            NOT NULL,
    [updated_at]           DATETIME2      NOT NULL CONSTRAINT [chat_project_read_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_read_pkey] PRIMARY KEY CLUSTERED ([id_project_read]),
    CONSTRAINT [chat_project_read_id_conversation_fkey] FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_read_conversation_user' AND object_id = OBJECT_ID(N'[dbo].[chat_project_read]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_read_conversation_user] ON [dbo].[chat_project_read]([id_conversation], [id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_read_id_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_read]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_read_id_user_idx] ON [dbo].[chat_project_read]([id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_read_last_read_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_read] WITH CHECK ADD CONSTRAINT [chat_project_read_last_read_ck] CHECK ([last_read_message_id] >= 0);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
