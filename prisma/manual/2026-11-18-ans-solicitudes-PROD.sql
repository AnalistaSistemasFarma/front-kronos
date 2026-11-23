/*
  MANUAL MIGRATION (PROD) — SLA (ANS) for SynerLink requests. 2026-11-18.
  DB: KRONOSDB (the script stops on any other database).
  Requested by: Nicolás Rivera (SynerLink prod conv 1, msg 36101).

  WHAT IT DOES (idempotent, additive; no existing data is modified):
    1. dbo.process_category gets SLA columns (all NULL = "Sin ANS"):
         sla_value       INT          SLA amount (baseline stores business hours)
         sla_unit        NVARCHAR(16) 'business_hours' | 'business_days' | 'calendar_hours'
         sla_warn_pct    TINYINT      near-due threshold, % of SLA remaining (NULL = 20)
         sla_source      NVARCHAR(16) 'baseline' (computed from history) | 'manual' (admin)
         sla_updated_at  DATETIME     last change
         sla_updated_by  NVARCHAR(255) user id of the last change (NULL for baseline)
    2. dbo.request_sla_pause: intervals where the SLA clock is paused (request returned
       to the requester, status 7). Filled by the app from now on.
    3. Opens a pause (paused_at = now) for requests that are ALREADY returned (status 7),
       because the real return date is not recorded historically.

  Locks: ALTER TABLE ADD of NULL columns is metadata-only (Sch-M lock for milliseconds on
  process_category). LOCK_TIMEOUT 5000 aborts instead of waiting behind a long transaction.
  REVERSAL: prisma/manual/2026-11-18-ans-solicitudes-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51801, N'Unexpected database: this script is only for KRONOSDB.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.process_category', N'sla_value') IS NULL
    ALTER TABLE dbo.process_category ADD
      sla_value      INT           NULL,
      sla_unit       NVARCHAR(16)  NULL,
      sla_warn_pct   TINYINT       NULL,
      sla_source     NVARCHAR(16)  NULL,
      sla_updated_at DATETIME      NULL,
      sla_updated_by NVARCHAR(255) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_process_category_sla')
    EXEC (N'ALTER TABLE dbo.process_category WITH CHECK ADD CONSTRAINT CK_process_category_sla CHECK (
      (sla_value IS NULL OR sla_value > 0)
      AND (sla_unit IS NULL OR sla_unit IN (N''business_hours'', N''business_days'', N''calendar_hours''))
      AND (sla_warn_pct IS NULL OR sla_warn_pct BETWEEN 1 AND 99)
      AND (sla_source IS NULL OR sla_source IN (N''baseline'', N''manual'')));');

  IF OBJECT_ID(N'dbo.request_sla_pause', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.request_sla_pause (
      id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_request_sla_pause PRIMARY KEY,
      id_request_general INT          NOT NULL,
      paused_at          DATETIME     NOT NULL,
      resumed_at         DATETIME     NULL,
      reason             NVARCHAR(32) NOT NULL CONSTRAINT CK_request_sla_pause_reason CHECK (reason IN (N'returned', N'draft')),
      note               NVARCHAR(200) NULL,
      created_at         DATETIME     NOT NULL CONSTRAINT DF_request_sla_pause_created DEFAULT GETDATE()
    );
    CREATE INDEX IX_request_sla_pause_request ON dbo.request_sla_pause (id_request_general, resumed_at);
  END

  -- Requests already returned: open the pause now (historic return date is unknown).
  INSERT INTO dbo.request_sla_pause (id_request_general, paused_at, reason, note)
  SELECT rg.id, GETDATE(), N'returned', N'Opened at go-live (return date unknown)'
  FROM dbo.requests_general rg
  WHERE rg.status_req = 7
    AND NOT EXISTS (SELECT 1 FROM dbo.request_sla_pause p WHERE p.id_request_general = rg.id AND p.resumed_at IS NULL);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT COL_LENGTH(N'dbo.process_category', N'sla_value') AS has_sla_value,
       OBJECT_ID(N'dbo.request_sla_pause', N'U') AS pause_table_id,
       (SELECT COUNT(*) FROM dbo.request_sla_pause) AS pause_rows;
