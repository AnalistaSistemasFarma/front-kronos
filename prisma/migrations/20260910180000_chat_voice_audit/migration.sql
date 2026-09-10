-- Additive, idempotent. The call identity is captured by the authenticated
-- browser route, never accepted from a connector transcript payload.
IF OBJECT_ID(N'dbo.chat_voice_call', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_voice_call] (
    [id] VARCHAR(36) NOT NULL PRIMARY KEY,
    [id_conversation] INT NOT NULL,
    [id_agent] INT NOT NULL,
    [id_user] NVARCHAR(1000) NOT NULL,
    [client_ip] NVARCHAR(64) NULL,
    [user_agent] NVARCHAR(400) NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
    [expires_at] DATETIME2 NOT NULL
  );
  EXEC('CREATE INDEX chat_voice_call_id_conversation_idx ON dbo.chat_voice_call(id_conversation)');
END;
IF OBJECT_ID(N'dbo.chat_voice_event', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_voice_event] (
    [event_key] VARCHAR(64) NOT NULL PRIMARY KEY,
    [call_id] VARCHAR(36) NOT NULL,
    [id_message] INT NOT NULL,
    CONSTRAINT [chat_voice_event_id_message_key] UNIQUE ([id_message]),
    CONSTRAINT [chat_voice_event_call_id_fkey] FOREIGN KEY ([call_id]) REFERENCES [dbo].[chat_voice_call]([id]) ON DELETE CASCADE,
    CONSTRAINT [chat_voice_event_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;
