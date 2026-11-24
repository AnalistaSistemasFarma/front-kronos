/*
  REVERSA — Caja negra Monitor SAPSEND / Service Layer.
  Solo elimina las tres tablas creadas por 2026-11-18-sapsend-monitor-blackbox.sql.
  No toca otras tablas.
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.sapsend_monitor_heavy', N'U') IS NOT NULL
    DROP TABLE dbo.sapsend_monitor_heavy;

  IF OBJECT_ID(N'dbo.sapsend_monitor_block', N'U') IS NOT NULL
    DROP TABLE dbo.sapsend_monitor_block;

  IF OBJECT_ID(N'dbo.sapsend_monitor_sample', N'U') IS NOT NULL
    DROP TABLE dbo.sapsend_monitor_sample;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla_restante
FROM sys.tables
WHERE name IN (
  'sapsend_monitor_sample',
  'sapsend_monitor_block',
  'sapsend_monitor_heavy'
);
