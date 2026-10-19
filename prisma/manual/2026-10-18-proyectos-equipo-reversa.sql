/*
  REVERSA — Equipo de subagentes del módulo «Proyectos» (F2, 2026-10-18). Deshace
  prisma/migrations/20261018220000_proyectos_equipo_subagentes y
  prisma/manual/2026-10-18-proyectos-equipo-PRUEBAS.sql / -PROD.sql, y deja la base como la
  espera el código del cronograma (PR #668).

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa (Prisma lee
  chat_project.team_enabled y team_max_parallel). Va ANTES que la reversa del cronograma
  (2026-10-18-proyectos-cronograma-reversa.sql).

  QUÉ HACE (idempotente):
    1. Borra chat_project_subagent_run (lo que hizo cada subagente).
    2. Borra chat_project_subagent (el equipo) y chat_project_team_request (los pedidos).
    3. Borra chat_project_team_event (la auditoría; con ella se va su trigger de inmutabilidad).
    4. Quita chat_project.team_enabled y team_max_parallel (con su CHECK y sus DEFAULT).

  PÉRDIDA DE DATOS: equipos, pedidos, corridas y auditoría. Si hay alguno, el script se
  DETIENE salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'proyectos_equipo_reversa_acepta_perdida', 1;
  Respalde antes chat_project_team_event: es la evidencia de quién aprobó qué.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51500, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_equipo_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @perdida INT = 0, @n INT;
  IF OBJECT_ID(N'dbo.chat_project_subagent', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_subagent', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_team_request', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_team_request', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_subagent_run', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_subagent_run', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_team_event', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_team_event', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF @perdida > 0
    THROW 51501, N'Hay subagentes, pedidos, corridas o auditoría del equipo que se perderían. Respáldelos y declare proyectos_equipo_reversa_acepta_perdida = 1.', 1;
END;

BEGIN TRY
BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.chat_project_subagent_run', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_subagent_run];
  IF OBJECT_ID(N'dbo.chat_project_subagent', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_subagent];
  IF OBJECT_ID(N'dbo.chat_project_team_request', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_team_request];
  IF OBJECT_ID(N'dbo.chat_project_team_event', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_team_event];

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_team_max_parallel_ck')
    ALTER TABLE [dbo].[chat_project] DROP CONSTRAINT [chat_project_team_max_parallel_ck];

  -- Los DEFAULT pueden tener otro nombre si la columna la creó `prisma db push`: se buscan por columna.
  DECLARE @df SYSNAME, @sql NVARCHAR(400);
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns col ON col.object_id = dc.parent_object_id AND col.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.chat_project') AND col.name IN (N'team_enabled', N'team_max_parallel');
  OPEN c;
  FETCH NEXT FROM c INTO @df;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @sql = N'ALTER TABLE [dbo].[chat_project] DROP CONSTRAINT ' + QUOTENAME(@df) + N';';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM c INTO @df;
  END;
  CLOSE c;
  DEALLOCATE c;

  IF COL_LENGTH(N'dbo.chat_project', N'team_enabled') IS NOT NULL
    ALTER TABLE [dbo].[chat_project] DROP COLUMN [team_enabled];
  IF COL_LENGTH(N'dbo.chat_project', N'team_max_parallel') IS NOT NULL
    ALTER TABLE [dbo].[chat_project] DROP COLUMN [team_max_parallel];

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

PRINT N'Reversa del equipo de subagentes de Proyectos aplicada.';
