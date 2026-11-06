/*
  PASE MANUAL — Permisos de los agentes de cada proyecto (2026-10-20) — SOLO KRONOSDB (producción).
  Pedido de Nicolás Rivera del 2026-10-20 (13:18 COT). NO lo corre el agente que hizo el PR: se corre en el
  pase, con el visto bueno de Nicolás y aviso en Teams ANTES del pase.

  PRERREQUISITO (si falta, el script se detiene sin escribir nada):
    prisma/migrations/20261017120000_chat_projects (chat_project) y 20261018120000_proyectos_modulo
    (el subproceso /process/proyectos).

  QUÉ HACE (idempotente; solo crea lo que falta, no altera tablas existentes):
    1. el MISMO bloque DDL de prisma/migrations/20261020190000_proyectos_permisos_agentes/migration.sql:
       chat_project_repo_catalog, chat_project_agent_policy, chat_project_agent_policy_repo y
       chat_project_agent_policy_log (inmutable, con trigger), con sus índices y CHECK.
    2. el subproceso-permiso /process/proyectos/permisos-agentes «Permisos de agentes en Proyectos»
       (marcador: no aparece en el menú). Queda APAGADO: se otorga por persona y empresa en
       Administración → Usuarios. La administración de SynerLink entra sin asignárselo.
    3. el catálogo inicial de repositorios (solo si la clave no existe): front-kronos y sapsend. Más
       repos los agrega la administración desde Proyectos → «Repositorios».
    NO crea políticas: TODOS los proyectos quedan en «ninguno» (y el puente sigue leyendo su archivo
    manual repos-por-proyecto.json para los que no tengan fila). NO otorga permisos.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261020190000_proyectos_permisos_agentes
  REVERSA: prisma/manual/2026-10-20-proyectos-permisos-agentes-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51523, N'Base no esperada: este script solo corre en KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project', N'U') IS NULL
  THROW 51520, N'Falta la migración 20261017120000_chat_projects (chat_project). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_repo_catalog]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_repo_catalog] (
    [id_repo]           INT            IDENTITY(1,1) NOT NULL,
    [slug]              NVARCHAR(40)   NOT NULL,
    [name]              NVARCHAR(120)  NOT NULL,
    [github]            NVARCHAR(200)  NOT NULL,
    [branch_testing]    NVARCHAR(100)  NOT NULL,
    [branch_production] NVARCHAR(100)  NOT NULL,
    [description]       NVARCHAR(500)  NULL,
    [active]            BIT            NOT NULL CONSTRAINT [chat_project_repo_catalog_active_df] DEFAULT 1,
    [created_by]        NVARCHAR(1000) NULL,
    [updated_by]        NVARCHAR(1000) NULL,
    [created_at]        DATETIME2      NOT NULL CONSTRAINT [chat_project_repo_catalog_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]        DATETIME2      NOT NULL CONSTRAINT [chat_project_repo_catalog_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_repo_catalog_pkey] PRIMARY KEY CLUSTERED ([id_repo])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_repo_catalog_slug' AND object_id = OBJECT_ID(N'[dbo].[chat_project_repo_catalog]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_repo_catalog_slug] ON [dbo].[chat_project_repo_catalog]([slug]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_repo_catalog_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_repo_catalog] WITH CHECK ADD CONSTRAINT [chat_project_repo_catalog_valores_ck]
    CHECK (LEN([slug]) > 0 AND [slug] = LOWER([slug]) AND CHARINDEX(N''/'', [github]) > 1 AND [branch_testing] <> [branch_production]);');

IF OBJECT_ID(N'[dbo].[chat_project_agent_policy]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_policy] (
    [id_policy]        INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [code_level]       NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_agent_policy_code_level_df] DEFAULT N'ninguno',
    [deploy_approvers] NVARCHAR(2000) NULL,
    [connectors]       NVARCHAR(2000) NULL,
    [reason]           NVARCHAR(500)  NULL,
    [updated_by]       NVARCHAR(1000) NULL,
    [created_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_policy_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_policy_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_policy_pkey] PRIMARY KEY CLUSTERED ([id_policy]),
    CONSTRAINT [chat_project_agent_policy_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_policy_project' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_policy]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_agent_policy_project] ON [dbo].[chat_project_agent_policy]([id_project]);');
-- Nivel conocido; autorizadores SOLO con pases (sin pases no hay a quién pedirle autorización).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_policy_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_policy] WITH CHECK ADD CONSTRAINT [chat_project_agent_policy_valores_ck]
    CHECK ([code_level] IN (N''ninguno'', N''lectura'', N''desarrollo'', N''desarrollo_pases'')
           AND ([code_level] = N''desarrollo_pases'' OR [deploy_approvers] IS NULL)
           AND ([code_level] <> N''desarrollo_pases'' OR ([deploy_approvers] IS NOT NULL AND LEN([deploy_approvers]) > 0)));');

IF OBJECT_ID(N'[dbo].[chat_project_agent_policy_repo]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_policy_repo] (
    [id_policy_repo] INT            IDENTITY(1,1) NOT NULL,
    [id_project]     INT            NOT NULL,
    [id_repo]        INT            NOT NULL,
    [added_by]       NVARCHAR(1000) NULL,
    [added_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_policy_repo_added_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_policy_repo_pkey] PRIMARY KEY CLUSTERED ([id_policy_repo]),
    CONSTRAINT [chat_project_agent_policy_repo_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_agent_policy_repo_id_repo_fkey] FOREIGN KEY ([id_repo]) REFERENCES [dbo].[chat_project_repo_catalog]([id_repo]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_policy_repo_project_repo' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_policy_repo]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_agent_policy_repo_project_repo] ON [dbo].[chat_project_agent_policy_repo]([id_project], [id_repo]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_policy_repo_id_repo_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_policy_repo]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_policy_repo_id_repo_idx] ON [dbo].[chat_project_agent_policy_repo]([id_repo]);');

IF OBJECT_ID(N'[dbo].[chat_project_agent_policy_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_policy_log] (
    [id_log]           INT            IDENTITY(1,1) NOT NULL,
    [scope]            NVARCHAR(20)   NOT NULL,
    [id_project]       INT            NULL,
    [id_repo]          INT            NULL,
    [action]           NVARCHAR(20)   NOT NULL,
    [before_value]     NVARCHAR(MAX)  NULL,
    [after_value]      NVARCHAR(MAX)  NOT NULL,
    [reason]           NVARCHAR(500)  NOT NULL,
    [changed_by]       NVARCHAR(1000) NULL,
    [changed_by_email] NVARCHAR(320)  NULL,
    [changed_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_policy_log_changed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_policy_log_pkey] PRIMARY KEY CLUSTERED ([id_log])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_policy_log_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_policy_log]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_policy_log_project_idx] ON [dbo].[chat_project_agent_policy_log]([id_project], [changed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_policy_log_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_policy_log] WITH CHECK ADD CONSTRAINT [chat_project_agent_policy_log_valores_ck]
    CHECK ([scope] IN (N''proyecto'', N''catalogo'')
           AND [action] IN (N''crear'', N''cambiar'', N''activar'', N''desactivar'')
           AND ([scope] <> N''proyecto'' OR [id_project] IS NOT NULL)
           AND ([scope] <> N''catalogo'' OR [id_repo] IS NOT NULL)
           AND LEN([reason]) > 0);');

IF OBJECT_ID(N'[dbo].[TR_chat_project_agent_policy_log_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_agent_policy_log_inmutable] ON [dbo].[chat_project_agent_policy_log]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51521, N''El registro de cambios de los permisos de los agentes no se cambia ni se borra.'', 1;
    END;');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;


/* ---- Subproceso-permiso ------------------------------------------------------ */
DECLARE @ProcessName NVARCHAR(255) = N'Solicitudes';
DECLARE @Url         NVARCHAR(255) = N'/process/proyectos/permisos-agentes';
DECLARE @Nombre      NVARCHAR(255) = N'Permisos de agentes en Proyectos';

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

  /* ---- Catálogo inicial (solo lo que falta; nunca cambia lo que ya está) ---- */
  IF NOT EXISTS (SELECT 1 FROM [dbo].[chat_project_repo_catalog] WHERE slug = N'front-kronos')
    INSERT INTO [dbo].[chat_project_repo_catalog] (slug, name, github, branch_testing, branch_production, description)
    VALUES (N'front-kronos', N'SynerLink (front-kronos)', N'AnalistaSistemasFarma/front-kronos', N'testing', N'main',
            N'SynerLink: portal, chat, Proyectos y SGC. Pruebas en la .230; producción en serfarma05.');
  IF NOT EXISTS (SELECT 1 FROM [dbo].[chat_project_repo_catalog] WHERE slug = N'sapsend')
    INSERT INTO [dbo].[chat_project_repo_catalog] (slug, name, github, branch_testing, branch_production, description)
    VALUES (N'sapsend', N'SAPSEND', N'gsslatam/sapsend', N'testing', N'production',
            N'SAPSEND multiempresa: tesorería, compras y activos. Producción se despliega por empresa.');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  (SELECT COUNT(*) FROM [dbo].[chat_project_repo_catalog]) AS repos_catalogo,
  (SELECT COUNT(*) FROM [dbo].[chat_project_agent_policy]) AS politicas,
  (SELECT COUNT(*) FROM [dbo].[chat_project_agent_policy_log]) AS cambios,
  (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @Url) AS id_subproceso,
  (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url = @Url) AS permisos;
