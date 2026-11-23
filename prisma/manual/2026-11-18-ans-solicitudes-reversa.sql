/*
  REVERSAL — SLA (ANS) for SynerLink requests (2026-11-18). Valid for KRONOSDB_PRUEBAS and KRONOSDB.
  Drops the SLA columns of dbo.process_category and the dbo.request_sla_pause table.
  Deploy the previous app version FIRST (the new code reads these columns).
  The baseline values are lost: keep the backup table dbo.bk_20261118_process_category_sla
  (created by the data script) if they must be restored later.
*/
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB') THROW 51802, N'Unexpected database.', 1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.request_sla_pause', N'U') IS NOT NULL DROP TABLE dbo.request_sla_pause;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_process_category_sla')
  ALTER TABLE dbo.process_category DROP CONSTRAINT CK_process_category_sla;
IF COL_LENGTH(N'dbo.process_category', N'sla_value') IS NOT NULL
  ALTER TABLE dbo.process_category DROP COLUMN sla_value, sla_unit, sla_warn_pct, sla_source, sla_updated_at, sla_updated_by;
COMMIT TRANSACTION;
SELECT COL_LENGTH(N'dbo.process_category', N'sla_value') AS has_sla_value, OBJECT_ID(N'dbo.request_sla_pause', N'U') AS pause_table_id;
