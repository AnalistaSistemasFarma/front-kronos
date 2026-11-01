/*
  REVERSA — Ventas: configuración y autorización (2026-10-30-ventas-autorizacion-{PRUEBAS,PROD}.sql).
  Borra las tablas sales_* y los subprocesos /process/sales*, con sus permisos asignados.
  Se detiene si ya hay autorizaciones de ventas registradas, salvo que se declare
  EXEC sp_set_session_context N'forzar_reversa_ventas', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51490, N'Base no esperada.', 1;

IF OBJECT_ID(N'dbo.sales_authorization', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM [dbo].[sales_authorization])
   AND ISNULL(CAST(SESSION_CONTEXT(N'forzar_reversa_ventas') AS INT), 0) <> 1
  THROW 51491, N'Hay autorizaciones de ventas registradas: no se revierte sin forzar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
  INNER JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url IN (N'/process/sales', N'/process/sales/manage', N'/process/sales/automatizacion');

  DELETE FROM [dbo].[subprocess]
  WHERE subprocess_url IN (N'/process/sales', N'/process/sales/manage', N'/process/sales/automatizacion');

  IF OBJECT_ID(N'dbo.sales_authorization', N'U') IS NOT NULL DROP TABLE [dbo].[sales_authorization];
  IF OBJECT_ID(N'dbo.sales_stage_department', N'U') IS NOT NULL DROP TABLE [dbo].[sales_stage_department];
  IF OBJECT_ID(N'dbo.sales_company_config', N'U') IS NOT NULL DROP TABLE [dbo].[sales_company_config];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.sales_authorization', N'U') AS tabla_autorizacion,
       (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/sales%') AS subprocesos_ventas;
