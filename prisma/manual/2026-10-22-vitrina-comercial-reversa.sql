/*
  REVERSA — Vitrina Comercial, sprint V2 (2026-10-22). Deshace
  prisma/migrations/20261022200000_vitrina_comercial, 2026-10-22-vitrina-comercial-PRUEBAS/PROD.sql
  y 2026-10-22-vitrina-subprocesos-PRUEBAS/PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente):
    1. Borra la tarea nocturna (scheduled_job «vitrina_sincronizar_sap») y sus corridas.
    2. Quita los permisos (subprocess_user_company) y los subprocesos /process/vitrina y /process/vitrina/gestion.
    3. Borra las 8 tablas vitrina_* (hijas primero).

  PÉRDIDA DE DATOS: si ya hay presentaciones, historial o exclusividades, se pierden. Por eso se
  NIEGA salvo que la sesión declare la bandera:  EXEC sp_set_session_context N'vitrina_reversa_acepta_perdida', 1;
  (Los códigos SAP se vuelven a leer de SAP; la Gestión hecha a mano no.)

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. No toca el proceso «Ventas».
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51606, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.vitrina_presentacion) OR EXISTS (SELECT 1 FROM dbo.vitrina_historial WHERE id_user IS NOT NULL) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'vitrina_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51607, N'Hay datos de Gestión de la Vitrina (presentaciones o historial). Para aceptar su pérdida: EXEC sp_set_session_context N''vitrina_reversa_acepta_perdida'', 1;', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[scheduled_job_run]', N'U') IS NOT NULL
    EXEC sp_executesql N'DELETE r FROM [dbo].[scheduled_job_run] r JOIN [dbo].[scheduled_job] j ON j.id = r.id_job WHERE j.job_type = N''vitrina_sincronizar_sap'';';
  EXEC sp_executesql N'DELETE FROM [dbo].[scheduled_job] WHERE job_type = N''vitrina_sincronizar_sap'';';
END;

DELETE suc FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url IN (N'/process/vitrina', N'/process/vitrina/gestion');
DELETE FROM [dbo].[subprocess] WHERE subprocess_url IN (N'/process/vitrina', N'/process/vitrina/gestion');

IF OBJECT_ID(N'dbo.vitrina_historial', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_historial];
IF OBJECT_ID(N'dbo.vitrina_documento', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_documento];
IF OBJECT_ID(N'dbo.vitrina_imagen', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_imagen];
IF OBJECT_ID(N'dbo.vitrina_exclusividad', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_exclusividad];
IF OBJECT_ID(N'dbo.vitrina_presentacion_area', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_presentacion_area];
IF OBJECT_ID(N'dbo.vitrina_area', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_area];
IF OBJECT_ID(N'dbo.vitrina_codigo_sap', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_codigo_sap];
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_presentacion];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COUNT(*) AS tablas_vitrina_restantes FROM sys.tables WHERE name LIKE N'vitrina[_]%';
SELECT DB_NAME() AS base, COUNT(*) AS subprocesos_vitrina_restantes FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/vitrina%';
