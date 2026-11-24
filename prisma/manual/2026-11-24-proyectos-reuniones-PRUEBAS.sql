/*
  PASE MANUAL (PRUEBAS) — Proyectos: «Reuniones» del proyecto y análisis a demanda con el agente. 2026-11-24.
  Aprobado por Nicolás Rivera (SynerLink conv. 1, msg 38206).
  BASE: KRONOSDB_PRUEBAS (o la base efímera kronos_ci de la CI). El script se detiene en cualquier otra base.

  Correr ANTES de desplegar el código en pruebas (.230).

  QUÉ HACE: el DDL de prisma/migrations/20261124150000_chat_project_meetings, nada más. Crea:
    - dbo.chat_project_meeting (reunión asignada a un proyecto; ical_uid ÚNICO = una reunión, un proyecto);
    - dbo.chat_project_meeting_rule (regla «toda la serie va a este proyecto»);
    - dbo.chat_project_meeting_analysis (resultado del análisis del agente; la transcripción NO se guarda).
  No altera tablas existentes ni inserta filas. Aditivo e IDEMPOTENTE; informa antes y después.

  🔒 BLOQUEOS: crear tablas nuevas no bloquea tablas existentes (las FK a chat_project piden un bloqueo
  breve de esquema sobre chat_project). No toca User, company_user ni subprocess_user_company: el login
  no se ve afectado. LOCK_TIMEOUT 5000: si no consigue el bloqueo en 5 s hace ROLLBACK; vuelva a correrlo.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS.
  REVERSA: prisma/manual/2026-11-24-proyectos-reuniones-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 52402, N'Base no esperada para este script (PRUEBAS).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NULL THEN 0 ELSE 1 END AS existe_meeting, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NULL THEN 0 ELSE 1 END AS existe_rule, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_analysis', N'U') IS NULL THEN 0 ELSE 1 END AS existe_analysis;

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_project]', N'U') IS NULL
  THROW 52401, N'Missing table dbo.chat_project (migration 20261017120000_chat_projects). Apply it first.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_meeting]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_meeting] (
    [id_project_meeting]  INT            IDENTITY(1,1) NOT NULL,
    [id_project]          INT            NOT NULL,
    [ical_uid]            NVARCHAR(400)  NOT NULL,
    [series_key]          NVARCHAR(512)  NULL,
    [event_id]            NVARCHAR(512)  NOT NULL,
    [mailbox]             NVARCHAR(254)  NOT NULL,
    [subject]             NVARCHAR(400)  NOT NULL,
    [start_at]            DATETIME2      NOT NULL,
    [end_at]              DATETIME2      NOT NULL,
    [scheduled_minutes]   INT            NOT NULL,
    [actual_minutes]      INT            NULL,
    [start_delay_minutes] INT            NULL,
    [organizer_name]      NVARCHAR(200)  NULL,
    [organizer_email]     NVARCHAR(254)  NULL,
    [attendees_count]     INT            NOT NULL CONSTRAINT [chat_project_meeting_attendees_count_df] DEFAULT 0,
    [attended_count]      INT            NULL,
    [online]              BIT            NOT NULL CONSTRAINT [chat_project_meeting_online_df] DEFAULT 0,
    [has_transcript]      BIT            NULL,
    [summary]             NVARCHAR(500)  NULL,
    [origin]              NVARCHAR(20)   NOT NULL,
    [id_rule]             INT            NULL,
    [linked_by]           NVARCHAR(1000) NOT NULL,
    [linked_at]           DATETIME2      NOT NULL CONSTRAINT [chat_project_meeting_linked_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_meeting_pkey] PRIMARY KEY CLUSTERED ([id_project_meeting]),
    CONSTRAINT [chat_project_meeting_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_meeting_origin_ck] CHECK ([origin] IN (N'manual', N'serie', N'sugerencia'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_ical_uid' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_meeting_ical_uid] ON [dbo].[chat_project_meeting]([ical_uid]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_project_start_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_meeting_project_start_idx] ON [dbo].[chat_project_meeting]([id_project], [start_at]);');

IF OBJECT_ID(N'[dbo].[chat_project_meeting_rule]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_meeting_rule] (
    [id_rule]          INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [id_user]          NVARCHAR(1000) NOT NULL,
    [mailbox]          NVARCHAR(254)  NOT NULL,
    [series_key]       NVARCHAR(512)  NOT NULL,
    [subject_snapshot] NVARCHAR(400)  NOT NULL,
    [created_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_meeting_rule_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_meeting_rule_pkey] PRIMARY KEY CLUSTERED ([id_rule]),
    CONSTRAINT [chat_project_meeting_rule_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_rule_mailbox_series' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting_rule]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_meeting_rule_mailbox_series] ON [dbo].[chat_project_meeting_rule]([mailbox], [series_key]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_rule_id_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting_rule]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_meeting_rule_id_project_idx] ON [dbo].[chat_project_meeting_rule]([id_project]);');

IF OBJECT_ID(N'[dbo].[chat_project_meeting_analysis]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_meeting_analysis] (
    [id_analysis]          INT            IDENTITY(1,1) NOT NULL,
    [id_project_meeting]   INT            NOT NULL,
    [id_agent]             INT            NOT NULL,
    [id_conversation]      INT            NULL,
    [id_message_request]   INT            NULL,
    [requested_by]         NVARCHAR(1000) NOT NULL,
    [mailbox]              NVARCHAR(254)  NOT NULL,
    [event_id]             NVARCHAR(512)  NOT NULL,
    [status]               NVARCHAR(20)   NOT NULL,
    [score]                TINYINT        NULL,
    [summary]              NVARCHAR(2000) NULL,
    [decisions_json]       NVARCHAR(MAX)  NULL,
    [commitments_json]     NVARCHAR(MAX)  NULL,
    [topics_json]          NVARCHAR(MAX)  NULL,
    [recommendations_json] NVARCHAR(MAX)  NULL,
    [followup_json]        NVARCHAR(MAX)  NULL,
    [metrics_json]         NVARCHAR(MAX)  NULL,
    [proposals_json]       NVARCHAR(MAX)  NULL,
    [could_be_email]       BIT            NULL,
    [error]                NVARCHAR(500)  NULL,
    [tokens_in]            INT            NULL,
    [tokens_out]           INT            NULL,
    [model]                NVARCHAR(60)   NULL,
    [created_at]           DATETIME2      NOT NULL CONSTRAINT [chat_project_meeting_analysis_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [finished_at]          DATETIME2      NULL,
    CONSTRAINT [chat_project_meeting_analysis_pkey] PRIMARY KEY CLUSTERED ([id_analysis]),
    CONSTRAINT [chat_project_meeting_analysis_id_project_meeting_fkey] FOREIGN KEY ([id_project_meeting]) REFERENCES [dbo].[chat_project_meeting]([id_project_meeting]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_meeting_analysis_status_ck] CHECK ([status] IN (N'analizando', N'listo', N'fallido')),
    CONSTRAINT [chat_project_meeting_analysis_score_ck] CHECK ([score] IS NULL OR [score] BETWEEN 0 AND 100)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_analysis_meeting_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting_analysis]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_meeting_analysis_meeting_idx] ON [dbo].[chat_project_meeting_analysis]([id_project_meeting], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_meeting_analysis_conversation_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_meeting_analysis]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_meeting_analysis_conversation_idx] ON [dbo].[chat_project_meeting_analysis]([id_conversation]);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NULL THEN 0 ELSE 1 END AS existe_meeting, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NULL THEN 0 ELSE 1 END AS existe_rule, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_analysis', N'U') IS NULL THEN 0 ELSE 1 END AS existe_analysis;
