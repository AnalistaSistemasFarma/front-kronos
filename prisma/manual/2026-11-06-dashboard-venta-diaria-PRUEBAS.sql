/*
  Permiso del «Dashboard de venta diaria» — PRUEBAS (KRONOSDB_PRUEBAS). SQL Server.
  Idempotente y solo agrega (no borra ni modifica permisos existentes).

  Qué hace:
    1. Busca o crea el proceso contenedor «Dashboards» (process_url NULL, como los
       módulos contenedores; el icono del hub lo resuelve processVisuals por nombre).
    2. Crea el subproceso «Dashboard de venta diaria»
         subprocess_url = '/process/dashboards/venta-diaria'
       solo si no existe (si existe, solo lo reubica bajo «Dashboards»).
    3. En PRUEBAS otorga el permiso a nicolas.rivera@gsslatam.com en las empresas
       con Service Layer activo en pruebas (1 Farmalógica, 2 Ryan, 3 OLP). En
       producción el administrador lo otorga en Administración → Usuarios.
       No requiere categoría: los subprocesos no tienen categoría propia.

  Ejecutar en un batch con XACT_ABORT ON y LOCK_TIMEOUT. Reversa:
  2026-11-06-dashboard-venta-diaria-reversa.sql
*/
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @ProcessName NVARCHAR(255) = N'Dashboards';
DECLARE @SubName NVARCHAR(255) = N'Dashboard de venta diaria';
DECLARE @SubUrl NVARCHAR(255) = N'/process/dashboards/venta-diaria';

BEGIN TRANSACTION;

DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process, process_url) VALUES (@ProcessName, NULL);
  SET @ProcessId = SCOPE_IDENTITY();
END

DECLARE @SubId INT = (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END
ELSE
  UPDATE [dbo].[subprocess] SET subprocess = @SubName, id_process = @ProcessId WHERE id_subprocess = @SubId;

COMMIT TRANSACTION;

/* Otorgar a Nicolás Rivera en las empresas del piloto (solo filas faltantes) */
BEGIN TRANSACTION;
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE LOWER(LTRIM(RTRIM(u.email))) = 'nicolas.rivera@gsslatam.com'
  AND cu.id_company IN (1, 2, 3)
  AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess_user_company] x
                  WHERE x.id_subprocess = @SubId AND x.id_company_user = cu.id_company_user);
COMMIT TRANSACTION;

/* Diagnóstico */
SELECT p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @SubUrl;

SELECT suc.id_subprocess_user_company, u.email, cu.id_company, c.company
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE suc.id_subprocess = @SubId
ORDER BY cu.id_company;
