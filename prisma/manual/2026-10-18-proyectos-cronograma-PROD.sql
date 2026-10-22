/*
  PASE MANUAL — Cronograma y calendario del módulo «Proyectos» (2026-10-18) — SOLO KRONOSDB (producción).
  Pedido de Nicolás Rivera del 2026-10-18 por SynerLink. NO correr sin el visto bueno de Nicolás.
  Requiere antes el PROD del módulo (2026-10-18-proyectos-modulo-PROD.sql) y el de la F1.

  PRERREQUISITO (si falta, el script se detiene sin escribir nada):
    prisma/migrations/20261018120000_proyectos_modulo (el módulo «Proyectos»).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261018180000_proyectos_cronograma/migration.sql
    (fecha objetivo de solicitudes, tareas, auditoría inmutable, propuestas de los
    asistentes y concesiones de 24 h para kronos-mcp). No otorga permisos: el cronograma
    vive dentro del módulo «Proyectos» y usa su mismo permiso.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261018180000_proyectos_cronograma
  REVERSA: prisma/manual/2026-10-18-proyectos-cronograma-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51493, N'Base no esperada: este script solo corre en KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_project_request]', N'U') IS NULL OR OBJECT_ID(N'[dbo].[chat_project_agent]', N'U') IS NULL
  THROW 51490, N'Falta la migración 20261018120000_proyectos_modulo. Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

/* ---- 1. Fecha objetivo de la solicitud vinculada ------------------------ */
IF COL_LENGTH(N'dbo.chat_project_request', N'target_date') IS NULL
  ALTER TABLE [dbo].[chat_project_request] ADD [target_date] DATE NULL;

/* ---- 2. chat_project_task ---------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_task]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_task] (
    [id_project_task] INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [title]           NVARCHAR(200)  NOT NULL,
    [description]     NVARCHAR(2000) NULL,
    [id_responsible]  NVARCHAR(1000) NULL,
    [start_date]      DATE           NOT NULL,
    [end_date]        DATE           NOT NULL,
    [status]          NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_task_status_df] DEFAULT N'pendiente',
    [progress]        INT            NULL,
    [is_milestone]    BIT            NOT NULL CONSTRAINT [chat_project_task_is_milestone_df] DEFAULT 0,
    [origin]          NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_task_origin_df] DEFAULT N'persona',
    [created_by]      NVARCHAR(1000) NOT NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_task_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by]      NVARCHAR(1000) NULL,
    [updated_at]      DATETIME2      NULL,
    CONSTRAINT [chat_project_task_pkey] PRIMARY KEY CLUSTERED ([id_project_task]),
    CONSTRAINT [chat_project_task_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE NONCLUSTERED INDEX [chat_project_task_id_project_start_date_idx] ON [dbo].[chat_project_task]([id_project], [start_date]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_task_status_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_task] WITH CHECK ADD CONSTRAINT [chat_project_task_status_ck]
    CHECK ([status] IN (N''pendiente'', N''en_curso'', N''hecha'', N''bloqueada''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_task_progress_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_task] WITH CHECK ADD CONSTRAINT [chat_project_task_progress_ck]
    CHECK ([progress] IS NULL OR ([progress] >= 0 AND [progress] <= 100));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_task_fechas_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_task] WITH CHECK ADD CONSTRAINT [chat_project_task_fechas_ck]
    CHECK ([end_date] >= [start_date] AND ([is_milestone] = 0 OR [end_date] = [start_date]));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_task_origin_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_task] WITH CHECK ADD CONSTRAINT [chat_project_task_origin_ck]
    CHECK ([origin] IN (N''persona'', N''agente''));');

/* ---- 3. chat_project_event (auditoría inmutable) ------------------------ */
IF OBJECT_ID(N'[dbo].[chat_project_event]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_event] (
    [id_event]   INT            IDENTITY(1,1) NOT NULL,
    [id_project] INT            NOT NULL,
    [entity]     NVARCHAR(20)   NOT NULL,
    [id_entity]  INT            NULL,
    [action]     NVARCHAR(30)   NOT NULL,
    [detail]     NVARCHAR(1000) NOT NULL,
    [changes]    NVARCHAR(MAX)  NULL,
    [id_user]    NVARCHAR(1000) NULL,
    [id_agent]   INT            NULL,
    [via]        NVARCHAR(20)   NOT NULL,
    [created_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_event_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_event_pkey] PRIMARY KEY CLUSTERED ([id_event])
  );
  CREATE NONCLUSTERED INDEX [chat_project_event_id_project_created_at_idx] ON [dbo].[chat_project_event]([id_project], [created_at]);
  CREATE NONCLUSTERED INDEX [chat_project_event_entity_id_entity_idx] ON [dbo].[chat_project_event]([entity], [id_entity]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_event_via_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_event] WITH CHECK ADD CONSTRAINT [chat_project_event_via_ck]
    CHECK ([via] IN (N''web'', N''puente'', N''mcp'') AND [entity] IN (N''tarea'', N''solicitud'', N''propuesta'', N''concesion''));');

