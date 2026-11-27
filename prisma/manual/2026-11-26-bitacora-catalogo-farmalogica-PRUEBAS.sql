/*
  PRUEBAS (KRONOSDB_PRUEBAS) — Bitácora de Proceso, catálogo de Farmalógica (reunión con Natalia Velandia y Tatiana Rico, 2026-11-26).
  Se puede correr en pruebas sin autorización adicional.
  QUÉ HACE (solo DATOS, sin cambios de esquema; IDEMPOTENTE; informa antes y después):
    1) Área «Envase y agrafado» → «Envase y grafado» (así dice el formato GMF-03-FR-003-16).
    2) Actividades activas con la misma forma de escribir: primera letra en mayúscula, el resto en
       minúscula (antes había nombres en MAYÚSCULAS). También «Ajuste de … mantenimiento» →
       «Ajuste de … por mantenimiento». Los registros ya hechos NO cambian (son inmutables).
    3) Seis inspectores de calidad en el maestro de personal (aparecen en el listado del turno; no
       firman): DEL SOL DILAN, VELA PAULA, ALVAREZ JUDY, ORTIZ DIANA, MERCADO KELLIS, MATEUS JEIDY.
  BLOQUEOS: transacción corta con LOCK_TIMEOUT 5000 y XACT_ABORT; si algo falla, ROLLBACK.
  REVERSA: prisma/manual/2026-11-26-bitacora-catalogo-farmalogica-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS')
  THROW 51490, N'Base no esperada para este script.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.ot_area WHERE id_company = 1)
  THROW 51491, N'La empresa 1 (Farmalógica) no tiene la Bitácora de Proceso.', 1;

DECLARE @empresa INT = 1;
DECLARE @por NVARCHAR(50) = N'nicolas.rivera@gsslatam.com';
DECLARE @ren TABLE (de NVARCHAR(120) COLLATE Latin1_General_BIN2, a NVARCHAR(120));
INSERT INTO @ren (de, a) VALUES
    (N'Armado de Equipo', N'Armado de equipo'),
    (N'Entrega de Turno', N'Entrega de turno'),
    (N'Alimentación Tapón', N'Alimentación tapón'),
    (N'Alimentación Agrafe', N'Alimentación agrafe'),
    (N'Descargue Autoclave', N'Descargue autoclave'),
    (N'Monitoreos Viables', N'Monitoreos viables'),
    (N'Monitoreos no Viables', N'Monitoreos no viables'),
    (N'Cambio de Formato', N'Cambio de formato'),
    (N'Apertura de Puerta Grafado', N'Apertura de puerta grafado'),
    (N'Apertura Puerta Envasadora', N'Apertura puerta envasadora'),
    (N'PRUEBAS EXTERNAS', N'Pruebas externas'),
    (N'DESPEJE DE ENVASADORA', N'Despeje de envasadora'),
    (N'DESPEJE GRAFADO', N'Despeje grafado'),
    (N'LIMPIEZA GRAFADORA', N'Limpieza grafadora'),
    (N'LIMPIEZA DE ENVASADORA', N'Limpieza de envasadora'),
    (N'AJUSTE  GRAFADORA POR OPERARIO', N'Ajuste de grafadora por operario'),
    (N'AJUSTE DE ENVASADORA POR OPERARIO', N'Ajuste de envasadora por operario'),
    (N'AREA EN ESPERA', N'Área en espera'),
    (N'Ajuste de grafadora mantenimiento', N'Ajuste de grafadora por mantenimiento'),
    (N'Ajuste de envasadora mantenimiento', N'Ajuste de envasadora por mantenimiento');

SELECT 'antes' AS momento, id_area, nombre FROM dbo.ot_area WHERE id_company = @empresa;
SELECT 'antes' AS momento, a.id_actividad, a.nombre FROM dbo.ot_actividad a JOIN @ren r ON a.nombre COLLATE Latin1_General_BIN2 = r.de WHERE a.id_company = @empresa;

BEGIN TRY
  BEGIN TRANSACTION;
  -- 1) Área: el formato del batch record dice «Envase y grafado». Las bitácoras guardan su copia
  --    (no se edita); la pantalla y el Excel muestran el nombre actual del catálogo.
  UPDATE dbo.ot_area SET nombre = N'Envase y grafado' WHERE id_company = @empresa AND nombre COLLATE Latin1_General_BIN2 = N'Envase y agrafado';
  -- 2) Actividades: misma forma de escribir (primera letra en mayúscula). Los registros ya hechos
  --    conservan el nombre con el que se registraron (son inmutables).
  UPDATE a SET a.nombre = r.a
  FROM dbo.ot_actividad a JOIN @ren r ON a.nombre COLLATE Latin1_General_BIN2 = r.de
  WHERE a.id_company = @empresa;
  -- 3) Inspectores de calidad en el maestro de personal (participan en el turno; no firman).
  INSERT INTO dbo.ot_operador (id_company, nombre, activo, created_by)
  SELECT @empresa, v.nombre, 1, @por
  FROM (VALUES
    (N'DEL SOL DILAN'),
    (N'VELA PAULA'),
    (N'ALVAREZ JUDY'),
    (N'ORTIZ DIANA'),
    (N'MERCADO KELLIS'),
    (N'MATEUS JEIDY')) AS v(nombre)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.ot_operador o WHERE o.id_company = @empresa AND o.nombre = v.nombre);
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT 'después' AS momento, id_area, nombre FROM dbo.ot_area WHERE id_company = @empresa;
SELECT 'después' AS momento, id_actividad, nombre, activo FROM dbo.ot_actividad WHERE id_company = @empresa AND activo = 1 ORDER BY orden, nombre;
SELECT 'después' AS momento, id_operador, nombre, activo FROM dbo.ot_operador WHERE id_company = @empresa AND nombre IN (N'DEL SOL DILAN', N'VELA PAULA', N'ALVAREZ JUDY', N'ORTIZ DIANA', N'MERCADO KELLIS', N'MATEUS JEIDY');
