/*
  LIMPIEZA: borra dbo.user_signature_auto_close.

  Esa tabla guardaba el interruptor "Cerrar al terminar de firmar", que se quitó el
  2026-10-20: ahora las tareas de firma se cierran solas siempre y para todos, y el código
  ya no lee ni escribe la tabla (su script de creación también se borró).
  Correr SOLO en las bases donde se haya creado (p. ej. KRONOSDB_PRUEBAS). Idempotente:
  si la tabla no existe no hace nada.
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;

IF OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') IS NOT NULL
BEGIN
  DROP TABLE [dbo].[user_signature_auto_close];
END;

SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;
