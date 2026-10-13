/*
  PASE MANUAL — Bitácora de Proceso (P0; nació como «Órdenes de Trabajo»):
  permisos y catálogo inicial de Farmalógica.
  Pedido de Nicolás Rivera, 2026-10-13. Catálogo según la especificación oficial
  «Bitácora de Proceso Plantas Farmalógica» (Amanda Casiano, 2026-10-13).

  PRERREQUISITOS (en este orden):
    1. prisma/migrations/20261013180000_ordenes_trabajo_p0            (tablas ot_*)
    2. prisma/migrations/20261013220000_bitacora_proceso_inspector_iconos (inspector e ícono)
  Si falta alguna, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente; inserta, y solo completa el ícono VACÍO de filas del mismo nombre):
    1. Proceso contenedor del menú: «Producción» (si no existe).
    2. Subprocesos-permiso (iguales a lib/bitacora-proceso/constants.ts):
         /process/bitacora-proceso          Bitácora de Proceso (entrada del menú; auxiliar e
                                            inspector: ver y registrar en las que figuran)
         /process/bitacora-proceso/gestion  Bitácora de Proceso: Gestión (marcador; supervisor:
                                            abrir, cerrar, registrar en cualquiera, catálogo)
    3. Catálogo de Farmalógica (id_company = 1): 13 intervenciones de la especificación
       («Descargue autoclave» venía repetido) + «Otra» (observación obligatoria). Las 3
       alimentaciones usan los pictogramas del documento (public/bitacora-proceso/); el resto,
       íconos de Tabler.
    4. NO otorga permisos a nadie.

  Las tablas conservan el prefijo ot_ (nombre interno).
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  REVERSA: prisma/manual/2026-10-13-bitacora-proceso-p0-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51310, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL
  THROW 51311, N'Falta la migración 20261013180000_ordenes_trabajo_p0 (tablas ot_*).', 1;
IF COL_LENGTH(N'dbo.ot_actividad', N'icono') IS NULL
  THROW 51313, N'Falta la migración 20261013220000_bitacora_proceso_inspector_iconos.', 1;

DECLARE @IdCompany   INT           = 1;   -- FARMALOGICA S.A. (mismo id en KRONOSDB y KRONOSDB_PRUEBAS)
DECLARE @ProcessName NVARCHAR(255) = N'Producción';
DECLARE @Seed        NVARCHAR(50)  = N'seed-2026-10-13';

IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = @IdCompany)
  THROW 51312, N'No existe la empresa Farmalógica (id_company = 1).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url LIKE N'/process/bitacora-proceso%' OR s.subprocess_url LIKE N'/process/ordenes-trabajo%';
SELECT DB_NAME() AS base, 'antes' AS momento, COUNT(*) AS actividades FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) Proceso contenedor */
  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  /* 2) Subprocesos (idempotentes por subprocess_url) */
  DECLARE @Subs TABLE (subprocess NVARCHAR(255), url NVARCHAR(255));
  INSERT INTO @Subs (subprocess, url) VALUES
    (N'Bitácora de Proceso',          N'/process/bitacora-proceso'),
    (N'Bitácora de Proceso: Gestión', N'/process/bitacora-proceso/gestion');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url
  FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  /* 3) Catálogo de Farmalógica (idempotente por nombre). Debe coincidir con OT_CATALOGO_FARMALOGICA. */
  DECLARE @Acts TABLE (nombre NVARCHAR(120), exige BIT, orden INT, icono NVARCHAR(40));
  INSERT INTO @Acts (nombre, exige, orden, icono) VALUES
    (N'Alimentación Tapón',                 0,  10, N'pictograma-tapon'),
    (N'Alimentación MPrima',                0,  20, N'pictograma-mprima'),
    (N'Alimentación Agrafe',                0,  30, N'pictograma-agrafe'),
    (N'Controles en proceso',               0,  40, N'control'),
    (N'Descargue Autoclave',                0,  50, N'autoclave'),
    (N'Descargue de UV',                    0,  60, N'uv'),
    (N'Pesaje de bidones',                  0,  70, N'pesaje'),
    (N'Monitoreos Viables',                 0,  80, N'viables'),
    (N'Monitoreos no Viables',              0,  90, N'no-viables'),
    (N'Ajuste de equipo Operario',          0, 100, N'ajuste-operario'),
    (N'Ajuste de equipo por Mantenimiento', 0, 110, N'ajuste-mantenimiento'),
    (N'Cambio de Formato',                  0, 120, N'formato'),
    (N'Refrigerio/almuerzo/cena',           0, 130, N'refrigerio'),
    (N'Otra',                               1, 990, N'otra');

  INSERT INTO [dbo].[ot_actividad] (id_company, nombre, exige_observacion, orden, activo, created_by, icono)
  SELECT @IdCompany, a.nombre, a.exige, a.orden, 1, @Seed, a.icono
  FROM @Acts a
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ot_actividad] t WHERE t.id_company = @IdCompany AND t.nombre = a.nombre);

  /* Completa el ícono solo donde está vacío (no pisa lo que Calidad haya cambiado). */
  UPDATE t SET t.icono = a.icono
  FROM [dbo].[ot_actividad] t JOIN @Acts a ON a.nombre = t.nombre
  WHERE t.id_company = @IdCompany AND t.icono IS NULL;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/bitacora-proceso%' ORDER BY s.subprocess_url;
SELECT DB_NAME() AS base, 'despues' AS momento, id_actividad, nombre, exige_observacion, orden, activo, icono
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany ORDER BY activo DESC, orden, id_actividad;
