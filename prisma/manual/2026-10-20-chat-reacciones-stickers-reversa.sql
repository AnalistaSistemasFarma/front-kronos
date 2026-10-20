/*
  REVERSA — Reacciones, GIF y stickers del chat (2026-10-20). Deshace
  prisma/migrations/20261020120000_chat_reacciones_stickers y
  prisma/manual/2026-10-20-chat-reacciones-stickers-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. (Si se corre con el
  código nuevo arriba, el chat sigue funcionando: solo las reacciones, los GIF y los stickers
  quedan «no disponibles».)

  QUÉ HACE (idempotente): borra las tablas chat_message_reaction, chat_message_media y chat_sticker
  (con sus índices y CHECK). No toca chat_message.

  PÉRDIDA DE DATOS: las reacciones, la marca de «esto es un GIF/sticker» de los mensajes y los
  stickers cargados por las empresas. Los MENSAJES no se pierden: quedan con su texto descriptivo
  («[Sticker: Pulgar arriba]», «[GIF: …]»). Si hay filas, el script se DETIENE salvo que la sesión
  declare que acepta perderlas:
      EXEC sp_set_session_context N'chat_reacciones_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51522, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'chat_reacciones_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0, @m INT = 0;
  IF OBJECT_ID(N'dbo.chat_message_reaction', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_message_reaction', N'@n INT OUTPUT', @n = @n OUTPUT;
  IF OBJECT_ID(N'dbo.chat_message_media', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @m = @m + COUNT(*) FROM dbo.chat_message_media', N'@m INT OUTPUT', @m = @m OUTPUT;
  IF OBJECT_ID(N'dbo.chat_sticker', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @m = @m + COUNT(*) FROM dbo.chat_sticker', N'@m INT OUTPUT', @m = @m OUTPUT;
  IF @n + @m > 0
    THROW 51523, N'Hay reacciones, GIF/stickers o stickers de empresa guardados. Declare chat_reacciones_reversa_acepta_perdida = 1 en la sesión para borrarlos.', 1;
END;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.chat_message_reaction', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_message_reaction];
-- chat_message_media antes que chat_sticker: tiene la llave foránea hacia ella.
IF OBJECT_ID(N'dbo.chat_message_media', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_message_media];
IF OBJECT_ID(N'dbo.chat_sticker', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_sticker];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       CASE WHEN OBJECT_ID(N'dbo.chat_message_reaction', N'U') IS NULL
             AND OBJECT_ID(N'dbo.chat_message_media', N'U') IS NULL
             AND OBJECT_ID(N'dbo.chat_sticker', N'U') IS NULL THEN 1 ELSE 0 END AS quitadas;
