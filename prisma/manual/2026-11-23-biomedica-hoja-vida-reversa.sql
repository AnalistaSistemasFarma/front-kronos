/*
  REVERSA — Ingeniería biomédica · hoja de vida y mantenimientos (2026-11-23). Deshace
  prisma/migrations/20261123150000_biomedica_hoja_vida y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita la tabla biomed_mantenimiento (con su disparador) y las columnas nuevas de
  biomed_equipo y biomed_registro. Si hay mantenimientos o datos en las columnas nuevas, se niega salvo con la
  bandera de sesión:
    EXEC sp_set_session_context N'biomedica_hoja_vida_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51594, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @mant INT = 0;
DECLARE @datos INT = 0;
IF OBJECT_ID(N'dbo.biomed_mantenimiento', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_mantenimiento]', N'@n INT OUTPUT', @n = @mant OUTPUT;
IF COL_LENGTH(N'dbo.biomed_equipo', N'periodicidad_mant_meses') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_equipo] WHERE fecha_ingreso IS NOT NULL OR vida_util_anios IS NOT NULL OR periodicidad_mant_meses IS NOT NULL', N'@n INT OUTPUT', @n = @datos OUTPUT;
IF COL_LENGTH(N'dbo.biomed_registro', N'id_biomed_equipo') IS NOT NULL
BEGIN
  DECLARE @reg INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_registro] WHERE id_biomed_equipo IS NOT NULL OR equipo_json IS NOT NULL', N'@n INT OUTPUT', @n = @reg OUTPUT;
  SET @datos = @datos + @reg;
END;
SELECT DB_NAME() AS base, 'antes' AS momento, @mant AS mantenimientos, @datos AS filas_con_datos_nuevos;

IF (@mant > 0 OR @datos > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'biomedica_hoja_vida_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51595, N'Hay mantenimientos o datos de hoja de vida: use la bandera biomedica_hoja_vida_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.biomed_mantenimiento_control', N'TR') IS NOT NULL DROP TRIGGER [dbo].[biomed_mantenimiento_control];
  IF OBJECT_ID(N'dbo.biomed_mantenimiento', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_mantenimiento];
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'biomed_registro_id_biomed_equipo_idx' AND object_id = OBJECT_ID(N'dbo.biomed_registro'))
    DROP INDEX [biomed_registro_id_biomed_equipo_idx] ON [dbo].[biomed_registro];
  IF COL_LENGTH(N'dbo.biomed_registro', N'equipo_json') IS NOT NULL ALTER TABLE [dbo].[biomed_registro] DROP COLUMN [equipo_json];
  IF COL_LENGTH(N'dbo.biomed_registro', N'id_biomed_equipo') IS NOT NULL ALTER TABLE [dbo].[biomed_registro] DROP COLUMN [id_biomed_equipo];
  IF OBJECT_ID(N'dbo.biomed_equipo_periodicidad_ck', N'C') IS NOT NULL ALTER TABLE [dbo].[biomed_equipo] DROP CONSTRAINT [biomed_equipo_periodicidad_ck];
  IF OBJECT_ID(N'dbo.biomed_equipo_vida_util_ck', N'C') IS NOT NULL ALTER TABLE [dbo].[biomed_equipo] DROP CONSTRAINT [biomed_equipo_vida_util_ck];
  IF COL_LENGTH(N'dbo.biomed_equipo', N'periodicidad_mant_meses') IS NOT NULL ALTER TABLE [dbo].[biomed_equipo] DROP COLUMN [periodicidad_mant_meses];
  IF COL_LENGTH(N'dbo.biomed_equipo', N'vida_util_anios') IS NOT NULL ALTER TABLE [dbo].[biomed_equipo] DROP COLUMN [vida_util_anios];
  IF COL_LENGTH(N'dbo.biomed_equipo', N'fecha_ingreso') IS NOT NULL ALTER TABLE [dbo].[biomed_equipo] DROP COLUMN [fecha_ingreso];
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, OBJECT_ID(N'dbo.biomed_mantenimiento', N'U') AS biomed_mantenimiento, COL_LENGTH(N'dbo.biomed_equipo', N'fecha_ingreso') AS fecha_ingreso;