IF OBJECT_ID(N'[dbo].[TR_chat_project_event_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_event_inmutable] ON [dbo].[chat_project_event]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51491, N''La auditoría del cronograma (chat_project_event) no se cambia ni se borra.'', 1;
    END;');

/* ---- 4. chat_project_proposal ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_proposal]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_proposal] (
    [id_proposal]     INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [kind]            NVARCHAR(30)   NOT NULL,
    [payload]         NVARCHAR(MAX)  NOT NULL,
    [summary]         NVARCHAR(500)  NOT NULL,
    [status]          NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_proposal_status_df] DEFAULT N'pendiente',
    [source]          NVARCHAR(20)   NOT NULL,
    [id_agent]        INT            NOT NULL,
    [id_conversation] INT            NULL,
    [id_grant]        INT            NULL,
    [requested_for]   NVARCHAR(1000) NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_proposal_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [expires_at]      DATETIME2      NOT NULL,
    [decided_by]      NVARCHAR(1000) NULL,
    [decided_at]      DATETIME2      NULL,
    [result]          NVARCHAR(500)  NULL,
    CONSTRAINT [chat_project_proposal_pkey] PRIMARY KEY CLUSTERED ([id_proposal]),
    CONSTRAINT [chat_project_proposal_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE NONCLUSTERED INDEX [chat_project_proposal_id_project_status_idx] ON [dbo].[chat_project_proposal]([id_project], [status]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_proposal_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_proposal] WITH CHECK ADD CONSTRAINT [chat_project_proposal_valores_ck]
    CHECK ([kind] IN (N''tarea_crear'', N''tarea_editar'', N''solicitud_vincular'', N''solicitud_desvincular'', N''conversacion_crear'', N''miembro_invitar'')
      AND [status] IN (N''pendiente'', N''ejecutando'', N''confirmada'', N''rechazada'', N''vencida'', N''fallida'')
      AND [source] IN (N''puente'', N''mcp''));');
-- Una propuesta del MCP siempre es A NOMBRE DE una persona y con SU concesión.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_proposal_mcp_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_proposal] WITH CHECK ADD CONSTRAINT [chat_project_proposal_mcp_ck]
    CHECK ([source] <> N''mcp'' OR ([requested_for] IS NOT NULL AND [id_grant] IS NOT NULL));');

/* ---- 5. chat_project_grant (concesión de 24 h para kronos-mcp) ---------- */
IF OBJECT_ID(N'[dbo].[chat_project_grant]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_grant] (
    [id_grant]             INT            IDENTITY(1,1) NOT NULL,
    [token]                NVARCHAR(80)   NOT NULL,
    [id_user]              NVARCHAR(1000) NOT NULL,
    [id_agent]             INT            NOT NULL,
    [id_project]           INT            NULL,
    [id_chat_conversation] INT            NOT NULL,
    [created_at]           DATETIME2      NOT NULL CONSTRAINT [chat_project_grant_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [expires_at]           DATETIME2      NOT NULL,
    [revoked_at]           DATETIME2      NULL,
    [revoked_by]           NVARCHAR(1000) NULL,
    CONSTRAINT [chat_project_grant_pkey] PRIMARY KEY CLUSTERED ([id_grant]),
    CONSTRAINT [UQ_chat_project_grant_token] UNIQUE NONCLUSTERED ([token]),
    CONSTRAINT [chat_project_grant_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_grant_id_user_id_agent_idx] ON [dbo].[chat_project_grant]([id_user], [id_agent]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_grant_vigencia_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_grant] WITH CHECK ADD CONSTRAINT [chat_project_grant_vigencia_ck]
    CHECK ([expires_at] > [created_at] AND [expires_at] <= DATEADD(HOUR, 25, [created_at]) AND [token] LIKE N''pg[_]%'');');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  (SELECT COUNT(*) FROM [dbo].[chat_project_task]) AS tareas,
  (SELECT COUNT(*) FROM [dbo].[chat_project_proposal]) AS propuestas,
  (SELECT COUNT(*) FROM [dbo].[chat_project_grant]) AS concesiones,
  (SELECT COUNT(*) FROM [dbo].[chat_project_event]) AS eventos,
  CASE WHEN COL_LENGTH(N'dbo.chat_project_request', N'target_date') IS NULL THEN 0 ELSE 1 END AS fecha_objetivo,
  CASE WHEN OBJECT_ID(N'[dbo].[TR_chat_project_event_inmutable]', N'TR') IS NULL THEN 0 ELSE 1 END AS auditoria_inmutable;
