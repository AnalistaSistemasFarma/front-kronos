/*
  PASE MANUAL — Configuración de «Proyectos» por empresa desde la interfaz (2026-10-20) — KRONOSDB (producción)
  Pedido de Nicolás Rivera del 2026-10-20 (12:44 COT). NO lo corre el agente que hizo el PR: se corre en el
  pase, con el visto bueno de Nicolás y aviso en Teams ANTES del pase.

  PRERREQUISITO (si falta, el script se detiene sin escribir nada):
    prisma/migrations/20261018120000_proyectos_modulo (chat_project_agent y el subproceso /process/proyectos).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    1. el MISMO bloque DDL de prisma/migrations/20261020180000_proyectos_config_agentes/migration.sql:
       chat_project_agent_config (empresa, agente, habilitado, perfiles, auditoría del último cambio),
       chat_project_agent_config_log (registro inmutable de cambios), índices, CHECK y trigger.
    2. el subproceso-permiso /process/proyectos/configuracion «Configuración de Proyectos» (marcador,
       no aparece en el menú). Queda APAGADO: se otorga por persona y empresa en Administración →
       Usuarios. La administración de SynerLink entra sin asignárselo.
    NO copia datos ni otorga permisos. Con la tabla vacía, cada empresa sigue con CHAT_PROJECTS_AGENTS:
    el pase no cambia nada hasta que alguien guarde un cambio en la pantalla.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261020180000_proyectos_config_agentes
  REVERSA: prisma/manual/2026-10-20-proyectos-config-agentes-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51513, N'Base no esperada: este script solo corre en KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_agent', N'U') IS NULL
  THROW 51510, N'Falta la migración 20261018120000_proyectos_modulo (chat_project_agent). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_agent_config]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_config] (
    [id_config]  INT            IDENTITY(1,1) NOT NULL,
    [id_company] INT            NOT NULL,
    [id_agent]   INT            NOT NULL,
    [enabled]    BIT            NOT NULL CONSTRAINT [chat_project_agent_config_enabled_df] DEFAULT 0,
    [profiles]   NVARCHAR(400)  NULL,
    [reason]     NVARCHAR(500)  NULL,
    [updated_by] NVARCHAR(1000) NULL,
    [created_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_config_pkey] PRIMARY KEY CLUSTERED ([id_config]),
    CONSTRAINT [chat_project_agent_config_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_agent_config_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_company_agent' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_agent_config_company_agent] ON [dbo].[chat_project_agent_config]([id_company], [id_agent]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_id_agent_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_config_id_agent_idx] ON [dbo].[chat_project_agent_config]([id_agent]);');
-- Habilitado exige al menos un perfil escrito o heredado del .env (NULL); vacío no vale.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_config_profiles_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_config] WITH CHECK ADD CONSTRAINT [chat_project_agent_config_profiles_ck] CHECK ([profiles] IS NULL OR LEN([profiles]) > 0);');

IF OBJECT_ID(N'[dbo].[chat_project_agent_config_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_config_log] (
    [id_log]          INT            IDENTITY(1,1) NOT NULL,
    [id_company]      INT            NOT NULL,
    [id_agent]        INT            NOT NULL,
    [action]          NVARCHAR(20)   NOT NULL,
    [enabled_before]  BIT            NULL,
    [enabled_after]   BIT            NOT NULL,
    [profiles_before] NVARCHAR(400)  NULL,
    [profiles_after]  NVARCHAR(400)  NULL,
    [reason]          NVARCHAR(500)  NOT NULL,
    [changed_by]      NVARCHAR(1000) NULL,
    [changed_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_log_changed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_config_log_pkey] PRIMARY KEY CLUSTERED ([id_log])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_log_company_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config_log]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_config_log_company_idx] ON [dbo].[chat_project_agent_config_log]([id_company], [changed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_config_log_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_config_log] WITH CHECK ADD CONSTRAINT [chat_project_agent_config_log_valores_ck]
    CHECK ([action] IN (N''cambio'', N''copia_env'') AND LEN([reason]) > 0);');

IF OBJECT_ID(N'[dbo].[TR_chat_project_agent_config_log_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_agent_config_log_inmutable] ON [dbo].[chat_project_agent_config_log]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51511, N''El registro de cambios de la configuración de Proyectos no se cambia ni se borra.'', 1;
    END;');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;


/* ---- Subproceso-permiso de la configuración ------------------------------ */
DECLARE @ProcessName NVARCHAR(255) = N'Solicitudes';
DECLARE @Url         NVARCHAR(255) = N'/process/proyectos/configuracion';
DECLARE @Nombre      NVARCHAR(255) = N'Configuración de Proyectos';

BEGIN TRY
  BEGIN TRANSACTION;

  -- Mismo proceso contenedor que el módulo /process/proyectos.
  DECLARE @ProcessId INT = (SELECT TOP 1 s.id_process FROM [dbo].[subprocess] s WHERE s.subprocess_url = N'/process/proyectos' ORDER BY s.id_subprocess);
  IF @ProcessId IS NULL SET @ProcessId = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
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

SELECT DB_NAME() AS base,
  (SELECT COUNT(*) FROM [dbo].[chat_project_agent_config]) AS configuraciones,
  (SELECT COUNT(*) FROM [dbo].[chat_project_agent_config_log]) AS cambios,
  (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @Url) AS id_subproceso,
  (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url = @Url) AS permisos;
