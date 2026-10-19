/*
  REVERSA — Cronograma y calendario del módulo «Proyectos» (2026-10-18). Deshace
  prisma/migrations/20261018180000_proyectos_cronograma y
  prisma/manual/2026-10-18-proyectos-cronograma-PRUEBAS.sql / -PROD.sql, y deja la
  base como la espera el código del módulo (PR #667).

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. Va ANTES
  que la reversa del módulo (2026-10-18-proyectos-modulo-reversa.sql).

  QUÉ HACE (idempotente):
    1. Borra chat_project_grant (concesiones de 24 h para kronos-mcp).
    2. Borra chat_project_proposal (propuestas de los asistentes).
    3. Borra chat_project_task (tareas del cronograma).
    4. Borra chat_project_event (la auditoría; con ella se va su trigger de inmutabilidad).
    5. Quita chat_project_request.target_date.

  PÉRDIDA DE DATOS: tareas, propuestas, concesiones, auditoría y fechas objetivo. Si
  hay alguna, el script se DETIENE salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'proyectos_cronograma_reversa_acepta_perdida', 1;
  Respalde antes chat_project_event: es la evidencia de quién cambió qué.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51494, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_cronograma_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @perdida INT = 0, @n INT;
  IF OBJECT_ID(N'dbo.chat_project_task', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_task', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_proposal', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_proposal', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_grant', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_grant', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_event', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_event', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF COL_LENGTH(N'dbo.chat_project_request', N'target_date') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_request WHERE target_date IS NOT NULL', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF @perdida > 0
    THROW 51495, N'Hay tareas, propuestas, concesiones, auditoría o fechas objetivo que se perderían. Respáldelas y declare proyectos_cronograma_reversa_acepta_perdida = 1.', 1;
END;

BEGIN TRY
BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.chat_project_grant', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_grant];
  IF OBJECT_ID(N'dbo.chat_project_proposal', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_proposal];
  IF OBJECT_ID(N'dbo.chat_project_task', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_task];
  IF OBJECT_ID(N'dbo.chat_project_event', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_event];
  IF COL_LENGTH(N'dbo.chat_project_request', N'target_date') IS NOT NULL
    ALTER TABLE [dbo].[chat_project_request] DROP COLUMN [target_date];

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

PRINT N'Reversa del cronograma de Proyectos aplicada.';
