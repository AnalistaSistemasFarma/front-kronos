/*
  Seed de PERMISOS del módulo Gestión Documental (idempotente, APPEND-ONLY).
  SQL Server (provider sqlserver). NO contiene DROP/ALTER/TRUNCATE.

  Mismo patrón que prisma/seeds/organigrama-permisos.sql y el módulo de
  Registros Sanitarios: dos subprocesos (lectura / escritura) bajo un
  proceso contenedor, otorgados por subprocess_user_company. NO se crea
  ninguna tabla de roles documentales nueva.

  Qué hace:
    1. Garantiza un Process contenedor llamado 'Procesos' (reusa el primero
       con ese nombre, o lo crea).
    2. Crea los subprocesos '/process/document-management' (lectura) y
       '/process/document-management/manage' (escritura) bajo ese proceso,
       si no existen.
    3. Otorga acceso de LECTURA y ESCRITURA al usuario administrador en
       TODAS las empresas a las que ya tiene company_user (para poder probar
       el módulo de una vez en todas las empresas). Solo inserta las filas
       que falten.

  Parámetros (ajuste el correo del admin antes de correr):
*/

DECLARE @AdminEmail NVARCHAR(255) = 'automatizacion@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubNameRead NVARCHAR(255) = 'Gestión Documental';
DECLARE @SubUrlRead NVARCHAR(255) = '/process/document-management';
DECLARE @SubNameWrite NVARCHAR(255) = 'Gestión Documental (gestionar)';
DECLARE @SubUrlWrite NVARCHAR(255) = '/process/document-management/manage';

/* 1) Process contenedor (reusa el primero con ese nombre, o lo crea). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subprocesos de lectura y escritura (idempotentes por subprocess_url). */
DECLARE @SubIdRead INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrlRead ORDER BY id_subprocess
);
IF @SubIdRead IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubNameRead, @ProcessId, @SubUrlRead);
  SET @SubIdRead = SCOPE_IDENTITY();
END

DECLARE @SubIdWrite INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrlWrite ORDER BY id_subprocess
);
IF @SubIdWrite IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubNameWrite, @ProcessId, @SubUrlWrite);
  SET @SubIdWrite = SCOPE_IDENTITY();
END

/* 3) Otorgar lectura + escritura al admin en cada empresa donde ya tiene
      company_user. Solo inserta las filas faltantes (idempotente). */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubIdRead, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubIdRead AND suc.id_company_user = cu.id_company_user
  );

INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubIdWrite, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubIdWrite AND suc.id_company_user = cu.id_company_user
  );

/* Diagnóstico: qué quedó otorgado. */
SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url IN (@SubUrlRead, @SubUrlWrite)
ORDER BY c.company, s.subprocess_url;
