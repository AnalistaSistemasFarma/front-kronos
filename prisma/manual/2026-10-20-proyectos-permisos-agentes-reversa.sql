/*
  REVERSA — Permisos de los agentes de cada proyecto (2026-10-20). Deshace
  prisma/migrations/20261020190000_proyectos_permisos_agentes y
  prisma/manual/2026-10-20-proyectos-permisos-agentes-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa (Prisma lee estas tablas;
  el código nuevo también tolera que no existan: todo queda en «ninguno»). Va ANTES que la reversa del
  módulo Proyectos y la de la F1 (sus tablas apuntan a chat_project).

  QUÉ HACE (idempotente):
    1. ANTES de borrar, LISTA las políticas que no están en «ninguno» (proyecto, nivel, repos y
       autorizadores) para poder pasarlas a mano al archivo repos-por-proyecto.json del puente;
    2. quita el subproceso-permiso /process/proyectos/permisos-agentes (y sus asignaciones);
    3. borra chat_project_agent_policy_log (con su trigger), chat_project_agent_policy_repo,
       chat_project_agent_policy y chat_project_repo_catalog.

  PÉRDIDA DE DATOS: los permisos escogidos, el catálogo y el registro de cambios. Si hay políticas o
  registro, el script se DETIENE salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'proyectos_permisos_agentes_reversa_acepta_perdida', 1;
  SIN POLÍTICAS, el puente vuelve a su archivo manual (o a «ninguno»): ningún agente gana acceso.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51524, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

-- 1. Lo que se perdería (para pasarlo al archivo del puente si hace falta).
IF OBJECT_ID(N'dbo.chat_project_agent_policy', N'U') IS NOT NULL
  EXEC sp_executesql N'
    SELECT p.id_project, p.code_level, p.deploy_approvers,
           STUFF((SELECT N'','' + c.slug FROM dbo.chat_project_agent_policy_repo r
                  INNER JOIN dbo.chat_project_repo_catalog c ON c.id_repo = r.id_repo
                  WHERE r.id_project = p.id_project FOR XML PATH(N'''')), 1, 1, N'''') AS repos
    FROM dbo.chat_project_agent_policy p
    WHERE p.code_level <> N''ninguno''
    ORDER BY p.id_project;';

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'proyectos_permisos_agentes_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0;
  IF OBJECT_ID(N'dbo.chat_project_agent_policy', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.chat_project_agent_policy', N'@n INT OUTPUT', @n = @n OUTPUT;
  DECLARE @l INT = 0;
  IF OBJECT_ID(N'dbo.chat_project_agent_policy_log', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @l = COUNT(*) FROM dbo.chat_project_agent_policy_log', N'@l INT OUTPUT', @l = @l OUTPUT;
  IF @n + @l > 0
    THROW 51525, N'Hay permisos de agentes o registro de cambios. Declare proyectos_permisos_agentes_reversa_acepta_perdida = 1 en la sesión para borrarlos.', 1;
END;

BEGIN TRY
BEGIN TRAN;

-- 2. Subproceso-permiso y sus asignaciones.
DELETE suc FROM [dbo].[subprocess_user_company] suc
  INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url = N'/process/proyectos/permisos-agentes';
DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/proyectos/permisos-agentes';

-- 3. Tablas (de la que más depende a la que menos).
IF OBJECT_ID(N'dbo.TR_chat_project_agent_policy_log_inmutable', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[TR_chat_project_agent_policy_log_inmutable];
IF OBJECT_ID(N'dbo.chat_project_agent_policy_log', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_agent_policy_log];
IF OBJECT_ID(N'dbo.chat_project_agent_policy_repo', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_agent_policy_repo];
IF OBJECT_ID(N'dbo.chat_project_agent_policy', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_agent_policy];
IF OBJECT_ID(N'dbo.chat_project_repo_catalog', N'U') IS NOT NULL
  DROP TABLE [dbo].[chat_project_repo_catalog];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  CASE WHEN OBJECT_ID(N'dbo.chat_project_agent_policy', N'U') IS NULL AND OBJECT_ID(N'dbo.chat_project_repo_catalog', N'U') IS NULL
            AND NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/proyectos/permisos-agentes') THEN 1 ELSE 0 END AS quitado;
