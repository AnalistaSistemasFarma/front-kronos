/*
  REVERSA — Mensajes no leídos de las conversaciones de «Proyectos» (2026-10-19). Deshace
  prisma/migrations/20261019140000_proyectos_no_leidos y
  prisma/manual/2026-10-19-proyectos-no-leidos-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa (Prisma lee
  chat_project_read). Va ANTES que la reversa del equipo de subagentes y la de la F1.

  QUÉ HACE (idempotente): borra la tabla chat_project_read (con sus índices y su CHECK).

  PÉRDIDA DE DATOS: solo las marcas de lectura (hasta dónde leyó cada miembro). No se pierde
  ningún mensaje; al volver a aplicar la migración, todo cuenta como nuevo otra vez. Si hay filas,
  el script se DETIENE salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'proyectos_no_leidos_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51505, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_no_leidos_reversa_acepta_perdida')), 0) <> 1
   AND OBJECT_ID(N'dbo.chat_project_read', N'U') IS NOT NULL
BEGIN
  DECLARE @n INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_read', N'@n INT OUTPUT', @n = @n OUTPUT;
  IF @n > 0
    THROW 51506, N'chat_project_read tiene marcas de lectura. Declare proyectos_no_leidos_reversa_acepta_perdida = 1 en la sesión para borrarlas.', 1;
END;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.chat_project_read', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_read];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, CASE WHEN OBJECT_ID(N'dbo.chat_project_read', N'U') IS NULL THEN 1 ELSE 0 END AS quitada;
