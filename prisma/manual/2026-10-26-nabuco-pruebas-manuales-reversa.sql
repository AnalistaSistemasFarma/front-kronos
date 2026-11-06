/*
  REVERSA — «Transferencias Nabuco»: pruebas manuales (2026-10-26).
  Borra la tabla nabuco_prueba_manual (historial de pruebas manuales). No toca nabuco_config
  ni nabuco_envio. Si hay pruebas registradas, exige aceptar la pérdida del historial:
    EXEC sp_set_session_context N'nabuco_pruebas_reversa_acepta_perdida', 1;
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51713, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.nabuco_prueba_manual', N'U') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.nabuco_prueba_manual) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'nabuco_pruebas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51714, N'Hay pruebas registradas en nabuco_prueba_manual. Para aceptar su pérdida: EXEC sp_set_session_context N''nabuco_pruebas_reversa_acepta_perdida'', 1;', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.nabuco_prueba_manual', N'U') IS NOT NULL DROP TABLE [dbo].[nabuco_prueba_manual];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COUNT(*) AS tablas_nabuco_restantes FROM sys.tables WHERE name LIKE N'nabuco[_]%';
