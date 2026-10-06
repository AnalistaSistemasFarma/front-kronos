/*
  Seed de PERMISOS del módulo "Monitor del sistema" (idempotente, APPEND-ONLY).
  SQL Server. NO contiene DROP/ALTER/TRUNCATE. Mismo patrón que service-layer-metrics-permisos.sql.

  Qué hace:
    1. Garantiza el Process contenedor 'Procesos'.
    2. Crea el subproceso '/process/system-metrics' (si no existe) -> queda disponible para
       asignarlo desde Administración → Usuarios, como cualquier otro subproceso.
    3. OPCIONAL: si @AdminEmail no es NULL, da acceso a esa persona en TODAS sus empresas (el
       monitor no depende de la empresa: mide el servidor y la base completos).

  Se corre UNA vez por base de datos (pruebas y producción tienen sus propias tablas de permisos).
*/

DECLARE @AdminEmail NVARCHAR(255) = NULL; -- p. ej. 'nombre@gsslatam.com', o NULL para asignar desde la pantalla
DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubName NVARCHAR(255) = 'Monitor del sistema';
DECLARE @SubUrl NVARCHAR(255) = '/process/system-metrics';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
