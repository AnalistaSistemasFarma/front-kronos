/*
  REVERSA de prisma/manual/2026-10-15-user-start-page.sql.

  Borra la tabla dbo.user_start_page (y con ella las páginas de inicio que hayan
  guardado las personas). Con el código nuevo en pie, el perfil dice "aún no
  disponible" y todos entran con el inicio automático de siempre.
  Idempotente.
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[user_start_page]', N'U') AS user_start_page_object_id;

IF OBJECT_ID(N'[dbo].[user_start_page]', N'U') IS NOT NULL
BEGIN
  DROP TABLE [dbo].[user_start_page];
END;

SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[user_start_page]', N'U') AS user_start_page_object_id;
