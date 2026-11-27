/*
  Dashboard TI - column it_software.platform_email («Correo de registro en
  plataforma»). 2026-11-27. Run AFTER 2026-11-27-it-dashboard-software.sql.

  - Checks the database before any change (@expected_db).
  - Idempotent.
  - One transaction: COMMIT only if the column exists afterwards, otherwise
    ROLLBACK + THROW. Never leaves a transaction open.

  PRUEBAS: already applied in KRONOSDB_PRUEBAS on 2026-11-27.
  PRODUCTION: change @expected_db to N'KRONOSDB'; run by the authorized
  operator (Nicolas Rivera or Cristian Baldion). Rollback at the end.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @expected_db sysname = N'KRONOSDB_PRUEBAS';   -- production: N'KRONOSDB'
DECLARE @current_db sysname = DB_NAME();
IF @current_db <> @expected_db
BEGIN
  RAISERROR(N'Wrong database: %s (expected %s). Nothing was changed.', 16, 1, @current_db, @expected_db);
  RETURN;
END;
IF OBJECT_ID(N'dbo.it_software', N'U') IS NULL
BEGIN
  RAISERROR(N'Table it_software not found. Run 2026-11-27-it-dashboard-software.sql first. Nothing was changed.', 16, 1);
  RETURN;
END;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH(N'dbo.it_software', N'platform_email') IS NULL
    EXEC (N'ALTER TABLE dbo.it_software ADD platform_email nvarchar(254) NULL;');

  IF COL_LENGTH(N'dbo.it_software', N'platform_email') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: column platform_email was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.it_software', N'platform_email') AS platform_email;

/* ---------------------------------------------------------------------------
   ROLLBACK

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  ALTER TABLE dbo.it_software DROP COLUMN platform_email;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
