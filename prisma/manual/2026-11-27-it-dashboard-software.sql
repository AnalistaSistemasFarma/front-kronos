/*
  Dashboard TI - table it_software (software and certificates per company,
  registered from the «Software» button). 2026-11-27.

  - Checks the database before any change (@expected_db).
  - Idempotent: creates the table only if it does not exist.
  - One batch, one transaction: COMMIT only if the table exists afterwards,
    otherwise ROLLBACK + THROW. Never leaves a transaction open.

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

SELECT N'BEFORE' AS moment, OBJECT_ID(N'dbo.it_software', N'U') AS table_id;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.it_software', N'U') IS NULL
  BEGIN
    EXEC (N'
      CREATE TABLE dbo.it_software (
        id               int IDENTITY(1,1) NOT NULL CONSTRAINT PK_it_software PRIMARY KEY,
        id_company       int            NOT NULL,
        kind             nvarchar(20)   NOT NULL CONSTRAINT CK_it_software_kind CHECK (kind IN (N''software'', N''certificado'')),
        description      nvarchar(300)  NOT NULL,
        provider         nvarchar(100)  NULL,
        purchase_date    date           NULL,
        expiration_date  date           NULL,
        licenses         int            NULL CONSTRAINT CK_it_software_licenses CHECK (licenses >= 0),
        assigned_to      nvarchar(200)  NULL,
        cost             decimal(18,2)  NULL CONSTRAINT CK_it_software_cost CHECK (cost >= 0),
        license_type     nvarchar(20)   NULL CONSTRAINT CK_it_software_license_type CHECK (license_type IN (N''perpetua'', N''mensual'', N''semestral'', N''anual'')),
        created_at       datetime2(0)   NOT NULL CONSTRAINT DF_it_software_created_at DEFAULT SYSUTCDATETIME(),
        created_by       nvarchar(320)  NULL,
        updated_at       datetime2(0)   NOT NULL CONSTRAINT DF_it_software_updated_at DEFAULT SYSUTCDATETIME(),
        updated_by       nvarchar(320)  NULL
      );
      CREATE INDEX IX_it_software_company ON dbo.it_software (id_company, expiration_date);');
  END;

  IF OBJECT_ID(N'dbo.it_software', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: table it_software was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, c.name AS column_name, t.name AS data_type
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.it_software')
ORDER BY c.column_id;

/* ---------------------------------------------------------------------------
   ROLLBACK - drops the table (loses the software that was registered).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.it_software;
  IF OBJECT_ID(N'dbo.it_software', N'U') IS NOT NULL
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
