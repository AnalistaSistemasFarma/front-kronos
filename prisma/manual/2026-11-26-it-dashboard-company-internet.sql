/*
  Dashboard TI - table company_internet (internet channel of each company,
  typed in by hand from the «Internet» card). 2026-11-26.

  - Checks the database before any change (@expected_db).
  - Idempotent: creates the table only if it does not exist.
  - One batch, one transaction: COMMIT only if the table exists afterwards,
    otherwise ROLLBACK + THROW. Never leaves a transaction open.

  PRUEBAS: already applied in KRONOSDB_PRUEBAS on 2026-11-26.
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

SELECT N'BEFORE' AS moment, OBJECT_ID(N'dbo.company_internet', N'U') AS table_id;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.company_internet', N'U') IS NULL
  BEGIN
    EXEC (N'
      CREATE TABLE dbo.company_internet (
        id_company       int            NOT NULL CONSTRAINT PK_company_internet PRIMARY KEY,
        provider         nvarchar(100)  NULL,
        public_ip        nvarchar(45)   NULL,
        subnet_mask      nvarchar(45)   NULL,
        gateway          nvarchar(45)   NULL,
        dns_servers      nvarchar(200)  NULL,
        bandwidth        nvarchar(50)   NULL,
        channel_type     nvarchar(20)   NULL CONSTRAINT CK_company_internet_channel CHECK (channel_type IN (N''dedicado'', N''banda_ancha'')),
        connection_type  nvarchar(20)   NULL CONSTRAINT CK_company_internet_connection CHECK (connection_type IN (N''fibra'', N''coaxial'')),
        notes            nvarchar(1000) NULL,
        updated_at       datetime2(0)   NOT NULL CONSTRAINT DF_company_internet_updated_at DEFAULT SYSUTCDATETIME(),
        updated_by       nvarchar(320)  NULL
      );');
  END;

  IF OBJECT_ID(N'dbo.company_internet', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: table company_internet was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, c.name AS column_name, t.name AS data_type, c.max_length
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.company_internet')
ORDER BY c.column_id;

/* ---------------------------------------------------------------------------
   ROLLBACK - drops the table (loses the internet data that was typed in).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.company_internet;
  IF OBJECT_ID(N'dbo.company_internet', N'U') IS NOT NULL
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
