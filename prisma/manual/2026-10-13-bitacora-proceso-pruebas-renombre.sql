/*
  SOLO PRUEBAS — renombre «Órdenes de Trabajo» → «Bitácora de Proceso» (2026-10-13).

  En KRONOSDB_PRUEBAS ya estaban los subprocesos y el catálogo inicial con los
  nombres viejos. En producción NO hace falta: allí el script
  2026-10-13-bitacora-proceso-p0-farmalogica.sql crea los nombres nuevos directamente.

  QUÉ HACE (idempotente):
    1. Cambia la URL y el nombre de los 2 subprocesos CONSERVANDO sus ids (en pruebas, 107 y 108),
       así los permisos ya otorgados siguen valiendo:
         /process/ordenes-trabajo          → /process/bitacora-proceso          «Bitácora de Proceso»
         /process/ordenes-trabajo/gestion  → /process/bitacora-proceso/gestion  «Bitácora de Proceso: Gestión»
    2. Retira el catálogo inicial VIEJO de Farmalógica (las 4 actividades de la reunión,
       sembradas por seed-2026-10-13; «Otra» se conserva porque sigue en la especificación):
         - si ningún registro la usa, se BORRA;
         - si algún registro la usa, se DESACTIVA (el historial conserva su nombre).
  Después corra 2026-10-13-bitacora-proceso-p0-farmalogica.sql para el catálogo nuevo.

  GUARDA: solo KRONOSDB_PRUEBAS.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51350, N'Este script solo corre en KRONOSDB_PRUEBAS.', 1;

DECLARE @IdCompany INT = 1;
DECLARE @Viejas TABLE (nombre NVARCHAR(120));
INSERT INTO @Viejas (nombre) VALUES
  (N'Alimentación de tolva (materia prima)'),
  (N'Alimentación de tapones'),
  (N'Intervención de mantenimiento'),
  (N'Refrigerio');

SELECT DB_NAME() AS base, 'antes' AS momento, id_subprocess, subprocess, subprocess_url
FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/ordenes-trabajo%' OR subprocess_url LIKE N'/process/bitacora-proceso%';

BEGIN TRY
  BEGIN TRANSACTION;

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/bitacora-proceso')
    UPDATE [dbo].[subprocess] SET subprocess_url = N'/process/bitacora-proceso', subprocess = N'Bitácora de Proceso'
    WHERE subprocess_url = N'/process/ordenes-trabajo';
  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/bitacora-proceso/gestion')
    UPDATE [dbo].[subprocess] SET subprocess_url = N'/process/bitacora-proceso/gestion', subprocess = N'Bitácora de Proceso: Gestión'
    WHERE subprocess_url = N'/process/ordenes-trabajo/gestion';

  DELETE t FROM [dbo].[ot_actividad] t
  JOIN @Viejas v ON v.nombre = t.nombre
  WHERE t.id_company = @IdCompany AND t.created_by = N'seed-2026-10-13'
    AND NOT EXISTS (SELECT 1 FROM [dbo].[ot_registro] r WHERE r.id_actividad = t.id_actividad);

  UPDATE t SET t.activo = 0
  FROM [dbo].[ot_actividad] t
  JOIN @Viejas v ON v.nombre = t.nombre
  WHERE t.id_company = @IdCompany AND t.created_by = N'seed-2026-10-13' AND t.activo = 1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, id_subprocess, subprocess, subprocess_url
FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/ordenes-trabajo%' OR subprocess_url LIKE N'/process/bitacora-proceso%';
SELECT DB_NAME() AS base, 'despues' AS momento, t.id_actividad, t.nombre, t.activo,
       (SELECT COUNT(*) FROM [dbo].[ot_registro] r WHERE r.id_actividad = t.id_actividad) AS registros
FROM [dbo].[ot_actividad] t WHERE t.id_company = @IdCompany ORDER BY t.id_actividad;
