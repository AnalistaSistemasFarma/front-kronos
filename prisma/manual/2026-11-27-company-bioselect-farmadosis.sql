/*
  Adds the companies BIOSELECT and FARMADOSIS to dbo.company (requested by
  Cristian Baldion for the Dashboard TI, 2026-11-27).

  IMPORTANT: dbo.company is shared by all of SynerLink (users, tickets, chat,
  projects, SAP endpoints...). New rows appear in every company list. In
  production run it only with the explicit OK of Cristian Baldion or Nicolas
  Rivera.

  - Checks the database before any change (@expected_db).
  - Idempotent (by name).
  - One batch, one transaction: COMMIT only if exactly one row per company
    exists afterwards, otherwise ROLLBACK + THROW.

  PRUEBAS: applied in KRONOSDB_PRUEBAS on 2026-11-27 (ids 13 and 14).
  PRODUCTION: change @expected_db to N'KRONOSDB'; run by the authorized operator.
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

SELECT N'BEFORE' AS moment, COUNT(*) AS companies FROM dbo.company;

BEGIN TRY
  BEGIN TRAN;

  INSERT INTO dbo.company (company)
  SELECT v.name
  FROM (VALUES (N'BIOSELECT'), (N'FARMADOSIS')) v(name)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.company c WHERE UPPER(LTRIM(RTRIM(c.company))) = v.name);

  IF (SELECT COUNT(*) FROM dbo.company WHERE UPPER(LTRIM(RTRIM(company))) IN (N'BIOSELECT', N'FARMADOSIS')) <> 2
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: expected exactly one BIOSELECT and one FARMADOSIS. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, id_company, company
FROM dbo.company
WHERE UPPER(LTRIM(RTRIM(company))) IN (N'BIOSELECT', N'FARMADOSIS');

/* ---------------------------------------------------------------------------
   ROLLBACK - only while nothing references them (assets, users, tickets...).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DELETE FROM dbo.company WHERE company IN (N'BIOSELECT', N'FARMADOSIS');
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
