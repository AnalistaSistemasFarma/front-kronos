/*
  Dashboard TI - Proveedores: several internet channels and telephone services
  per company (2026-11-27). Run AFTER 2026-11-26-it-dashboard-company-internet.sql
  and 2026-11-27-it-dashboard-telephony.sql.

  company_internet / company_telephony:
    - new IDENTITY column id as primary key (it was id_company);
    - index on id_company;
    - new column label (name shown on the button).
  Existing rows are kept (row counts are validated).

  - Checks the database before any change (@expected_db).
  - Idempotent.
  - One transaction: COMMIT only if the validation passes, otherwise
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
IF OBJECT_ID(N'dbo.company_internet', N'U') IS NULL OR OBJECT_ID(N'dbo.company_telephony', N'U') IS NULL
BEGIN
  RAISERROR(N'Run the company_internet and company_telephony scripts first. Nothing was changed.', 16, 1);
  RETURN;
END;

DECLARE @before_internet int = (SELECT COUNT(*) FROM dbo.company_internet);
DECLARE @before_telephony int = (SELECT COUNT(*) FROM dbo.company_telephony);

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH(N'dbo.company_internet', N'id') IS NULL
  BEGIN
    EXEC (N'ALTER TABLE dbo.company_internet DROP CONSTRAINT PK_company_internet;');
    EXEC (N'ALTER TABLE dbo.company_internet ADD id int IDENTITY(1,1) NOT NULL;');
    EXEC (N'ALTER TABLE dbo.company_internet ADD CONSTRAINT PK_company_internet PRIMARY KEY (id);');
    EXEC (N'CREATE INDEX IX_company_internet_company ON dbo.company_internet (id_company);');
  END;
  IF COL_LENGTH(N'dbo.company_internet', N'label') IS NULL
    EXEC (N'ALTER TABLE dbo.company_internet ADD label nvarchar(100) NULL;');

  IF COL_LENGTH(N'dbo.company_telephony', N'id') IS NULL
  BEGIN
    EXEC (N'ALTER TABLE dbo.company_telephony DROP CONSTRAINT PK_company_telephony;');
    EXEC (N'ALTER TABLE dbo.company_telephony ADD id int IDENTITY(1,1) NOT NULL;');
    EXEC (N'ALTER TABLE dbo.company_telephony ADD CONSTRAINT PK_company_telephony PRIMARY KEY (id);');
    EXEC (N'CREATE INDEX IX_company_telephony_company ON dbo.company_telephony (id_company);');
  END;
  IF COL_LENGTH(N'dbo.company_telephony', N'label') IS NULL
    EXEC (N'ALTER TABLE dbo.company_telephony ADD label nvarchar(100) NULL;');

  IF (SELECT COUNT(*) FROM dbo.company_internet) <> @before_internet
     OR (SELECT COUNT(*) FROM dbo.company_telephony) <> @before_telephony
     OR COL_LENGTH(N'dbo.company_internet', N'id') IS NULL
     OR COL_LENGTH(N'dbo.company_telephony', N'id') IS NULL
     OR COL_LENGTH(N'dbo.company_internet', N'label') IS NULL
     OR COL_LENGTH(N'dbo.company_telephony', N'label') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed (row counts or columns). Everything was rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, @before_internet AS internet_rows, @before_telephony AS telephony_rows;

/* ---------------------------------------------------------------------------
   ROLLBACK - only while every company has at most ONE row in each table
   (otherwise the old primary key on id_company cannot be rebuilt).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  ALTER TABLE dbo.company_internet DROP CONSTRAINT PK_company_internet;
  DROP INDEX IX_company_internet_company ON dbo.company_internet;
  ALTER TABLE dbo.company_internet DROP COLUMN id, label;
  ALTER TABLE dbo.company_internet ADD CONSTRAINT PK_company_internet PRIMARY KEY (id_company);
  ALTER TABLE dbo.company_telephony DROP CONSTRAINT PK_company_telephony;
  DROP INDEX IX_company_telephony_company ON dbo.company_telephony;
  ALTER TABLE dbo.company_telephony DROP COLUMN id, label;
  ALTER TABLE dbo.company_telephony ADD CONSTRAINT PK_company_telephony PRIMARY KEY (id_company);
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
