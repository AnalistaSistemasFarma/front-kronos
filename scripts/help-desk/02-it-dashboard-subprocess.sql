/*
  Dashboard TI (/process/help-desk/it-dashboard) - menu entry and access. 2026-11-26.

  1. Creates (if missing) the subprocess "Dashboard TI" under the process
     "Tecnologia" (the same card as Tickets, Activos and Dashboard Helpdesk).
  2. Grants it ONLY to the people in @grantees, in every company they belong to.
     Requested by Cristian Baldion (SynerLink project "Dashboard Infraestructura").
     More people can be added later in Administracion -> Usuarios.

  - Checks the database before any change (@expected_db).
  - Idempotent: it can run several times.
  - One transaction with automatic validation: COMMIT only if the subprocess
    exists exactly once and every grantee has it; otherwise ROLLBACK + THROW.
  - Counts before and after. Rollback script at the end (commented).

  PRUEBAS: KRONOSDB_PRUEBAS. PRODUCTION: change @expected_db to N'KRONOSDB';
  it is run by the authorized operator (Nicolas Rivera or Cristian Baldion).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @expected_db sysname = N'KRONOSDB_PRUEBAS';   -- production: N'KRONOSDB'
DECLARE @url nvarchar(200) = N'/process/help-desk/it-dashboard';
DECLARE @name nvarchar(200) = N'Dashboard TI';

DECLARE @current_db sysname = DB_NAME();
IF @current_db <> @expected_db
BEGIN
  RAISERROR(N'Wrong database: %s (expected %s). Nothing was changed.', 16, 1, @current_db, @expected_db);
  RETURN;
END;

DECLARE @grantees TABLE (email nvarchar(320) NOT NULL);
INSERT INTO @grantees (email) VALUES
  (N'cristian.baldion@gsslatam.com'),
  (N'nicolas.rivera@gsslatam.com');

SELECT N'BEFORE' AS moment, s.id_subprocess, s.subprocess, s.subprocess_url, p.process,
       (SELECT COUNT(*) FROM dbo.subprocess_user_company x WHERE x.id_subprocess = s.id_subprocess) AS grants
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url = @url;

DECLARE @id_process int = (
  SELECT TOP 1 s.id_process FROM dbo.subprocess s
  WHERE s.subprocess_url = N'/process/help-desk/assets'
  ORDER BY s.id_subprocess
);
IF @id_process IS NULL
  SET @id_process = (SELECT TOP 1 id_process FROM dbo.process WHERE process = N'Tecnologia' ORDER BY id_process);
IF @id_process IS NULL
BEGIN
  RAISERROR(N'Process "Tecnologia" not found. Nothing was changed.', 16, 1);
  RETURN;
END;

DECLARE @expected_grants int = (
  SELECT COUNT(*)
  FROM dbo.[user] u
  JOIN @grantees g ON LOWER(LTRIM(RTRIM(u.email))) = LOWER(g.email)
  JOIN dbo.company_user cu ON cu.id_user = u.id
);

BEGIN TRY
  BEGIN TRAN;

  IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = @url)
    INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (@name, @id_process, @url);

  DECLARE @id_subprocess int = (SELECT TOP 1 id_subprocess FROM dbo.subprocess WHERE subprocess_url = @url ORDER BY id_subprocess);

  INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
  SELECT @id_subprocess, cu.id_company_user
  FROM dbo.[user] u
  JOIN @grantees g ON LOWER(LTRIM(RTRIM(u.email))) = LOWER(g.email)
  JOIN dbo.company_user cu ON cu.id_user = u.id
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.subprocess_user_company x
    WHERE x.id_subprocess = @id_subprocess AND x.id_company_user = cu.id_company_user
  );

  -- Automatic validation: one subprocess, every grantee company_user granted.
  DECLARE @subprocesses int = (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url = @url);
  DECLARE @granted int = (
    SELECT COUNT(*)
    FROM dbo.subprocess_user_company x
    JOIN dbo.company_user cu ON cu.id_company_user = x.id_company_user
    JOIN dbo.[user] u ON u.id = cu.id_user
    JOIN @grantees g ON LOWER(LTRIM(RTRIM(u.email))) = LOWER(g.email)
    WHERE x.id_subprocess = @id_subprocess
  );

  IF @subprocesses <> 1 OR @granted <> @expected_grants OR @expected_grants = 0
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed (subprocess or grants count). Everything was rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, s.id_subprocess, s.subprocess, s.subprocess_url, p.process,
       (SELECT COUNT(*) FROM dbo.subprocess_user_company x WHERE x.id_subprocess = s.id_subprocess) AS grants
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url = @url;

SELECT N'GRANTED' AS moment, u.email, c.company
FROM dbo.subprocess_user_company x
JOIN dbo.subprocess s ON s.id_subprocess = x.id_subprocess
JOIN dbo.company_user cu ON cu.id_company_user = x.id_company_user
JOIN dbo.[user] u ON u.id = cu.id_user
JOIN dbo.company c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @url
ORDER BY u.email, c.company;

/* ---------------------------------------------------------------------------
   ROLLBACK - removes the grants and the subprocess (same rules: one batch,
   COMMIT or ROLLBACK in it).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
DECLARE @url nvarchar(200) = N'/process/help-desk/it-dashboard';
BEGIN TRY
  BEGIN TRAN;
  DELETE x FROM dbo.subprocess_user_company x
  JOIN dbo.subprocess s ON s.id_subprocess = x.id_subprocess
  WHERE s.subprocess_url = @url;
  DELETE FROM dbo.subprocess WHERE subprocess_url = @url;
  IF EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = @url)
  BEGIN
    ROLLBACK TRAN;
    THROW 50002, N'Rollback validation failed. Nothing was changed.', 1;
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
