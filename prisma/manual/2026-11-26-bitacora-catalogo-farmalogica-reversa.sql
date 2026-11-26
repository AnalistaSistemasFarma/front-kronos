/*
  REVERSA (PROD o PRUEBAS) — Bitácora de Proceso, catálogo de Farmalógica (reunión con Natalia Velandia y Tatiana Rico, 2026-11-26).
  Devuelve los nombres anteriores y DESACTIVA los inspectores agregados por este script.
  QUÉ HACE (solo DATOS, sin cambios de esquema; IDEMPOTENTE; informa antes y después):
    1) Área «Envase y agrafado» → «Envase y grafado» (así dice el formato GMF-03-FR-003-16).
    2) Actividades activas con la misma forma de escribir: primera letra en mayúscula, el resto en
       minúscula (antes había nombres en MAYÚSCULAS). También «Ajuste de … mantenimiento» →
       «Ajuste de … por mantenimiento». Los registros ya hechos NO cambian (son inmutables).
    3) Seis inspectores de calidad en el maestro de personal (aparecen en el listado del turno; no
       firman): DEL SOL DILAN, VELA PAULA, ALVAREZ JUDY, ORTIZ DIANA, MERCADO KELLIS, MATEUS JEIDY.
  BLOQUEOS: transacción corta con LOCK_TIMEOUT 5000 y XACT_ABORT; si algo falla, ROLLBACK.
  
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS')
  THROW 51490, N'Base no esperada para este script.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.ot_area WHERE id_company = 1)
  THROW 51491, N'La empresa 1 (Farmalógica) no tiene la Bitácora de Proceso.', 1;

DECLARE @empresa INT = 1;
DECLARE @por NVARCHAR(50) = N'nicolas.rivera@gsslatam.com';
DECLARE @ren TABLE (de NVARCHAR(120) COLLATE Latin1_General_BIN2, a NVARCHAR(120));
INSERT INTO @ren (de, a) VALUES
    (N'Armado de equipo', N'Armado de Equipo'),
    (N'Entrega de turno', N'Entrega de Turno'),
    (N'Alimentación tapón', N'Alimentación Tapón'),
    (N'Alimentación agrafe', N'Alimentación Agrafe'),
    (N'Descargue autoclave', N'Descargue Autoclave'),
    (N'Monitoreos viables', N'Monitoreos Viables'),
    (N'Monitoreos no viables', N'Monitoreos no Viables'),
    (N'Cambio de formato', N'Cambio de Formato'),
    (N'Apertura de puerta grafado', N'Apertura de Puerta Grafado'),
    (N'Apertura puerta envasadora', N'Apertura Puerta Envasadora'),
    (N'Pruebas externas', N'PRUEBAS EXTERNAS'),
    (N'Despeje de envasadora', N'DESPEJE DE ENVASADORA'),
    (N'Despeje grafado', N'DESPEJE GRAFADO'),
    (N'Limpieza grafadora', N'LIMPIEZA GRAFADORA'),
    (N'Limpieza de envasadora', N'LIMPIEZA DE ENVASADORA'),
    (N'Ajuste de grafadora por operario', N'AJUSTE  GRAFADORA POR OPERARIO'),
    (N'Ajuste de envasadora por operario', N'AJUSTE DE ENVASADORA POR OPERARIO'),
    (N'Área en espera', N'AREA EN ESPERA'),
    (N'Ajuste de grafadora por mantenimiento', N'Ajuste de grafadora mantenimiento'),
    (N'Ajuste de envasadora por mantenimiento', N'Ajuste de envasadora mantenimiento');

SELECT 'antes' AS momento, id_area, nombre FROM dbo.ot_area WHERE id_company = @empresa;
SELECT 'antes' AS momento, a.id_actividad, a.nombre FROM dbo.ot_actividad a JOIN @ren r ON a.nombre COLLATE Latin1_General_BIN2 = r.de WHERE a.id_company = @empresa;

BEGIN TRY
  BEGIN TRANSACTION;
  -- 1) Área: el formato del batch record dice «Envase y grafado». Las bitácoras guardan su copia
  --    (no se edita); la pantalla y el Excel muestran el nombre actual del catálogo.
  UPDATE dbo.ot_area SET nombre = N'Envase y agrafado' WHERE id_company = @empresa AND nombre COLLATE Latin1_General_BIN2 = N'Envase y grafado';
  -- 2) Actividades: misma forma de escribir (primera letra en mayúscula). Los registros ya hechos
  --    conservan el nombre con el que se registraron (son inmutables).
  UPDATE a SET a.nombre = r.a
  FROM dbo.ot_actividad a JOIN @ren r ON a.nombre COLLATE Latin1_General_BIN2 = r.de
  WHERE a.id_company = @empresa;
  -- 3) Inspectores: los operarios no se borran (trigger), se DESACTIVAN.
  UPDATE dbo.ot_operador SET activo = 0, updated_by = @por, updated_at = SYSUTCDATETIME()
  WHERE id_company = @empresa AND created_by = @por AND nombre IN (N'DEL SOL DILAN', N'VELA PAULA', N'ALVAREZ JUDY', N'ORTIZ DIANA', N'MERCADO KELLIS', N'MATEUS JEIDY')
    AND created_at >= '2026-11-26';
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT 'después' AS momento, id_area, nombre FROM dbo.ot_area WHERE id_company = @empresa;
SELECT 'después' AS momento, id_actividad, nombre, activo FROM dbo.ot_actividad WHERE id_company = @empresa AND activo = 1 ORDER BY orden, nombre;
SELECT 'después' AS momento, id_operador, nombre, activo FROM dbo.ot_operador WHERE id_company = @empresa AND nombre IN (N'DEL SOL DILAN', N'VELA PAULA', N'ALVAREZ JUDY', N'ORTIZ DIANA', N'MERCADO KELLIS', N'MATEUS JEIDY');
