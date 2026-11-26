/*
  Migration: chat_agent_initiated_message — messages an agent sends ON ITS OWN to a person — 2026-11-24.
  Approved by Nicolás Rivera (SynerLink conv 1, msgs 38807–38809). See mcp/src/tools/agentMessage.ts
  (kronos-mcp tool chat_enviar_mensaje_usuario) and lib/chat/agent-initiated.ts.

  ADDITIVE and IDEMPOTENT, safe to apply hot (the previous code does not read any of this):
    - chat_agent_initiated_message  one row per agent-initiated message: audit (key, recipient,
                                    reason, time), daily limits, UI badge, inbox context and the
                                    once-only push guard. PK = id_message (FK to chat_message,
                                    ON DELETE CASCADE, like chat_message_media).
  chat_message and its event_type CHECK do not change. No data is copied or changed.

  BLOQUE-DDL-INICIO (the manual PRUEBAS and PROD scripts repeat this block verbatim;
  lib/chat/__tests__/agent-initiated-sql.test.ts checks they stay in sync).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_message]', N'U') IS NULL
  THROW 52401, N'Missing table dbo.chat_message (migration 20260906120000_add_chat_agents). Apply it first.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_agent_initiated_message]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_initiated_message] (
    [id_message]           INT            NOT NULL,
    [id_conversation]      INT            NOT NULL,
    [id_agent]             INT            NOT NULL,
    [id_user]              NVARCHAR(1000) NOT NULL,
    [reason]               NVARCHAR(300)  NOT NULL,
    [requested_by]         NVARCHAR(120)  NOT NULL,
    [conversation_created] BIT            NOT NULL CONSTRAINT [chat_agent_initiated_message_conversation_created_df] DEFAULT 0,
    [push_sent_at]         DATETIME2      NULL,
    [created_at]           DATETIME2      NOT NULL CONSTRAINT [chat_agent_initiated_message_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_agent_initiated_message_pkey] PRIMARY KEY CLUSTERED ([id_message]),
    CONSTRAINT [chat_agent_initiated_message_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_agent_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_agent_idx] ON [dbo].[chat_agent_initiated_message]([id_agent], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_user_idx] ON [dbo].[chat_agent_initiated_message]([id_user], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_conversation_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_conversation_idx] ON [dbo].[chat_agent_initiated_message]([id_conversation], [id_message]);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
