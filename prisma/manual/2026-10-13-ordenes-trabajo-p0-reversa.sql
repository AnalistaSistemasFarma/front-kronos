/*
  REVERSA — Órdenes de Trabajo (P0). Deshace la migración
  20261013180000_ordenes_trabajo_p0 y el script 2026-10-13-ordenes-trabajo-p0-farmalogica.sql:
    - quita los permisos otorgados (subprocess_user_company) de los 2 subprocesos,
    - borra los 2 subprocesos y el proceso «Producción» si quedó vacío,
    - borra los triggers y las 4 tablas ot_* (con sus datos).

  PÉRDIDA DE DATOS: si ya hay órdenes de trabajo, el script se DETIENE salvo que la
  sesión declare que acepta perderlas (los registros son soporte de calidad):
      EXEC sp_set_session_context N'ot_reversa_acepta_perdida', 1;
  Antes de eso, respalde las tablas ot_* (o la base completa).

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51320, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* SQL dinámico: SQL Server no garantiza el corto circuito del AND, y si la tabla ya no existe
   (segunda corrida) un SELECT directo fallaría con «Invalid object name». */
DECLARE @HayOrdenes BIT = 0;
IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[ot_orden_trabajo]) THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayOrdenes OUTPUT;
IF @HayOrdenes = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'ot_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51321, N'Hay órdenes de trabajo registradas. Respalde ot_* y declare ot_reversa_acepta_perdida = 1 para continuar.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name LIKE N'ot[_]%' OR name LIKE N'TR[_]ot[_]%' ORDER BY name;

BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url IN (N'/process/ordenes-trabajo', N'/process/ordenes-trabajo/gestion');

  DECLARE @ProcessIds TABLE (id_process INT);
  INSERT INTO @ProcessIds (id_process)
  SELECT DISTINCT id_process FROM [dbo].[subprocess]
  WHERE subprocess_url IN (N'/process/ordenes-trabajo', N'/process/ordenes-trabajo/gestion');

  DELETE FROM [dbo].[subprocess]
  WHERE subprocess_url IN (N'/process/ordenes-trabajo', N'/process/ordenes-trabajo/gestion');

  DELETE p FROM [dbo].[process] p
  JOIN @ProcessIds x ON x.id_process = p.id_process
  WHERE p.process = N'Producción'
    AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.id_process = p.id_process);

  IF OBJECT_ID(N'dbo.TR_ot_registro_inmutable', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_registro_inmutable];
  IF OBJECT_ID(N'dbo.TR_ot_orden_operario_inmutable', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_orden_operario_inmutable];
  IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_sin_borrar', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_orden_trabajo_sin_borrar];
  IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_cerrada', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada];

  IF OBJECT_ID(N'dbo.ot_registro', N'U') IS NOT NULL DROP TABLE [dbo].[ot_registro];
  IF OBJECT_ID(N'dbo.ot_orden_operario', N'U') IS NOT NULL DROP TABLE [dbo].[ot_orden_operario];
  IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NOT NULL DROP TABLE [dbo].[ot_orden_trabajo];
  IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NOT NULL DROP TABLE [dbo].[ot_actividad];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name LIKE N'ot[_]%' OR name LIKE N'TR[_]ot[_]%' ORDER BY name;
SELECT DB_NAME() AS base, 'despues' AS momento, COUNT(*) AS subprocesos
FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/ordenes-trabajo%';
