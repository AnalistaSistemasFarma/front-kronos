/*
  Rooms module (/process/salas) — permissions. 2026-11-17.

  Creates (if missing) the module's three subprocesses under the process
  @process_name (default «Administración»; created if it does not exist).
  Names are in Spanish because users see them in the menu.

    Salas                      /process/salas            view occupancy (menu entry)
    Salas - Reservar           /process/salas/reservar   book and cancel own bookings (marker, hidden in the hub)
    Salas - Administrador      /process/salas/admin      cancel other people's meetings (marker, hidden in the hub)

  It does NOT grant permissions to anyone: grant them per company in
  Administración → Usuarios (or with the OPTIONAL block at the end).

  - Checks the database before any change (@expected_db).
  - Idempotent: safe to run several times.
  - Before/after listing. Rollback at the end (commented).

  Run by the authorized operator (Nicolás Rivera or Cristian Baldión; in the
  production release, Orus with Nicolás's OK).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @expected_db sysname = N'KRONOSDB_PRUEBAS';   -- production: N'KRONOSDB'
DECLARE @process_name nvarchar(200) = N'Administración';

DECLARE @current_db sysname = DB_NAME();
IF @current_db <> @expected_db
BEGIN
  RAISERROR(N'Wrong database: %s (expected %s). Nothing was changed.', 16, 1, @current_db, @expected_db);
  RETURN;
END;

SELECT N'BEFORE' AS stage, s.id_subprocess, s.subprocess, s.subprocess_url, p.process
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/salas%';

BEGIN TRAN;

DECLARE @id_process int = (SELECT TOP 1 id_process FROM dbo.process WHERE process = @process_name ORDER BY id_process);
IF @id_process IS NULL
BEGIN
  INSERT INTO dbo.process (process) VALUES (@process_name);
  SET @id_process = SCOPE_IDENTITY();
END;

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas', @id_process, N'/process/salas');

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas/reservar')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas - Reservar', @id_process, N'/process/salas/reservar');

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas/admin')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas - Administrador', @id_process, N'/process/salas/admin');

COMMIT;

SELECT N'AFTER' AS stage, s.id_subprocess, s.subprocess, s.subprocess_url, p.process
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/salas%';

/* ---------------------------------------------------------------------------
   OPTIONAL — grant one level to a person in ALL their companies.
   Change the email and the level URL (/process/salas, /process/salas/reservar
   or /process/salas/admin). For «reservar» or «admin» also grant
   /process/salas, which is the menu entry. Run once per level.

DECLARE @email nvarchar(320) = N'person@gsslatam.com';
DECLARE @url nvarchar(200) = N'/process/salas';
INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
SELECT s.id_subprocess, cu.id_company_user
FROM dbo.[user] u
JOIN dbo.company_user cu ON cu.id_user = u.id
JOIN dbo.subprocess s ON s.subprocess_url = @url
WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(@email)
  AND NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company x
                  WHERE x.id_subprocess = s.id_subprocess AND x.id_company_user = cu.id_company_user);
--------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   ROLLBACK — removes granted permissions and the three subprocesses.
   (The parent process is not deleted: it may have other subprocesses.)

IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50000, N'Wrong database', 1;
BEGIN TRAN;
DELETE suc FROM dbo.subprocess_user_company suc
JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url IN (N'/process/salas', N'/process/salas/reservar', N'/process/salas/admin');
DELETE FROM dbo.subprocess
WHERE subprocess_url IN (N'/process/salas', N'/process/salas/reservar', N'/process/salas/admin');
COMMIT;
--------------------------------------------------------------------------- */
