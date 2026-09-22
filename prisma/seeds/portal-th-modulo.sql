/*
  Seed del MÓDULO "Portal de Talento Humano".

  Lo deja ASIGNABLE en el hub, igual que los demás módulos: el permiso ES un
  subproceso (`/process/portal-th`), y se otorga desde
  /process/administration/users como cualquier otro.

  Idempotente y APPEND-ONLY: sin DROP, sin ALTER, sin TRUNCATE. Se puede
  re-correr cuantas veces haga falta.

  Las empresas se resuelven por NOMBRE, nunca por id: los id_company NO
  coinciden entre KRONOSDB y KRONOSDB_PRUEBAS, y sembrar por id cuelga el
  permiso de la empresa equivocada.

  OJO: esto es solo para quien YA tiene usuario en SynerLink. Los colaboradores
  sin usuario entran por /portal con un código al correo, y para eso no hay
  nada que sembrar.
*/

SET NOCOUNT ON;

/* ================================================================== */
/* PARÁMETROS — lo único que se edita                                  */
/* ================================================================== */
DECLARE @ProcessName    NVARCHAR(255) = N'Talento Humano';
DECLARE @SubName        NVARCHAR(255) = N'Portal de Talento Humano';
DECLARE @SubUrl         NVARCHAR(255) = N'/process/portal-th';

/* A quién se le otorga de entrada, en cada empresa de abajo. */
DECLARE @Grants TABLE (email NVARCHAR(255) PRIMARY KEY);
INSERT INTO @Grants (email) VALUES
  (N'nicolas.rivera@gsslatam.com'),
  (N'cristian.baldion@gsslatam.com');

/* Empresas donde queda disponible. Por NOMBRE exacto. */
DECLARE @Companies TABLE (company NVARCHAR(255) PRIMARY KEY);
INSERT INTO @Companies (company) VALUES (N'GSS');

/* ================================================================== */
IF EXISTS (
  SELECT 1 FROM @Companies c
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[company] co WHERE co.company = c.company)
)
BEGIN
  SELECT c.company AS empresa_inexistente FROM @Companies c
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[company] co WHERE co.company = c.company);
  RAISERROR(N'Hay empresas de la lista que no existen en dbo.company.', 16, 1);
  RETURN;
END

/* 1) El Process contenedor. */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  /* process_url en NULL: el hub abre process_url en pestaña nueva, y aquí lo
     que se navega es el subproceso. */
  INSERT INTO [dbo].[process] (process, process_url) VALUES (@ProcessName, NULL);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) El subproceso = el permiso. */
DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

/* 3) company_user que falte (indispensable para que la empresa aparezca en
      Administración → Usuarios). */
INSERT INTO [dbo].[company_user] (id_company, id_user)
SELECT co.id_company, u.id
FROM @Grants g
JOIN [dbo].[user] u ON u.email = g.email
CROSS JOIN @Companies c
JOIN [dbo].[company] co ON co.company = c.company
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[company_user] cu
  WHERE cu.id_user = u.id AND cu.id_company = co.id_company
);

/* 4) El otorgamiento. */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM @Grants g
JOIN [dbo].[user] u ON u.email = g.email
CROSS JOIN @Companies c
JOIN [dbo].[company] co ON co.company = c.company
JOIN [dbo].[company_user] cu ON cu.id_user = u.id AND cu.id_company = co.id_company
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[subprocess_user_company] suc
  WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
);

/* Correos que no existen: se avisa, no se falla. */
SELECT g.email AS usuario_inexistente
FROM @Grants g
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[user] u WHERE u.email = g.email);

/* ── Diagnóstico ─────────────────────────────────────────────────── */
SELECT p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s
JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @SubUrl;

SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl
ORDER BY u.email;
