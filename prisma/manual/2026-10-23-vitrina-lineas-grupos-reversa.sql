/*
  REVERSA. Vitrina Comercial: líneas comerciales y grupos terapéuticos (2026-10-23). Deshace
  prisma/migrations/20261023120000_vitrina_lineas_grupos y 2026-10-23-vitrina-lineas-grupos-PRUEBAS/PROD.sql.

  ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. Si además se va a
  revertir el V2 (2026-10-22-vitrina-comercial-reversa.sql), esta va ANTES que esa.

  QUÉ HACE (idempotente):
    1. Quita la llave foránea, el índice y la columna vitrina_presentacion.id_linea.
    2. Quita la columna vitrina_codigo_sap.items_group_name (se vuelve a leer de SAP).
    3. Borra vitrina_presentacion_grupo, vitrina_grupo_terapeutico y vitrina_linea_comercial.
  No toca el resto de la Vitrina ni el historial.

  PÉRDIDA DE DATOS: si ya hay presentaciones con línea o grupos asignados, se pierden esas
  asignaciones. Por eso se NIEGA salvo que la sesión declare la bandera:
    EXEC sp_set_session_context N'vitrina_lineas_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51614, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.vitrina_presentacion_grupo', N'U') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.vitrina_presentacion_grupo) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') IS NOT NULL
  EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM dbo.vitrina_presentacion WHERE id_linea IS NOT NULL) SET @h = 1;', N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'vitrina_lineas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51615, N'Hay presentaciones con línea comercial o grupos terapéuticos. Para aceptar su pérdida: EXEC sp_set_session_context N''vitrina_lineas_reversa_acepta_perdida'', 1;', 1;

BEGIN TRY
BEGIN TRAN;

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'vitrina_presentacion_id_linea_fkey' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
  EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] DROP CONSTRAINT [vitrina_presentacion_id_linea_fkey]');
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_vitrina_presentacion_linea' AND object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
  EXEC(N'DROP INDEX [IX_vitrina_presentacion_linea] ON [dbo].[vitrina_presentacion]');
IF COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') IS NOT NULL
  EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] DROP COLUMN [id_linea]');
IF COL_LENGTH(N'dbo.vitrina_codigo_sap', N'items_group_name') IS NOT NULL
  EXEC(N'ALTER TABLE [dbo].[vitrina_codigo_sap] DROP COLUMN [items_group_name]');

IF OBJECT_ID(N'dbo.vitrina_presentacion_grupo', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_presentacion_grupo];
IF OBJECT_ID(N'dbo.vitrina_grupo_terapeutico', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_grupo_terapeutico];
IF OBJECT_ID(N'dbo.vitrina_linea_comercial', N'U') IS NOT NULL DROP TABLE [dbo].[vitrina_linea_comercial];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COUNT(*) AS tablas_lineas_grupos_restantes FROM sys.tables WHERE name IN (N'vitrina_linea_comercial', N'vitrina_grupo_terapeutico', N'vitrina_presentacion_grupo');
SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') AS id_linea, COL_LENGTH(N'dbo.vitrina_codigo_sap', N'items_group_name') AS items_group_name;
