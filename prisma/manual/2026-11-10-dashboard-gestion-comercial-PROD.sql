/*
  Permiso del «Dashboard de gestión comercial» — PRODUCCIÓN (KRONOSDB). SQL Server.
  Idempotente y solo agrega (no borra ni modifica permisos existentes).

  Qué hace:
    1. Busca o crea el proceso contenedor «Dashboards» (process_url NULL, como los
       módulos contenedores; el icono del hub lo resuelve processVisuals por nombre).
    2. Crea el subproceso «Dashboard de gestión comercial»
         subprocess_url = '/process/dashboards/gestion-comercial'
       solo si no existe (si existe, solo lo reubica bajo «Dashboards»).
    3. NO asigna usuarios: el administrador lo otorga por usuario y empresa en
       Administración → Usuarios (queda en subprocess_user_company).
       No requiere categoría: los subprocesos no tienen categoría propia.

  Ejecutar en un batch con XACT_ABORT ON y LOCK_TIMEOUT. Reversa:
  2026-11-10-dashboard-gestion-comercial-reversa.sql
*/
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @ProcessName NVARCHAR(255) = N'Dashboards';
DECLARE @SubName NVARCHAR(255) = N'Dashboard de gestión comercial';
DECLARE @SubUrl NVARCHAR(255) = N'/process/dashboards/gestion-comercial';

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

/* Diagnóstico */
SELECT p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @SubUrl;

/*
  Opcional (solo con autorización): otorgar a una persona en una empresa.
  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT s.id_subprocess, cu.id_company_user
  FROM [dbo].[subprocess] s
  CROSS JOIN [dbo].[company_user] cu
  JOIN [dbo].[user] u ON u.id = cu.id_user
  WHERE s.subprocess_url = N'/process/dashboards/gestion-comercial'
    AND LOWER(u.email) = 'neider.navarrete@onelatampharma.com' AND cu.id_company IN (3)
    AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess_user_company] x
                    WHERE x.id_subprocess = s.id_subprocess AND x.id_company_user = cu.id_company_user);
*/
