/*
  REVERSA — Módulo «Proyectos» (2026-10-18). Deshace
  prisma/migrations/20261018120000_proyectos_modulo y
  prisma/manual/2026-10-18-proyectos-modulo-PRUEBAS.sql / -PROD.sql,
  y deja la base como la espera el código de la F1 (proyectos dentro del chat).

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa: con
  el código del módulo arriba y las tablas borradas, el módulo y las
  conversaciones de proyecto fallan.

  QUÉ HACE (idempotente):
    1. Quita el permiso /process/proyectos (otorgamientos y subproceso).
    2. Borra chat_project_request y chat_project_email (los vínculos).
    3. Roles: 'editor' y 'reader' vuelven a 'member' (el CHECK y el DEFAULT, a los de la F1).
       ⚠️ Un LECTOR queda como miembro de la F1, que sí escribe.
    4. Borra chat_project_agent: cada proyecto vuelve a su agente de creación
       (chat_project.id_agent); las conversaciones con OTROS agentes dejan de verse en
       la F1 (no se borran).
    5. Quita chat_project.description.

  PÉRDIDA DE DATOS: vínculos, descripciones, lectores y agentes adicionales. Si hay
  alguno, el script se DETIENE salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'proyectos_modulo_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51484, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_modulo_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @perdida INT = 0, @n INT;
  IF OBJECT_ID(N'dbo.chat_project_email', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_email', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_request', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_request', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_agent', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_agent pa INNER JOIN dbo.chat_project p ON p.id_project = pa.id_project WHERE pa.id_agent <> p.id_agent', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF OBJECT_ID(N'dbo.chat_project_member', N'U') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_member WHERE role = N''reader''', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF COL_LENGTH(N'dbo.chat_project', N'description') IS NOT NULL
  BEGIN
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project WHERE description IS NOT NULL', N'@n INT OUTPUT', @n = @n OUTPUT;
    SET @perdida += @n;
  END;
  IF @perdida > 0
    THROW 51485, N'Hay vínculos, lectores, agentes adicionales o descripciones que se perderían. Respáldelos y declare proyectos_modulo_reversa_acepta_perdida = 1.', 1;
END;

BEGIN TRY
BEGIN TRANSACTION;

  -- 1. Permiso del menú.
  DELETE suc FROM [dbo].[subprocess_user_company] suc
    INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
    WHERE s.subprocess_url = N'/process/proyectos';
  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/proyectos';

  -- 2. Vínculos.
  IF OBJECT_ID(N'dbo.chat_project_request', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_request];
  IF OBJECT_ID(N'dbo.chat_project_email', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_email];

  -- 3. Roles de la F1.
  IF OBJECT_ID(N'dbo.chat_project_member', N'U') IS NOT NULL
  BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_member_role_ck')
      ALTER TABLE [dbo].[chat_project_member] DROP CONSTRAINT [chat_project_member_role_ck];
    EXEC(N'UPDATE [dbo].[chat_project_member] SET [role] = N''member'' WHERE [role] IN (N''editor'', N''reader'');');
    EXEC(N'ALTER TABLE [dbo].[chat_project_member] WITH CHECK ADD CONSTRAINT [chat_project_member_role_ck]
      CHECK ([role] IN (N''owner'', N''member''));');
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'chat_project_member_role_df' AND definition NOT LIKE '%member%')
    BEGIN
      ALTER TABLE [dbo].[chat_project_member] DROP CONSTRAINT [chat_project_member_role_df];
      ALTER TABLE [dbo].[chat_project_member] ADD CONSTRAINT [chat_project_member_role_df] DEFAULT N'member' FOR [role];
    END;
  END;

  -- 4. Agentes designados.
  IF OBJECT_ID(N'dbo.chat_project_agent', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_agent];

  -- 5. Descripción.
  IF COL_LENGTH(N'dbo.chat_project', N'description') IS NOT NULL
    ALTER TABLE [dbo].[chat_project] DROP COLUMN [description];

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

PRINT N'Reversa del módulo Proyectos aplicada.';
