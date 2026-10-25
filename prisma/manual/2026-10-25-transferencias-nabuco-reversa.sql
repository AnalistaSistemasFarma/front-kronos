/*
  REVERSA — Módulo «Transferencias Nabuco» (2026-10-25).
  Borra las tareas nabuco_* del programador (y sus corridas), los permisos y subprocesos del
  módulo y las tablas nabuco_envio / nabuco_config. NO borra el proceso «Logística» (puede
  tener otros subprocesos).
  Si hay envíos registrados, exige aceptar la pérdida del log:
    EXEC sp_set_session_context N'nabuco_reversa_acepta_perdida', 1;
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51702, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.nabuco_envio', N'U') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.nabuco_envio) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'nabuco_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51703, N'Hay envíos registrados en nabuco_envio. Para aceptar su pérdida: EXEC sp_set_session_context N''nabuco_reversa_acepta_perdida'', 1;', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[scheduled_job_run]', N'U') IS NOT NULL
    EXEC sp_executesql N'DELETE r FROM [dbo].[scheduled_job_run] r JOIN [dbo].[scheduled_job] j ON j.id = r.id_job WHERE j.job_type IN (N''nabuco_transferir'', N''nabuco_vigilar'');';
  EXEC sp_executesql N'DELETE FROM [dbo].[scheduled_job] WHERE job_type IN (N''nabuco_transferir'', N''nabuco_vigilar'');';
END;

DELETE suc FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url IN (N'/process/transferencias-nabuco', N'/process/transferencias-nabuco/admin');
DELETE FROM [dbo].[subprocess] WHERE subprocess_url IN (N'/process/transferencias-nabuco', N'/process/transferencias-nabuco/admin');

IF OBJECT_ID(N'dbo.nabuco_envio', N'U') IS NOT NULL DROP TABLE [dbo].[nabuco_envio];
IF OBJECT_ID(N'dbo.nabuco_config', N'U') IS NOT NULL DROP TABLE [dbo].[nabuco_config];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COUNT(*) AS tablas_nabuco_restantes FROM sys.tables WHERE name LIKE N'nabuco[_]%';
