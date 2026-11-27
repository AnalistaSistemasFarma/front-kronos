/*
  REVERSAL — Annual calendar of a flow (2026-11-26). Deploy the previous CODE first. Only drops the configuration
  (the requests themselves are not touched).
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51852, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

IF COL_LENGTH(N'dbo.process_category', N'calendar_group_field') IS NOT NULL ALTER TABLE dbo.process_category DROP COLUMN calendar_group_field;
IF COL_LENGTH(N'dbo.process_category', N'calendar_field') IS NOT NULL ALTER TABLE dbo.process_category DROP COLUMN calendar_field;
SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.process_category', N'calendar_field') AS calendar_field;
