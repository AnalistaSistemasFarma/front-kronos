/*
  Migración: chat_pins (barra lateral del chat: chats ANCLADOS por persona).
  Aprobado por Nicolás Rivera el 2026-09-30.

  ADITIVO, se puede aplicar en caliente. Solo CREA una tabla nueva; no toca
  ninguna tabla existente del chat:
    - dbo.chat_pin (id, id_user, target_key, created_at)
    - chat_pin_user_target_key  ÚNICO (id_user, target_key): la misma persona
      no puede anclar dos veces el mismo chat.
    - FK a dbo.[user] con ON DELETE CASCADE: si se borra la persona, se van
      sus anclas.

  ORDEN DEL PASE: como es una tabla aparte, el código NO se cae si sale antes
  que este DDL: /api/chat/pins responde "sin anclas" y el resto del chat sigue
  igual. Aun así, lo correcto es aplicar esto primero, con
  prisma/manual/2026-09-30-chat-pins.sql (idempotente, con reversa en
  prisma/manual/2026-09-30-chat-pins-reversa.sql).

  Para registrarla como aplicada en una base que YA tiene estos cambios:
    npx prisma migrate resolve --applied 20260930180000_chat_pins
*/

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_pin]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_pin] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_user] NVARCHAR(1000) NOT NULL,
    [target_key] NVARCHAR(60) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_pin_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_pin_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [chat_pin_id_user_fkey] FOREIGN KEY ([id_user])
      REFERENCES [dbo].[user] ([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'chat_pin_user_target_key' AND object_id = OBJECT_ID(N'[dbo].[chat_pin]')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [chat_pin_user_target_key]
    ON [dbo].[chat_pin] ([id_user], [target_key]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
