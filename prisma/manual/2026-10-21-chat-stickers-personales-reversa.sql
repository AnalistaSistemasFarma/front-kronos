/*
  REVERSA — «Mis stickers» del chat (2026-10-21). Deshace
  prisma/migrations/20261021120000_chat_stickers_personales y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. Va ANTES que la reversa de
  reacciones, GIF y stickers (2026-10-20): chat_sticker_personal apunta a chat_sticker.

  QUÉ HACE (idempotente):
    1. DESACTIVA (active = 0) en chat_sticker los stickers PERSONALES. Es indispensable: un sticker
       personal tiene id_company NULL y, sin la marca de esta tabla, el código anterior lo tomaría
       como sticker «de todas las empresas». Los de empresa aprobados (copias) no se tocan.
    2. Borra la tabla chat_sticker_personal.

  PÉRDIDA DE DATOS: la lista de «Mis stickers» y las propuestas. Los mensajes ya enviados con un
  sticker personal quedan con su texto descriptivo («[Sticker: …]»). Si hay filas, el script se
  DETIENE salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'chat_stickers_personales_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51533, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.chat_sticker_personal', N'U') IS NOT NULL
   AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'chat_stickers_personales_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_sticker_personal', N'@n INT OUTPUT', @n = @n OUTPUT;
  IF @n > 0
    THROW 51534, N'Hay stickers personales o propuestas guardados. Declare chat_stickers_personales_reversa_acepta_perdida = 1 en la sesión para borrarlos.', 1;
END;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.chat_sticker_personal', N'U') IS NOT NULL
BEGIN
  EXEC(N'UPDATE s SET s.active = 0, s.updated_at = SYSUTCDATETIME() FROM dbo.chat_sticker s INNER JOIN dbo.chat_sticker_personal p ON p.id_sticker = s.id_sticker WHERE s.active = 1;');
  DROP TABLE [dbo].[chat_sticker_personal];
END;

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.chat_sticker_personal', N'U') AS chat_sticker_personal;
