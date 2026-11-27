/*
  MANUAL MIGRATION (PROD) — Committed dates, single extension and deferred tasks for SynerLink flows. 2026-11-26.
  Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conversation 129; Calidad OLP meeting 2026-11-23:
  action plans with committed dates, ONE extension, effectiveness check 3 months after closing).

  WHAT IT DOES (idempotent, additive; no existing data is modified):
    1. dbo.process_date_tracking: which table field of a flow carries committed dates (and its extension/status columns),
       how many business days before to warn and whether only one extension is allowed.
    2. dbo.task_process_category.start_delay_days (NULL = immediate) and dbo.task_deferred (tasks waiting their date).
    3. One row in dbo.scheduled_job: job_type «workflow_followups», every day at 6:00 a. m. (data row, no structure change).
  Locks: ADD of a NULL column is metadata-only. LOCK_TIMEOUT 5000 aborts instead of waiting.
  ORDER: before the code. REVERSAL: prisma/manual/2026-11-26-flujos-fechas-eficacia-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51841, N'Unexpected database: this script is only for KRONOSDB (production).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  -- 1. Committed-date tracking of a table field of the flow (e.g. «Plan de acción»: Fecha comprometida / Nueva fecha / Estado).
  IF OBJECT_ID(N'dbo.process_date_tracking', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.process_date_tracking (
      id_process_category INT            NOT NULL CONSTRAINT PK_process_date_tracking PRIMARY KEY,
      id_form_field       INT            NOT NULL,
      date_col            NVARCHAR(60)   NOT NULL,
      extension_col       NVARCHAR(60)   NULL,
      status_col          NVARCHAR(60)   NULL,
      done_value          NVARCHAR(100)  NULL,
      warn_business_days  INT            NOT NULL CONSTRAINT DF_process_date_tracking_warn DEFAULT 7,
      single_extension    BIT            NOT NULL CONSTRAINT DF_process_date_tracking_single DEFAULT 1,
      updated_by          NVARCHAR(255)  NULL,
      updated_at          DATETIME       NOT NULL CONSTRAINT DF_process_date_tracking_updated DEFAULT GETDATE(),
      CONSTRAINT CK_process_date_tracking_warn CHECK (warn_business_days BETWEEN 0 AND 60)
    );
  END;

  -- 2. Deferred task: created N calendar days after the previous one closes (e.g. effectiveness check at 90 days).
  IF COL_LENGTH(N'dbo.task_process_category', N'start_delay_days') IS NULL
    ALTER TABLE dbo.task_process_category ADD start_delay_days INT NULL;

  IF OBJECT_ID(N'dbo.task_deferred', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.task_deferred (
      id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_task_deferred PRIMARY KEY,
      id_request_general INT      NOT NULL,
      id_task            INT      NOT NULL,
      due_at             DATETIME NOT NULL,
      created_at         DATETIME NOT NULL CONSTRAINT DF_task_deferred_created DEFAULT GETDATE(),
      done_at            DATETIME NULL,
      prev_id_task       INT      NULL,
      prev_display_order INT      NULL,
      id_process_category INT     NULL,
      CONSTRAINT UQ_task_deferred UNIQUE (id_request_general, id_task)
    );
    CREATE INDEX IX_task_deferred_due ON dbo.task_deferred (done_at, due_at);
  END;
  -- Context of the previous task (to create the deferred one with the same assignment logic).
  IF COL_LENGTH(N'dbo.task_deferred', N'prev_id_task') IS NULL
    ALTER TABLE dbo.task_deferred ADD prev_id_task INT NULL, prev_display_order INT NULL, id_process_category INT NULL;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

-- 3. Daily job of the central scheduler (one row, 6:00 a. m. server time), if it does not exist.
IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.scheduled_job WHERE job_type = N'workflow_followups')
BEGIN
  DECLARE @Next DATETIME = DATEADD(HOUR, 6, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
  IF @Next <= GETDATE() SET @Next = DATEADD(DAY, 1, @Next);
  EXEC sp_executesql N'INSERT INTO dbo.scheduled_job (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
    VALUES (N''Flujos · fechas comprometidas y tareas diferidas'', N''workflow_followups'', NULL, N''0 6 * * *'', @Next, 1, N''solicitudes-generales'', N''sistema'', GETDATE());',
    N'@Next DATETIME', @Next = @Next;
END;

SELECT DB_NAME() AS db,
       OBJECT_ID(N'dbo.process_date_tracking', N'U') AS date_tracking,
       COL_LENGTH(N'dbo.task_process_category', N'start_delay_days') AS start_delay_days,
       OBJECT_ID(N'dbo.task_deferred', N'U') AS task_deferred,
       (SELECT COUNT(*) FROM dbo.scheduled_job WHERE job_type = N'workflow_followups') AS job;
