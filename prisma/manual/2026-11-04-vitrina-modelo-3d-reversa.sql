/*
  REVERSA. Vitrina Comercial: modelo 3D de cada presentación (2026-11-04). Deshace
  prisma/migrations/20261104120000_vitrina_modelo_3d y 2026-11-04-vitrina-modelo-3d-PRUEBAS/PROD.sql.

  ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. Si además se van a
  revertir las líneas y grupos (2026-10-23) o el V2 (2026-10-22), esta va ANTES que esas
  (vitrina_modelo_3d apunta a vitrina_presentacion).

  QUÉ HACE (idempotente):
    Borra la tabla vitrina_modelo_3d (con su índice, su llave foránea y sus CHECK).
  No toca el resto de la Vitrina ni el historial (las filas de vitrina_historial con
  entidad «modelo_3d» se conservan como rastro). Los archivos GLB NO se borran del
  almacenamiento de adjuntos: quedan en la carpeta VITRINA de OneDrive.

  PÉRDIDA DE DATOS: si ya hay modelos cargados, se pierde su registro (qué archivo es de qué
  presentación, versión, dimensiones). Por eso se NIEGA salvo que la sesión declare la bandera:
    EXEC sp_set_session_context N'vitrina_modelo3d_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51624, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.vitrina_modelo_3d', N'U') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.vitrina_modelo_3d) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'vitrina_modelo3d_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51625, N'Hay modelos 3D cargados. Para aceptar la pérdida de su registro: EXEC sp_set_session_context N''vitrina_modelo3d_reversa_acepta_perdida'', 1;', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.vitrina_modelo_3d', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_modelo_3d];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COUNT(*) AS tablas_modelo_3d_restantes FROM sys.tables WHERE name = N'vitrina_modelo_3d';
