/*
  Seed de PERMISOS del modulo "Asistente de Pagos" (idempotente, APPEND-ONLY).
  SQL Server (provider sqlserver). NO contiene DROP/ALTER/TRUNCATE.

  Que hace:
    1. Garantiza un Process contenedor llamado 'Tesoreria' (process_url NULL).
       Si ya existe uno con ese nombre lo reutiliza; si no, lo crea.
    2. Crea el subproceso 'Asistente de Pagos' con subprocess_url
       '/process/payment-assistant' bajo ese proceso (si no existe).
    3. Otorga acceso al subproceso a Nicolas (nicolas.rivera@gsslatam.com) en
       CADA empresa donde tenga company_user. Solo inserta las filas que falten.

  Con solo crear la fila 'subprocess' el modulo ya aparece como ASIGNABLE en
  Administracion -> Usuarios (GET /api/subprocesses lista todas las filas), y con
  el grant a Nicolas el proceso 'Tesoreria' aparece en su menu (GET /api/processes
  muestra los process que tienen algun subprocess asignado al usuario).
*/

DECLARE @AdminEmail NVARCHAR(255) = 'nicolas.rivera@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = 'Tesoreria';
DECLARE @SubName NVARCHAR(255) = 'Asistente de Pagos';
DECLARE @SubUrl NVARCHAR(255) = '/process/payment-assistant';

/* 1) Process contenedor 'Tesoreria' (process_url NULL). Reusa el primero con
      ese nombre, o lo crea. */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process, process_url) VALUES (@ProcessName, NULL);
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

/* 3) Otorgar acceso a Nicolas en cada empresa donde tenga company_user.
      Solo inserta las filas faltantes (idempotente). */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE u.email = @AdminEmail
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

/* Diagnostico: que quedo otorgado. */
SELECT u.email, c.company, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
