/*
  Reversa del permiso «Dashboard de venta diaria» (PRUEBAS o PRODUCCIÓN).
  Idempotente. Quita las asignaciones y el subproceso; el proceso contenedor
  «Dashboards» solo se borra si quedó sin subprocesos (otros dashboards lo usan).
*/
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @SubUrl NVARCHAR(255) = N'/process/dashboards/venta-diaria';
DECLARE @SubId INT = (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess);
DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = N'Dashboards' ORDER BY id_process);

BEGIN TRANSACTION;

IF @SubId IS NOT NULL
BEGIN
  DELETE FROM [dbo].[subprocess_user_company] WHERE id_subprocess = @SubId;
  DELETE FROM [dbo].[subprocess] WHERE id_subprocess = @SubId;
END

IF @ProcessId IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE id_process = @ProcessId)
  DELETE FROM [dbo].[process] WHERE id_process = @ProcessId;

COMMIT TRANSACTION;

SELECT
  (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl) AS subprocesos_restantes,
  (SELECT COUNT(*) FROM [dbo].[process] WHERE process = N'Dashboards') AS procesos_dashboards;
