/*
  MANUAL MIGRATION (PRUEBAS) — Restricted access and «SGC templates only» for SynerLink flows. 2026-11-24.
  Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conversation 129).

  WHAT IT DOES (idempotent, additive; no existing data is modified):
    1. dbo.process_category gets two flags (NOT NULL DEFAULT 0 = today's behaviour):
         restricted_access   only the flow editors (and system administrators) may change the flow
         sgc_templates_only  document templates of the flow must come from a current SGC document
    2. dbo.process_category_editor: editors of a restricted flow (unique per flow and user).
    3. dbo.process_category_change_log: who changed what in a flow configuration (insert only, trigger).

  Locks: ADD of a NOT NULL column with a constant DEFAULT is metadata-only in SQL Server 2012+
  (Sch-M lock for milliseconds on process_category). LOCK_TIMEOUT 5000 aborts instead of waiting.
  ORDER: before the code. REVERSAL: prisma/manual/2026-11-24-flujos-acceso-restringido-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51810, N'Unexpected database: this script is only for KRONOSDB_PRUEBAS.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  -- 1. Restricted access and «SGC templates only» per flow (process_category). Default 0 = current behaviour.
  IF COL_LENGTH(N'dbo.process_category', N'restricted_access') IS NULL
    ALTER TABLE dbo.process_category ADD restricted_access BIT NOT NULL CONSTRAINT DF_process_category_restricted DEFAULT 0;
  IF COL_LENGTH(N'dbo.process_category', N'sgc_templates_only') IS NULL
    ALTER TABLE dbo.process_category ADD sgc_templates_only BIT NOT NULL CONSTRAINT DF_process_category_sgc_only DEFAULT 0;

  -- 2. Editors of a restricted flow (managed by system administrators).
  IF OBJECT_ID(N'dbo.process_category_editor', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.process_category_editor (
      id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_process_category_editor PRIMARY KEY,
      id_process_category INT           NOT NULL,
      id_user             NVARCHAR(50)  NOT NULL,
      created_by          NVARCHAR(255) NULL,
      created_at          DATETIME      NOT NULL CONSTRAINT DF_process_category_editor_created DEFAULT GETDATE(),
      CONSTRAINT UQ_process_category_editor UNIQUE (id_process_category, id_user)
    );
  END;

  -- 3. Change log of the flow configuration (insert only).
  IF OBJECT_ID(N'dbo.process_category_change_log', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.process_category_change_log (
      id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_process_category_change_log PRIMARY KEY,
      id_process_category INT            NOT NULL,
      actor_email         NVARCHAR(255)  NOT NULL,
      action              NVARCHAR(60)   NOT NULL,
      detail              NVARCHAR(2000) NULL,
      created_at          DATETIME       NOT NULL CONSTRAINT DF_process_category_change_log_created DEFAULT GETDATE()
    );
    CREATE INDEX IX_process_category_change_log_process ON dbo.process_category_change_log (id_process_category, created_at);
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

IF OBJECT_ID(N'dbo.process_category_change_log_insert_only', N'TR') IS NULL
  EXEC (N'CREATE TRIGGER dbo.process_category_change_log_insert_only ON dbo.process_category_change_log AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  THROW 51812, N''The flow change log is insert only.'', 1;
END');

SELECT DB_NAME() AS db,
       COL_LENGTH(N'dbo.process_category', N'restricted_access') AS restricted_access,
       COL_LENGTH(N'dbo.process_category', N'sgc_templates_only') AS sgc_templates_only,
       OBJECT_ID(N'dbo.process_category_editor', N'U') AS editor_table,
       OBJECT_ID(N'dbo.process_category_change_log', N'U') AS change_log_table;
