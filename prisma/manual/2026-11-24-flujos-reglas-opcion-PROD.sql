/*
  MANUAL MIGRATION (PROD) — Option rules for SynerLink flows: consecutive, SLA and assignee by option. 2026-11-24.
  Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conversation 129; Calidad OLP meeting 2026-11-23).

  WHAT IT DOES (idempotent, additive; no existing data is modified):
    1. dbo.process_category.consecutive_prefix  default prefix of the flow consecutive (NULL = none).
    2. dbo.requests_general.consecutive         e.g. AU-0001 (NULL for existing requests and flows without prefix);
       dbo.requests_general.sla_value/sla_unit  SLA chosen by an option rule (NULL = the flow SLA).
    3. dbo.process_option_rule   per option of a list field: consecutive prefix and SLA (e.g. Crítica = 8 business days).
    4. dbo.task_option_assignee  per task and option: who does the task (e.g. the leader of the chosen area).
    5. dbo.request_consecutive_counter  last number per company and prefix.

  Locks: ADD of NULL columns is metadata-only (Sch-M lock for milliseconds on process_category and requests_general);
  the filtered index on requests_general.consecutive is built on an all-NULL column (empty). LOCK_TIMEOUT 5000 aborts.
  ORDER: before the code. REVERSAL: prisma/manual/2026-11-24-flujos-reglas-opcion-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51821, N'Unexpected database: this script is only for KRONOSDB (production).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  -- 1. Default consecutive prefix of a flow (NULL = no consecutive, only the request number).
  IF COL_LENGTH(N'dbo.process_category', N'consecutive_prefix') IS NULL
    ALTER TABLE dbo.process_category ADD consecutive_prefix NVARCHAR(10) NULL;

  -- 2. Per request: its consecutive and the SLA chosen by an option rule (NULL = the flow SLA).
  IF COL_LENGTH(N'dbo.requests_general', N'consecutive') IS NULL
    ALTER TABLE dbo.requests_general ADD consecutive NVARCHAR(30) NULL;
  IF COL_LENGTH(N'dbo.requests_general', N'sla_value') IS NULL
    ALTER TABLE dbo.requests_general ADD sla_value INT NULL, sla_unit NVARCHAR(16) NULL;

  -- 3. Rules per option of a list field: consecutive prefix and SLA.
  IF OBJECT_ID(N'dbo.process_option_rule', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.process_option_rule (
      id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_process_option_rule PRIMARY KEY,
      id_process_category INT           NOT NULL,
      id_option           INT           NOT NULL,
      prefix              NVARCHAR(10)  NULL,
      sla_value           INT           NULL,
      sla_unit            NVARCHAR(16)  NULL,
      updated_by          NVARCHAR(255) NULL,
      updated_at          DATETIME      NOT NULL CONSTRAINT DF_process_option_rule_updated DEFAULT GETDATE(),
      CONSTRAINT UQ_process_option_rule UNIQUE (id_process_category, id_option),
      CONSTRAINT CK_process_option_rule CHECK (
        (prefix IS NULL OR (LEN(prefix) BETWEEN 1 AND 10 AND prefix NOT LIKE N'%[^A-Z0-9]%'))
        AND (sla_value IS NULL OR (sla_value BETWEEN 1 AND 10000 AND sla_unit IN (N'business_hours', N'business_days', N'calendar_hours'))))
    );
  END;

  -- 4. Assignee of a task by option (e.g. the leader of the chosen area); replaces the task template assignees.
  IF OBJECT_ID(N'dbo.task_option_assignee', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.task_option_assignee (
      id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_task_option_assignee PRIMARY KEY,
      id_task    INT           NOT NULL,
      id_option  INT           NOT NULL,
      id_user    NVARCHAR(50)  NOT NULL,
      updated_by NVARCHAR(255) NULL,
      updated_at DATETIME      NOT NULL CONSTRAINT DF_task_option_assignee_updated DEFAULT GETDATE(),
      CONSTRAINT UQ_task_option_assignee UNIQUE (id_task, id_option)
    );
  END;

  -- 5. Consecutive counters per company and prefix.
  IF OBJECT_ID(N'dbo.request_consecutive_counter', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.request_consecutive_counter (
      id_company INT          NOT NULL,
      prefix     NVARCHAR(10) NOT NULL,
      last_value INT          NOT NULL,
      CONSTRAINT PK_request_consecutive_counter PRIMARY KEY (id_company, prefix)
    );
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_requests_general_consecutive' AND object_id = OBJECT_ID(N'dbo.requests_general'))
  EXEC (N'CREATE INDEX IX_requests_general_consecutive ON dbo.requests_general (consecutive) WHERE consecutive IS NOT NULL;');

SELECT DB_NAME() AS db,
       COL_LENGTH(N'dbo.process_category', N'consecutive_prefix') AS consecutive_prefix,
       COL_LENGTH(N'dbo.requests_general', N'consecutive') AS request_consecutive,
       COL_LENGTH(N'dbo.requests_general', N'sla_value') AS request_sla,
       OBJECT_ID(N'dbo.process_option_rule', N'U') AS option_rule,
       OBJECT_ID(N'dbo.task_option_assignee', N'U') AS option_assignee,
       OBJECT_ID(N'dbo.request_consecutive_counter', N'U') AS counter;
