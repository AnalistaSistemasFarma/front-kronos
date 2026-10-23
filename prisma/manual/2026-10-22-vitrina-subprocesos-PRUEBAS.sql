/*
  PASE MANUAL (PRUEBAS) — Vitrina Comercial, sprint V2: subprocesos, áreas y tarea nocturna (2026-10-22).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  PRERREQUISITO: prisma/manual/2026-10-22-vitrina-comercial-PRUEBAS.sql (tablas vitrina_*).
  Si falta, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente; solo inserta lo que falta):
    1. Proceso contenedor del menú «Ventas» (id 4; se busca por nombre).
    2. Subprocesos-permiso (iguales a lib/vitrina/constants.ts):
         /process/vitrina          Vitrina Comercial            (comerciales; catálogo en construcción en el V2)
         /process/vitrina/gestion  Vitrina Comercial · Gestión  (administradores: bandeja, presentaciones,
                                                                  exclusividades, historial y lectura de SAP)
    3. Áreas asistenciales iniciales (lista cerrada; los administradores agregan o desactivan en Gestión).
    4. Tarea nocturna del programador central (scheduled_job, job_type «vitrina_sincronizar_sap»):
       todos los días a las 2:00 a. m. lee el SAP de Farmalógica (1) y de Ryan (2) en SOLO LECTURA.
       Para apagarla: UPDATE dbo.scheduled_job SET active = 0 WHERE job_type = N'vitrina_sincronizar_sap';
    5. NO otorga permisos a nadie. Los accesos se dan por Administración → Usuarios, POR EMPRESA
       (subprocess_user_company): Farmalógica (1) y Ryan (2). Administradores acordados (Nicolás, 22-oct):
       los administradores de SynerLink, ricardo.mendez@gsslatam.com y viviana.gaitan@farmalogica.com
       (a Viviana le falta la empresa Ryan).

  GUARDA: solo la base indicada (o la efímera de la CI).
  REVERSA: prisma/manual/2026-10-22-vitrina-comercial-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51603, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;
IF OBJECT_ID(N'dbo.vitrina_area', N'U') IS NULL OR OBJECT_ID(N'dbo.vitrina_codigo_sap', N'U') IS NULL
  THROW 51605, N'Faltan las tablas vitrina_*: corra antes 2026-10-22-vitrina-comercial-PRUEBAS.sql.', 1;

DECLARE @ProcessName NVARCHAR(255) = N'Ventas';
DECLARE @Actor       NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';

SELECT DB_NAME() AS base, 'antes' AS momento, s.id_subprocess, s.subprocess, s.id_process, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url LIKE N'/process/vitrina%';

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
    (N'Vitrina Comercial',            N'/process/vitrina'),
    (N'Vitrina Comercial · Gestión',  N'/process/vitrina/gestion');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url
  FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  /* 3) Áreas asistenciales iniciales (idempotentes por nombre) */
  DECLARE @Areas TABLE (nombre NVARCHAR(80), orden INT);
  INSERT INTO @Areas (nombre, orden) VALUES
    (N'UCI', 10), (N'Urgencias', 20), (N'Hospitalización', 30), (N'Oncología', 40), (N'Neonatal', 50);

  INSERT INTO [dbo].[vitrina_area] (nombre, activa, orden)
  SELECT a.nombre, 1, a.orden FROM @Areas a
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[vitrina_area] t WHERE t.nombre = a.nombre);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* 4) Tarea nocturna. Por SQL dinámico: si scheduled_job no existe (base de la CI), no se compila nada contra ella. */
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
BEGIN
  DECLARE @Next DATETIME = DATEADD(HOUR, 2, CAST(CAST(DATEADD(DAY, 1, GETDATE()) AS DATE) AS DATETIME));
  EXEC sp_executesql N'IF NOT EXISTS (SELECT 1 FROM [dbo].[scheduled_job] WHERE job_type = N''vitrina_sincronizar_sap'')
    INSERT INTO [dbo].[scheduled_job] (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
    VALUES (N''Vitrina Comercial · lectura nocturna de SAP (Farmalógica y Ryan)'', N''vitrina_sincronizar_sap'', N''{"companies":[1,2]}'', N''0 2 * * *'', @Next, 1, N''vitrina'', @Actor, GETDATE());',
    N'@Next DATETIME, @Actor NVARCHAR(255)', @Next = @Next, @Actor = @Actor;
END;

SELECT DB_NAME() AS base, 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/vitrina%' ORDER BY s.subprocess_url;
SELECT DB_NAME() AS base, id_area, nombre, activa, orden FROM [dbo].[vitrina_area] ORDER BY orden, id_area;
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT DB_NAME() AS base, name, job_type, cron_expression, next_run_date, active FROM [dbo].[scheduled_job] WHERE job_type = N''vitrina_sincronizar_sap'';';
