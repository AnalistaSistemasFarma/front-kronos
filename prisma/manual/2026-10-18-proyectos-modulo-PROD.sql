/*
  PASE MANUAL — Módulo «Proyectos» (2026-10-18) — SOLO KRONOSDB (producción). NO correr sin el visto bueno de Nicolás.
  Pedido de Nicolás Rivera del 2026-10-17. Sobre la F1 (proyectos del chat).

  PRERREQUISITOS (si faltan, el script se detiene sin escribir nada):
    1. prisma/manual/2026-10-17-chat-proyectos-PROD.sql  (DDL de la F1; en PROD aún no se ha corrido)
    2. prisma/migrations/20261018120000_proyectos_modulo (este módulo; córrala ANTES)

  QUÉ HACE (idempotente; solo inserta):
    1. Proceso contenedor del menú: @ProcessName (por defecto «Solicitudes», igual que Correo).
    2. Subproceso-permiso /process/proyectos «Proyectos» (lib/chat/projects-rules.ts →
       PROJECTS_MODULE_URL). Queda APAGADO: se habilita por persona y empresa en
       Administración → Usuarios.
    3. NO otorga permisos a nadie (la F1 nunca corrió en producción: no hay proyectos que
       migrar). El permiso se da por persona y empresa en Administración → Usuarios.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. REVERSA: prisma/manual/2026-10-18-proyectos-modulo-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51483, N'Base no esperada: este script solo corre en KRONOSDB (producción).', 1;
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
