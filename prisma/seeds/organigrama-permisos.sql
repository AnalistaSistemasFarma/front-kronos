/*
  Seed de PERMISOS del modulo Organigrama (idempotente, APPEND-ONLY).
  SQL Server (provider sqlserver). NO contiene DROP/ALTER/TRUNCATE.

  Que hace:
    1. Garantiza un Process contenedor llamado 'Procesos' (si ya existe uno con
       ese nombre lo reutiliza; si no, lo crea). Puede ajustar @ProcessName si
       en su entorno el proceso de los modulos internos tiene otro nombre.
    2. Crea el subproceso '/process/organigrama' bajo ese proceso (si no existe).
    3. Otorga acceso al subproceso a un usuario administrador, en CADA empresa
       que tenga jerarquia cargada (cargo_jerarquia) y para la cual el usuario
       tenga company_user. Solo inserta las filas que falten.

  Parametros (ajuste el correo del admin antes de correr):
*/

DECLARE @AdminEmail NVARCHAR(255) = 'automatizacion@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubName NVARCHAR(255) = 'Organigrama';
DECLARE @SubUrl NVARCHAR(255) = '/process/organigrama';

/* 1) Process contenedor (reusa el primero con ese nombre, o lo crea). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso dedicado del modulo (idempotente por subprocess_url). */
DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

/* 3) Otorgar acceso al admin en cada empresa con jerarquia cargada.
      Solo inserta las filas faltantes (idempotente). */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND EXISTS (SELECT 1 FROM [dbo].[cargo_jerarquia] cj WHERE cj.id_company = cu.id_company)
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

/* Diagnostico: que quedo otorgado. */
SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
