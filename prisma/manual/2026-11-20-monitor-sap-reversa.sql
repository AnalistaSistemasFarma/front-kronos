/*
  REVERSA — Monitor SAP (SQL de SAP, vistas y Service Layer). Deshace prisma/manual/2026-11-20-monitor-sap-*.sql.
  Borra las 7 tablas dbo.sap_monitor_* CON SUS FILAS. Son métricas (historial de 30 días como máximo): no hay
  datos de negocio. Las alertas ya enviadas quedan en dbo.system_metric_alert (no se tocan).
  Antes de correrla, apague el monitor (SAP_SQL_MONITOR_URL vacío) o el código solo mostrará «aún no habilitado».
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51703, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'dbo.sap_monitor_sl_session', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_sl_session;
IF OBJECT_ID(N'dbo.sap_monitor_sl_node', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_sl_node;
IF OBJECT_ID(N'dbo.sap_monitor_sl_view', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_sl_view;
IF OBJECT_ID(N'dbo.sap_monitor_view_inventory', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_view_inventory;
IF OBJECT_ID(N'dbo.sap_monitor_view_stat', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_view_stat;
IF OBJECT_ID(N'dbo.sap_monitor_incident', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_incident;
IF OBJECT_ID(N'dbo.sap_monitor_sample', N'U') IS NOT NULL DROP TABLE dbo.sap_monitor_sample;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT COUNT(*) AS tablas_restantes FROM sys.tables WHERE name LIKE N'sap[_]monitor[_]%';
