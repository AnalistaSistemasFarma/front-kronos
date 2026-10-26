/*
  PASE MANUAL — Equipo de subagentes del módulo «Proyectos» (F2, 2026-10-18) — SOLO KRONOSDB (producción).
  Pedido de Nicolás Rivera del 2026-10-18 por SynerLink. NO lo corre el agente que hizo el PR: se corre en el pase,
  con el visto bueno de Nicolás y aviso en Teams ANTES del pase.
  Requiere antes el PROD del cronograma (2026-10-18-proyectos-cronograma-PROD.sql), el del módulo y el de la F1.

  PRERREQUISITO (si falta, el script se detiene sin escribir nada):
    prisma/migrations/20261018180000_proyectos_cronograma (el cronograma, PR #668).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261018220000_proyectos_equipo_subagentes/migration.sql
    (interruptor y tope del equipo en chat_project, subagentes, pedidos de «Sugerir equipo»,
    corridas por subagente y auditoría inmutable). No otorga permisos: el equipo vive dentro del
    módulo «Proyectos» y usa su mismo permiso. Los proyectos existentes quedan con el equipo
    ENCENDIDO pero VACÍO: nada cambia hasta que un dueño apruebe un subagente.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261018220000_proyectos_equipo_subagentes
  REVERSA: prisma/manual/2026-10-18-proyectos-equipo-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51499, N'Base no esperada: este script solo corre en KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_project_task]', N'U') IS NULL OR OBJECT_ID(N'[dbo].[chat_project_event]', N'U') IS NULL
  THROW 51496, N'Falta la migración 20261018180000_proyectos_cronograma. Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

/* ---- 1. Interruptor y tope del equipo en el proyecto -------------------- */
IF COL_LENGTH(N'dbo.chat_project', N'team_enabled') IS NULL
  ALTER TABLE [dbo].[chat_project] ADD [team_enabled] BIT NOT NULL CONSTRAINT [chat_project_team_enabled_df] DEFAULT 1;
IF COL_LENGTH(N'dbo.chat_project', N'team_max_parallel') IS NULL
  ALTER TABLE [dbo].[chat_project] ADD [team_max_parallel] TINYINT NOT NULL CONSTRAINT [chat_project_team_max_parallel_df] DEFAULT 3;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_team_max_parallel_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_team_max_parallel_ck]
    CHECK ([team_max_parallel] >= 1 AND [team_max_parallel] <= 5);');

