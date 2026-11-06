/*
  REVERSA — Configuración de «Proyectos» por empresa desde la interfaz (2026-10-20). Deshace
  prisma/migrations/20261020180000_proyectos_config_agentes y
  prisma/manual/2026-10-20-proyectos-config-agentes-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa (Prisma lee
  chat_project_agent_config). Va ANTES que las reversas de no leídos, equipo, cronograma, módulo y F1.

  QUÉ HACE (idempotente):
    1. quita el permiso /process/proyectos/configuracion a quien lo tenga y borra el subproceso;
    2. borra chat_project_agent_config_log (con su trigger, índice y CHECK);
    3. borra chat_project_agent_config (con sus índices y su CHECK).

  EFECTO: todas las empresas vuelven a CHAT_PROJECTS_AGENTS del .env. Si alguien había configurado
  una empresa en la pantalla, esa decisión se pierde: antes de correrla, revise que el .env diga lo
  que se quiere (la consulta «antes» lista lo configurado para pasarlo al .env si hace falta).

  PÉRDIDA DE DATOS: la configuración y su registro de cambios. Si hay filas, el script se DETIENE
  salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'proyectos_config_agentes_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51514, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

-- Lo configurado (para pasarlo al .env si se quiere conservar).
IF OBJECT_ID(N'dbo.chat_project_agent_config', N'U') IS NOT NULL
  EXEC(N'SELECT ''antes'' AS momento, c.id_company, a.code AS agente, c.enabled, c.profiles, c.updated_by, c.updated_at
         FROM dbo.chat_project_agent_config c INNER JOIN dbo.agent a ON a.id_agent = c.id_agent
         ORDER BY c.id_company, a.code;');

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_config_agentes_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0;
  IF OBJECT_ID(N'dbo.chat_project_agent_config', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_agent_config', N'@n INT OUTPUT', @n = @n OUTPUT;
  DECLARE @m INT = 0;
  IF OBJECT_ID(N'dbo.chat_project_agent_config_log', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @m = COUNT(*) FROM dbo.chat_project_agent_config_log', N'@m INT OUTPUT', @m = @m OUTPUT;
  IF @n + @m > 0
    THROW 51515, N'Hay configuración o registro de cambios de Proyectos. Declare proyectos_config_agentes_reversa_acepta_perdida = 1 en la sesión para borrarlos.', 1;
END;

BEGIN TRY
BEGIN TRAN;

-- 1. Permiso de la configuración.
DELETE suc FROM [dbo].[subprocess_user_company] suc
  INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url = N'/process/proyectos/configuracion';
DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/proyectos/configuracion';

-- 2. Registro de cambios (DROP TABLE se lleva el trigger; el trigger solo frena UPDATE y DELETE).
IF OBJECT_ID(N'dbo.chat_project_agent_config_log', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_agent_config_log];

-- 3. Configuración.
IF OBJECT_ID(N'dbo.chat_project_agent_config', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_agent_config];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  CASE WHEN OBJECT_ID(N'dbo.chat_project_agent_config', N'U') IS NULL AND OBJECT_ID(N'dbo.chat_project_agent_config_log', N'U') IS NULL THEN 1 ELSE 0 END AS quitadas,
  (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/proyectos/configuracion') AS subprocesos_restantes;
