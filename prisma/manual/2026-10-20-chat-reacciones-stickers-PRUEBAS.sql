/*
  PASE MANUAL (PRUEBAS) — Reacciones, GIF y stickers del chat (2026-10-20).
  Pedido de Nicolás Rivera del 2026-10-20. NO lo corre el agente que hizo el PR: se corre con el
  visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261020120000_chat_reacciones_stickers/migration.sql:
    las tablas NUEVAS chat_sticker, chat_message_media y chat_message_reaction, con sus índices y
    sus CHECK. No altera chat_message (ni su CHECK de event_type) ni ninguna tabla existente.

  ORDEN: este script puede ir ANTES o DESPUÉS del código. Si el código sale primero, el chat sigue
  funcionando igual y solo las reacciones, los GIF y los stickers responden «aún no disponible»
  (lib/chat/message-extras.ts tolera la tabla ausente).

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261020120000_chat_reacciones_stickers
  REVERSA: prisma/manual/2026-10-20-chat-reacciones-stickers-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51520, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- 1. chat_sticker ------------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_sticker]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_sticker] (
    [id_sticker]   INT            IDENTITY(1,1) NOT NULL,
    [id_company]   INT            NULL,
    [label]        NVARCHAR(80)   NOT NULL,
    [keywords]     NVARCHAR(300)  NULL,
    [content_type] NVARCHAR(50)   NOT NULL,
    [image_data]   VARBINARY(MAX) NOT NULL,
    [size_bytes]   INT            NOT NULL,
    [sort_order]   INT            NOT NULL CONSTRAINT [chat_sticker_sort_order_df] DEFAULT 0,
    [active]       BIT            NOT NULL CONSTRAINT [chat_sticker_active_df] DEFAULT 1,
    [created_by]   NVARCHAR(1000) NOT NULL,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [chat_sticker_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]   DATETIME2      NOT NULL CONSTRAINT [chat_sticker_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_sticker_pkey] PRIMARY KEY CLUSTERED ([id_sticker]),
    CONSTRAINT [chat_sticker_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_sticker_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_sticker_company_active_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_sticker]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_sticker_company_active_idx] ON [dbo].[chat_sticker]([id_company], [active], [sort_order]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_sticker_content_type_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_sticker] WITH CHECK ADD CONSTRAINT [chat_sticker_content_type_ck] CHECK ([content_type] IN (N''image/png'', N''image/webp'', N''image/gif''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_sticker_size_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_sticker] WITH CHECK ADD CONSTRAINT [chat_sticker_size_ck] CHECK ([size_bytes] > 0 AND [size_bytes] <= 524288 AND DATALENGTH([image_data]) = [size_bytes]);');

/* ---- 2. chat_message_media ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_message_media]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_message_media] (
    [id_message]  INT            NOT NULL,
    [kind]        NVARCHAR(20)   NOT NULL,
    [provider]    NVARCHAR(20)   NOT NULL,
    [external_id] NVARCHAR(100)  NULL,
    [id_sticker]  INT            NULL,
    [title]       NVARCHAR(200)  NULL,
    [media_url]   NVARCHAR(1000) NULL,
    [width]       INT            NULL,
    [height]      INT            NULL,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [chat_message_media_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_message_media_pkey] PRIMARY KEY CLUSTERED ([id_message]),
    CONSTRAINT [chat_message_media_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [chat_message_media_id_sticker_fkey] FOREIGN KEY ([id_sticker]) REFERENCES [dbo].[chat_sticker]([id_sticker]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_media_id_sticker_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message_media]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_message_media_id_sticker_idx] ON [dbo].[chat_message_media]([id_sticker]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_media_kind_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_message_media] WITH CHECK ADD CONSTRAINT [chat_message_media_kind_ck] CHECK ([kind] IN (N''gif'', N''sticker''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_media_provider_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_message_media] WITH CHECK ADD CONSTRAINT [chat_message_media_provider_ck] CHECK (([kind] = N''gif'' AND [provider] = N''giphy'' AND [external_id] IS NOT NULL) OR ([kind] = N''sticker'' AND [provider] = N''gss'' AND [external_id] IS NOT NULL) OR ([kind] = N''sticker'' AND [provider] = N''empresa'' AND [id_sticker] IS NOT NULL));');

/* ---- 3. chat_message_reaction ---------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_message_reaction]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_message_reaction] (
    [id]              INT            IDENTITY(1,1) NOT NULL,
    [id_message]      INT            NOT NULL,
    [id_conversation] INT            NOT NULL,
    [id_user]         NVARCHAR(1000) NOT NULL,
    [emoji]           NVARCHAR(32)   NOT NULL,
    [active]          BIT            NOT NULL CONSTRAINT [chat_message_reaction_active_df] DEFAULT 1,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_message_reaction_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_message_reaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [chat_message_reaction_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [chat_message_reaction_id_user_fkey] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_reaction_message_user_emoji' AND object_id = OBJECT_ID(N'[dbo].[chat_message_reaction]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_message_reaction_message_user_emoji] ON [dbo].[chat_message_reaction]([id_message], [id_user], [emoji]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_reaction_conversation_id_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message_reaction]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_message_reaction_conversation_id_idx] ON [dbo].[chat_message_reaction]([id_conversation], [id]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_reaction_id_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message_reaction]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_message_reaction_id_user_idx] ON [dbo].[chat_message_reaction]([id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_reaction_emoji_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_message_reaction] WITH CHECK ADD CONSTRAINT [chat_message_reaction_emoji_ck] CHECK (LEN([emoji]) >= 1);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.chat_sticker', N'U') AS chat_sticker,
       OBJECT_ID(N'dbo.chat_message_media', N'U') AS chat_message_media,
       OBJECT_ID(N'dbo.chat_message_reaction', N'U') AS chat_message_reaction;
