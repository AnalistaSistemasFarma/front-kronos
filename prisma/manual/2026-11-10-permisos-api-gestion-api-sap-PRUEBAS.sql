/*
  PASE MANUAL (PRUEBAS) — Permisos API: permiso «Gestión de la API SAP». 2026-11-10.
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo inserta, no borra ni modifica nada existente):
    1. Proceso «API SAP» (si no existe).
    2. Subproceso «Gestión de la API SAP» con URL /process/api-sap (página real: sale en el menú).
       Igual a API_SAP_MANAGE_URL de lib/api-permissions/constants.ts.
    NO se lo asigna a nadie. Se asigna desde Administración → Usuarios → Asignar subprocesos, como
    cualquier otro subproceso. Entra al panel quien lo tenga asignado (en cualquier empresa).

  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: SSMS (F5). Primero aquí, en PRUEBAS.
  REVERSA: prisma/manual/2026-11-10-permisos-api-gestion-api-sap-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51492, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @ProcessName NVARCHAR(255) = N'API SAP';
DECLARE @SubName     NVARCHAR(255) = N'Gestión de la API SAP';
DECLARE @SubUrl      NVARCHAR(255) = N'/process/api-sap';

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @SubUrl)
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@SubName, @ProcessId, @SubUrl);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Diagnóstico */
SELECT s.id_subprocess, s.subprocess, p.process, s.subprocess_url,
       (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc WHERE suc.id_subprocess = s.id_subprocess) AS personas_con_permiso
  FROM [dbo].[subprocess] s
  JOIN [dbo].[process] p ON p.id_process = s.id_process
 WHERE s.subprocess_url = @SubUrl;
