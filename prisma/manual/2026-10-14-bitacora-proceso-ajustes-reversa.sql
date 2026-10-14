/*
  REVERSA — Bitácora de Proceso, ajustes del 2026-10-14. Deshace:
    - prisma/migrations/20261014140000_bitacora_proceso_operadores_areas
      (tablas ot_operador, ot_area, ot_orden_operador; columnas ot_registro.id_operador,
      ot_registro.operador_nombre y ot_orden_trabajo.id_area; sus FK y triggers);
    - prisma/manual/2026-10-14-bitacora-proceso-ajustes-farmalogica.sql: el área y las
      actividades sembradas por el script (created_by = 'seed-2026-10-14') que NO tengan
      registros. Lo que solo se reordenó o cambió de ícono, y exige_observacion, NO se
      revierte (no hay copia del valor anterior y no afecta los registros).

  PÉRDIDA DE DATOS: si ya hay operarios programados o registros con operario, el script se
  DETIENE salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'ot_ajustes_reversa_acepta_perdida', 1;
  Los registros NO se borran: solo pierden la columna del operario (respalde antes).
  ADVERTENCIA: después de esta reversa la aplicación de esta rama deja de funcionar; se usa
  junto con el regreso del código a la versión anterior.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51393, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.ot_orden_operador', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[ot_orden_operador]) THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 0 AND COL_LENGTH(N'dbo.ot_registro', N'id_operador') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[ot_registro] WHERE id_operador IS NOT NULL) THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'ot_ajustes_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51394, N'Hay bitácoras con operarios. Respalde ot_* y declare ot_ajustes_reversa_acepta_perdida = 1 para continuar.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name IN (N'ot_operador', N'ot_area', N'ot_orden_operador', N'TR_ot_operador_sin_borrar', N'TR_ot_area_sin_borrar', N'TR_ot_orden_operador_inmutable',
               N'ot_registro_id_operador_fkey', N'ot_orden_trabajo_id_area_fkey') ORDER BY name;

BEGIN TRY
  BEGIN TRANSACTION;

  /* Actividades sembradas sin registros (las que tienen registros se quedan: FK). */
  DELETE a FROM [dbo].[ot_actividad] a
  WHERE a.created_by = N'seed-2026-10-14'
    AND NOT EXISTS (SELECT 1 FROM [dbo].[ot_registro] r WHERE r.id_actividad = a.id_actividad);

  IF OBJECT_ID(N'dbo.ot_registro_id_operador_fkey', N'F') IS NOT NULL
    ALTER TABLE [dbo].[ot_registro] DROP CONSTRAINT [ot_registro_id_operador_fkey];
  IF OBJECT_ID(N'dbo.ot_orden_trabajo_id_area_fkey', N'F') IS NOT NULL
    ALTER TABLE [dbo].[ot_orden_trabajo] DROP CONSTRAINT [ot_orden_trabajo_id_area_fkey];

  IF OBJECT_ID(N'dbo.TR_ot_orden_operador_inmutable', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_orden_operador_inmutable];
  IF OBJECT_ID(N'dbo.TR_ot_operador_sin_borrar', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_operador_sin_borrar];
  IF OBJECT_ID(N'dbo.TR_ot_area_sin_borrar', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_area_sin_borrar];

  IF OBJECT_ID(N'dbo.ot_orden_operador', N'U') IS NOT NULL DROP TABLE [dbo].[ot_orden_operador];
  IF OBJECT_ID(N'dbo.ot_operador', N'U') IS NOT NULL DROP TABLE [dbo].[ot_operador];
  IF OBJECT_ID(N'dbo.ot_area', N'U') IS NOT NULL DROP TABLE [dbo].[ot_area];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Columnas: fuera de la transacción (ot_registro y ot_orden_trabajo tienen triggers de UPDATE,
   que no afectan a ALTER TABLE). */
IF COL_LENGTH(N'dbo.ot_registro', N'operador_nombre') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_registro] DROP COLUMN [operador_nombre]');
IF COL_LENGTH(N'dbo.ot_registro', N'id_operador') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_registro] DROP COLUMN [id_operador]');
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_area') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] DROP COLUMN [id_area]');

SELECT DB_NAME() AS base, 'despues' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name IN (N'ot_operador', N'ot_area', N'ot_orden_operador') ORDER BY name;
