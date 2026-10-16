/*
  REVERSA de prisma/manual/2026-09-30-chat-pins.sql.

  Borra la tabla dbo.chat_pin (y con ella las anclas que hayan guardado las
  personas). Solo tiene sentido si se retira la barra lateral: con el código
  nuevo en pie, /api/chat/pins responde "sin anclas" y el chat sigue.
  Idempotente.
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[chat_pin]', N'U') AS chat_pin_object_id,
  (SELECT COUNT(*) FROM sys.tables WHERE name = 'chat_pin') AS existe;

IF OBJECT_ID(N'[dbo].[chat_pin]', N'U') IS NOT NULL
BEGIN
  DROP TABLE [dbo].[chat_pin];
END;

SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[chat_pin]', N'U') AS chat_pin_object_id;