/* ---- 2. chat_project_subagent ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_subagent]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_subagent] (
    [id_subagent]  INT            IDENTITY(1,1) NOT NULL,
    [id_project]   INT            NOT NULL,
    [slug]         NVARCHAR(40)   NOT NULL,
    [name]         NVARCHAR(60)   NOT NULL,
    [purpose]      NVARCHAR(300)  NOT NULL,
    [instructions] NVARCHAR(4000) NULL,
    [tools]        NVARCHAR(100)  NOT NULL,
    [model]        NVARCHAR(20)   NULL,
    [status]       NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_subagent_status_df] DEFAULT N'propuesto',
    [origin]       NVARCHAR(20)   NOT NULL,
    [id_request]   INT            NULL,
    [id_agent]     INT            NULL,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [chat_project_subagent_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by]   NVARCHAR(1000) NULL,
    [updated_at]   DATETIME2      NULL,
    [reviewed_by]  NVARCHAR(1000) NULL,
    [reviewed_at]  DATETIME2      NULL,
    CONSTRAINT [chat_project_subagent_pkey] PRIMARY KEY CLUSTERED ([id_subagent]),
    CONSTRAINT [chat_project_subagent_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_subagent_id_project_status_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_subagent]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_subagent_id_project_status_idx] ON [dbo].[chat_project_subagent]([id_project], [status]);');
-- Un mismo identificador (subagent_type) no se repite en el proyecto entre los vivos.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_project_subagent_slug_vivo' AND object_id = OBJECT_ID(N'[dbo].[chat_project_subagent]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [UX_chat_project_subagent_slug_vivo] ON [dbo].[chat_project_subagent]([id_project], [slug]) WHERE [status] <> N''descartado'';');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_subagent_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_subagent] WITH CHECK ADD CONSTRAINT [chat_project_subagent_valores_ck]
    CHECK ([status] IN (N''propuesto'', N''aprobado'', N''descartado'')
      AND [origin] IN (N''agente'', N''persona'')
      AND ([model] IS NULL OR [model] IN (N''haiku'', N''sonnet'', N''opus''))
      AND [slug] NOT LIKE N''%[^a-z0-9-]%'' AND LEN([slug]) >= 3
      AND [tools] LIKE N''archivos%'' AND [tools] NOT LIKE N''%[^a-z,]%''
      AND [tools] NOT LIKE N''%bash%'' AND [tools] NOT LIKE N''%agent%'');');

/* ---- 3. chat_project_team_request --------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_team_request]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_team_request] (
    [id_request]   INT            IDENTITY(1,1) NOT NULL,
    [id_project]   INT            NOT NULL,
    [id_agent]     INT            NOT NULL,
    [requested_by] NVARCHAR(1000) NOT NULL,
    [requested_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_team_request_requested_at_df] DEFAULT CURRENT_TIMESTAMP,
    [status]       NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_team_request_status_df] DEFAULT N'pendiente',
    [claimed_at]   DATETIME2      NULL,
    [finished_at]  DATETIME2      NULL,
    [error]        NVARCHAR(300)  NULL,
    [suggested]    INT            NOT NULL CONSTRAINT [chat_project_team_request_suggested_df] DEFAULT 0,
    [total_tokens] INT            NOT NULL CONSTRAINT [chat_project_team_request_total_tokens_df] DEFAULT 0,
    [models]       NVARCHAR(300)  NULL,
    CONSTRAINT [chat_project_team_request_pkey] PRIMARY KEY CLUSTERED ([id_request]),
    CONSTRAINT [chat_project_team_request_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_team_request_id_agent_status_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_team_request]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_team_request_id_agent_status_idx] ON [dbo].[chat_project_team_request]([id_agent], [status]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_team_request_id_project_requested_at_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_team_request]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_team_request_id_project_requested_at_idx] ON [dbo].[chat_project_team_request]([id_project], [requested_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_team_request_status_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_team_request] WITH CHECK ADD CONSTRAINT [chat_project_team_request_status_ck]
    CHECK ([status] IN (N''pendiente'', N''en_curso'', N''lista'', N''fallida'', N''vencida'') AND [suggested] >= 0 AND [suggested] <= 6);');

/* ---- 4. chat_project_subagent_run --------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_subagent_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_subagent_run] (
    [id_run]          INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [id_conversation] INT            NOT NULL,
    [id_agent]        INT            NOT NULL,
    [id_subagent]     INT            NULL,
    [slug]            NVARCHAR(40)   NOT NULL,
    [description]     NVARCHAR(200)  NOT NULL,
    [status]          NVARCHAR(20)   NOT NULL,
    [session_id]      NVARCHAR(120)  NULL,
    [turn_started_at] DATETIME2      NULL,
    [started_at]      DATETIME2      NULL,
    [ended_at]        DATETIME2      NULL,
    [duration_ms]     INT            NULL,
    [total_tokens]    INT            NOT NULL CONSTRAINT [chat_project_subagent_run_total_tokens_df] DEFAULT 0,
    [tool_uses]       INT            NOT NULL CONSTRAINT [chat_project_subagent_run_tool_uses_df] DEFAULT 0,
    [model]           NVARCHAR(80)   NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_subagent_run_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_subagent_run_pkey] PRIMARY KEY CLUSTERED ([id_run]),
    CONSTRAINT [chat_project_subagent_run_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_subagent_run_id_project_created_at_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_subagent_run]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_subagent_run_id_project_created_at_idx] ON [dbo].[chat_project_subagent_run]([id_project], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_subagent_run_id_conversation_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_subagent_run]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_subagent_run_id_conversation_idx] ON [dbo].[chat_project_subagent_run]([id_conversation]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_subagent_run_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_subagent_run] WITH CHECK ADD CONSTRAINT [chat_project_subagent_run_valores_ck]
    CHECK ([status] IN (N''ok'', N''error'', N''cancelado'') AND [total_tokens] >= 0 AND [tool_uses] >= 0 AND ([duration_ms] IS NULL OR [duration_ms] >= 0));');

/* ---- 5. chat_project_team_event (auditoría inmutable) -------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_team_event]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_team_event] (
    [id_event]    INT            IDENTITY(1,1) NOT NULL,
    [id_project]  INT            NOT NULL,
    [id_subagent] INT            NULL,
    [action]      NVARCHAR(30)   NOT NULL,
    [detail]      NVARCHAR(1000) NOT NULL,
    [changes]     NVARCHAR(MAX)  NULL,
    [id_user]     NVARCHAR(1000) NULL,
    [id_agent]    INT            NULL,
    [via]         NVARCHAR(20)   NOT NULL,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [chat_project_team_event_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_team_event_pkey] PRIMARY KEY CLUSTERED ([id_event])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_team_event_id_project_created_at_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_team_event]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_team_event_id_project_created_at_idx] ON [dbo].[chat_project_team_event]([id_project], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_team_event_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_team_event] WITH CHECK ADD CONSTRAINT [chat_project_team_event_valores_ck]
    CHECK ([via] IN (N''web'', N''puente'')
      AND [action] IN (N''pedir'', N''sugerir'', N''aprobar'', N''editar'', N''descartar'', N''restaurar'', N''configurar'', N''bloqueo'', N''fallar''));');

IF OBJECT_ID(N'[dbo].[TR_chat_project_team_event_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_team_event_inmutable] ON [dbo].[chat_project_team_event]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51497, N''La auditoría del equipo de subagentes (chat_project_team_event) no se cambia ni se borra.'', 1;
    END;');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  (SELECT COUNT(*) FROM [dbo].[chat_project_subagent]) AS subagentes,
  (SELECT COUNT(*) FROM [dbo].[chat_project_team_request]) AS pedidos,
  (SELECT COUNT(*) FROM [dbo].[chat_project_subagent_run]) AS corridas,
  (SELECT COUNT(*) FROM [dbo].[chat_project_team_event]) AS eventos,
  CASE WHEN COL_LENGTH(N'dbo.chat_project', N'team_enabled') IS NULL OR COL_LENGTH(N'dbo.chat_project', N'team_max_parallel') IS NULL THEN 0 ELSE 1 END AS columnas_equipo,
  CASE WHEN OBJECT_ID(N'[dbo].[TR_chat_project_team_event_inmutable]', N'TR') IS NULL THEN 0 ELSE 1 END AS auditoria_inmutable,
  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_project_subagent_slug_vivo') THEN 1 ELSE 0 END AS slug_unico;
