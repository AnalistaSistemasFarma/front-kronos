/*
  Seed de PERMISOS para Dashboard Solicitante y Dashboard Solicitado
  (idempotente, APPEND-ONLY). SQL Server.

  Que hace:
    1. Reutiliza el proceso 'Solicitudes' (o lo crea si no existe).
    2. Crea dos subprocesos:
         - Dashboard Solicitante -> /process/request-general/dashboard-solicitante
         - Dashboard Solicitado  -> /process/request-general/dashboard-solicitado
    3. Otorga ambos subprocesos a un usuario admin de prueba en CADA empresa
       donde ya tenga company_user. Solo inserta filas faltantes.

  Ajuste @AdminEmail antes de ejecutar.
*/

DECLARE @AdminEmail NVARCHAR(255) = 'automatizacion@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = N'Solicitudes';

DECLARE @SubSolicitanteName NVARCHAR(255) = N'Dashboard Solicitante';
DECLARE @SubSolicitanteUrl NVARCHAR(255) = N'/process/request-general/dashboard-solicitante';

DECLARE @SubSolicitadoName NVARCHAR(255) = N'Dashboard Solicitado';
DECLARE @SubSolicitadoUrl NVARCHAR(255) = N'/process/request-general/dashboard-solicitado';

/* 1) Process contenedor */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process
  FROM [dbo].[process]
  WHERE process = @ProcessName
  ORDER BY id_process
);

IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso Dashboard Solicitante */
DECLARE @SubSolicitanteId INT = (
  SELECT TOP 1 id_subprocess
  FROM [dbo].[subprocess]
  WHERE subprocess_url = @SubSolicitanteUrl
  ORDER BY id_subprocess
);

IF @SubSolicitanteId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubSolicitanteName, @ProcessId, @SubSolicitanteUrl);
  SET @SubSolicitanteId = SCOPE_IDENTITY();
END
ELSE
BEGIN
  UPDATE [dbo].[subprocess]
  SET subprocess = @SubSolicitanteName, id_process = @ProcessId
  WHERE id_subprocess = @SubSolicitanteId;
END

/* 3) Subproceso Dashboard Solicitado */
DECLARE @SubSolicitadoId INT = (
  SELECT TOP 1 id_subprocess
  FROM [dbo].[subprocess]
  WHERE subprocess_url = @SubSolicitadoUrl
  ORDER BY id_subprocess
);

IF @SubSolicitadoId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubSolicitadoName, @ProcessId, @SubSolicitadoUrl);
  SET @SubSolicitadoId = SCOPE_IDENTITY();
END
ELSE
BEGIN
  UPDATE [dbo].[subprocess]
  SET subprocess = @SubSolicitadoName, id_process = @ProcessId
  WHERE id_subprocess = @SubSolicitadoId;
END

/* 4) Otorgar al admin en cada empresa donde ya tenga company_user */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubSolicitanteId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@AdminEmail)))
  AND NOT EXISTS (
    SELECT 1
    FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubSolicitanteId
      AND suc.id_company_user = cu.id_company_user
  );

INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubSolicitadoId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@AdminEmail)))
  AND NOT EXISTS (
    SELECT 1
    FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubSolicitadoId
      AND suc.id_company_user = cu.id_company_user
  );

/* Diagnóstico */
SELECT
  u.email,
  c.company,
  s.subprocess,
  s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url IN (@SubSolicitanteUrl, @SubSolicitadoUrl)
ORDER BY s.subprocess, c.company;
