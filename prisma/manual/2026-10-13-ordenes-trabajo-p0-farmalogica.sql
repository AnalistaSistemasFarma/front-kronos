/*
  PASE MANUAL — Órdenes de Trabajo (P0): permisos y catálogo inicial de Farmalógica.
  Pedido de Nicolás Rivera, 2026-10-13 («hagamos un plan y montemos en testing y prod»).

  PRERREQUISITO: la migración 20261013180000_ordenes_trabajo_p0 ya aplicada
  (tablas ot_*). Si no, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente, SOLO INSERCIÓN, sin DROP/ALTER/UPDATE):
    1. Proceso contenedor del menú: «Producción» (si no existe).
    2. Subprocesos-permiso (nombres y URLs iguales a lib/ordenes-trabajo/constants.ts):
         /process/ordenes-trabajo          Órdenes de Trabajo (entrada del menú; operario:
                                           ver órdenes y registrar en las que figura)
         /process/ordenes-trabajo/gestion  Órdenes de Trabajo: Gestión (marcador; supervisor:
                                           abrir, cerrar, registrar en cualquiera, catálogo)
    3. Catálogo inicial de Farmalógica (id_company = 1). Mientras llega la lista de
       Amanda Casiano: las 4 actividades que nombró en la reunión del 2026-10-13
       más «Otra» (observación obligatoria). Se editan después en la pantalla
       Catálogo (agregar, ordenar, desactivar).
    4. NO otorga permisos a nadie: se asignan después por Administración → Usuarios
       (o con un script aparte), a los usuarios que indiquen Nicolás y Amanda.

  GUARDA: solo corre en KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  REVERSA: prisma/manual/2026-10-13-ordenes-trabajo-p0-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51310, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL
  THROW 51311, N'Falta la migración 20261013180000_ordenes_trabajo_p0 (tablas ot_*).', 1;

DECLARE @IdCompany   INT           = 1;   -- FARMALOGICA S.A. (mismo id en KRONOSDB y KRONOSDB_PRUEBAS)
DECLARE @ProcessName NVARCHAR(255) = N'Producción';
DECLARE @Seed        NVARCHAR(50)  = N'seed-2026-10-13';

IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = @IdCompany)
  THROW 51312, N'No existe la empresa Farmalógica (id_company = 1).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url LIKE N'/process/ordenes-trabajo%';
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
    (N'Órdenes de Trabajo',          N'/process/ordenes-trabajo'),
    (N'Órdenes de Trabajo: Gestión', N'/process/ordenes-trabajo/gestion');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url
  FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  /* 3) Catálogo inicial de Farmalógica (idempotente por nombre) */
  DECLARE @Acts TABLE (nombre NVARCHAR(120), exige BIT, orden INT);
  INSERT INTO @Acts (nombre, exige, orden) VALUES
    (N'Alimentación de tolva (materia prima)', 0, 10),
    (N'Alimentación de tapones',               0, 20),
    (N'Intervención de mantenimiento',         0, 30),
    (N'Refrigerio',                            0, 40),
    (N'Otra',                                  1, 90);

  INSERT INTO [dbo].[ot_actividad] (id_company, nombre, exige_observacion, orden, activo, created_by)
  SELECT @IdCompany, a.nombre, a.exige, a.orden, 1, @Seed
  FROM @Acts a
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ot_actividad] t WHERE t.id_company = @IdCompany AND t.nombre = a.nombre);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/ordenes-trabajo%' ORDER BY s.subprocess_url;
SELECT DB_NAME() AS base, 'despues' AS momento, id_actividad, nombre, exige_observacion, orden, activo
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany ORDER BY orden, id_actividad;
