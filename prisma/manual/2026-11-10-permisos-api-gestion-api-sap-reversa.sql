/*
  REVERSA — Permisos API: permiso «Gestión de la API SAP». 2026-11-10.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Quita las asignaciones del subproceso /process/api-sap,
  el subproceso y el proceso «API SAP» si ya no le quedan subprocesos. Después nadie entra al panel.
  ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51494, N'Base no esperada.', 1;

DECLARE @SubUrl NVARCHAR(255) = N'/process/api-sap';
DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @SubUrl);

BEGIN TRY
  BEGIN TRANSACTION;
  DELETE suc FROM [dbo].[subprocess_user_company] suc
    JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
   WHERE LOWER(LTRIM(RTRIM(s.subprocess_url))) = @SubUrl;
  DELETE FROM [dbo].[subprocess] WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @SubUrl;
  IF @ProcessId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE id_process = @ProcessId)
    DELETE FROM [dbo].[process] WHERE id_process = @ProcessId AND process = N'API SAP';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl) AS subproceso_existe;
