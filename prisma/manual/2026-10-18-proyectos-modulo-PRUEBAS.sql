/*
  PASE MANUAL — Módulo «Proyectos» (2026-10-18) — SOLO KRONOSDB_PRUEBAS.
  Pedido de Nicolás Rivera del 2026-10-17. Sobre la F1 (proyectos del chat).

  PRERREQUISITOS (si faltan, el script se detiene sin escribir nada):
    1. prisma/migrations/20261017120000_chat_projects   (F1, ya está en PRUEBAS)
    2. prisma/migrations/20261018120000_proyectos_modulo (este módulo; córrala ANTES)

  QUÉ HACE (idempotente; solo inserta):
    1. Proceso contenedor del menú: @ProcessName (por defecto «Solicitudes», igual que Correo).
    2. Subproceso-permiso /process/proyectos «Proyectos» (lib/chat/projects-rules.ts →
       PROJECTS_MODULE_URL). Queda APAGADO: se habilita por persona y empresa en
       Administración → Usuarios.
    3. MIGRACIÓN DE LA F1: a cada miembro de un proyecto de la F1 le otorga el permiso
       «Proyectos» en la empresa de ESE proyecto, para que no pierda el acceso. Solo si
       la persona ya pertenece a esa empresa (company_user); no crea pertenencias.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. REVERSA: prisma/manual/2026-10-18-proyectos-modulo-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51481, N'Base no esperada: este script solo corre en KRONOSDB_PRUEBAS (o la base efímera de la CI).', 1;
IF OBJECT_ID(N'dbo.chat_project_agent', N'U') IS NULL OR OBJECT_ID(N'dbo.chat_project_email', N'U') IS NULL OR OBJECT_ID(N'dbo.chat_project_request', N'U') IS NULL
  THROW 51482, N'Falta la migración 20261018120000_proyectos_modulo. Córrala primero.', 1;

DECLARE @ProcessName NVARCHAR(255) = N'Solicitudes';
DECLARE @Url         NVARCHAR(255) = N'/process/proyectos';
DECLARE @Nombre      NVARCHAR(255) = N'Proyectos';

SELECT DB_NAME() AS base, 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url,
       (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc WHERE suc.id_subprocess = s.id_subprocess) AS permisos
FROM [dbo].[subprocess] s WHERE s.subprocess_url = @Url;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = @Url)
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@Nombre, @ProcessId, @Url);

  DECLARE @IdSub INT = (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @Url ORDER BY id_subprocess);

  -- Miembros de la F1: el permiso en la empresa de su proyecto (sin duplicar).
  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT DISTINCT @IdSub, cu.id_company_user
  FROM [dbo].[chat_project_member] m
  INNER JOIN [dbo].[chat_project] p ON p.id_project = m.id_project
  INNER JOIN [dbo].[company_user] cu ON cu.id_user = m.id_user AND cu.id_company = p.id_company
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] x WHERE x.id_subprocess = @IdSub AND x.id_company_user = cu.id_company_user
  );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url,
       (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc WHERE suc.id_subprocess = s.id_subprocess) AS permisos
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @Url;

-- Estado de la migración de la F1: proyectos, agentes designados y roles.
SELECT pr.id_project, pr.name, pr.id_company,
       (SELECT COUNT(*) FROM [dbo].[chat_project_agent] a WHERE a.id_project = pr.id_project) AS agentes,
       (SELECT COUNT(*) FROM [dbo].[chat_project_member] m WHERE m.id_project = pr.id_project AND m.role = N'owner') AS duenos,
       (SELECT COUNT(*) FROM [dbo].[chat_project_member] m WHERE m.id_project = pr.id_project AND m.role = N'editor') AS editores,
       (SELECT COUNT(*) FROM [dbo].[chat_project_member] m WHERE m.id_project = pr.id_project AND m.role = N'member') AS member_sin_migrar
FROM [dbo].[chat_project] pr ORDER BY pr.id_project;
