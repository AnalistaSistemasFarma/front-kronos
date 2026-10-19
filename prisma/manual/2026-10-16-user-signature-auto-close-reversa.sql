/*
  REVERSA de prisma/manual/2026-10-16-user-signature-auto-close.sql.

  Borra la tabla dbo.user_signature_auto_close (y con ella la preferencia de cierre
  automático de cada persona). Con el código nuevo en pie, el interruptor dice "aún no
  disponible" y ninguna solicitud se cierra sola al terminar de firmar.
  Idempotente.
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;

IF OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') IS NOT NULL
BEGIN
  DROP TABLE [dbo].[user_signature_auto_close];
END;

SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;
