/*
  REVERSA del pase 2026-10-05-system-metrics.sql (Monitor del sistema).
  Borra SOLO las tres tablas de métricas (datos de monitoreo, no de negocio).
  Antes de correrla, desactive el colector con SYSTEM_METRICS_ENABLED=false y reinicie pm2.
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.system_metric_sample', N'U') IS NOT NULL DROP TABLE dbo.system_metric_sample;
  IF OBJECT_ID(N'dbo.system_metric_route', N'U') IS NOT NULL DROP TABLE dbo.system_metric_route;
  IF OBJECT_ID(N'dbo.system_metric_db', N'U') IS NOT NULL DROP TABLE dbo.system_metric_db;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla_restante FROM sys.tables
WHERE name IN ('system_metric_sample', 'system_metric_route', 'system_metric_db');
