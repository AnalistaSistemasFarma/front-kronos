/*
  Seed de PERMISOS del módulo "Métricas Service Layer" (idempotente,
  APPEND-ONLY). SQL Server (provider sqlserver). NO contiene DROP/ALTER/TRUNCATE.

  Qué hace:
    1. Garantiza un Process contenedor llamado 'Procesos' (reusa el mismo
       contenedor que Organigrama/Registros Sanitarios -- ver
       prisma/seeds/organigrama-permisos.sql).
    2. Crea el subproceso '/process/service-layer-metrics' bajo ese proceso
       (si no existe).
    3. Otorga acceso al subproceso a un usuario administrador, SOLO para la
       empresa ONELATAMPHARMA (id_company=3) -- a diferencia de Organigrama,
       este módulo NO es multiempresa: hoy solo existe data de OLP (ver
       ServiceLayerDailyMetric.company en schema.prisma). Solo inserta la
       fila que falte.

  Parámetros (ajuste el correo del admin antes de correr):
*/

DECLARE @AdminEmail NVARCHAR(255) = 'nicolas.rivera@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubName NVARCHAR(255) = 'Métricas Service Layer';
DECLARE @SubUrl NVARCHAR(255) = '/process/service-layer-metrics';
DECLARE @OlpCompanyId INT = 3; -- ONELATAMPHARMA, confirmado en [dbo].[company]

/* 1) Process contenedor (reusa el primero con ese nombre, o lo crea). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso dedicado del módulo (idempotente por subprocess_url). */
DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

/* 3) Otorgar acceso al admin SOLO en OLP (idempotente). */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND cu.id_company = @OlpCompanyId
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

/* Diagnóstico: qué quedó otorgado. */
SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
