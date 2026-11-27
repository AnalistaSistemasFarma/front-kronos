/*
  Dashboard TI - Proveedores (2026-11-27). Run AFTER
  2026-11-26-it-dashboard-company-internet.sql.

  1. company_internet.dns_secondary («DNS 2»; dns_servers becomes «DNS 1»).
  2. Table company_telephony (telephone service per company, «Telefonía»).

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
IF OBJECT_ID(N'dbo.company_internet', N'U') IS NULL
BEGIN
  RAISERROR(N'Table company_internet not found. Run 2026-11-26-it-dashboard-company-internet.sql first. Nothing was changed.', 16, 1);
  RETURN;
END;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH(N'dbo.company_internet', N'dns_secondary') IS NULL
    EXEC (N'ALTER TABLE dbo.company_internet ADD dns_secondary nvarchar(45) NULL;');

  IF OBJECT_ID(N'dbo.company_telephony', N'U') IS NULL
    EXEC (N'
      CREATE TABLE dbo.company_telephony (
        id_company       int            NOT NULL CONSTRAINT PK_company_telephony PRIMARY KEY,
        provider         nvarchar(100)  NULL,
        service_type     nvarchar(20)   NULL CONSTRAINT CK_company_telephony_service CHECK (service_type IN (N''fija'', N''ip'', N''celular'', N''pbx_nube'')),
        main_number      nvarchar(50)   NULL,
        lines            int            NULL CONSTRAINT CK_company_telephony_lines CHECK (lines >= 0),
        extensions       int            NULL CONSTRAINT CK_company_telephony_ext CHECK (extensions >= 0),
        [plan]           nvarchar(100)  NULL,
        monthly_cost     decimal(18,2)  NULL CONSTRAINT CK_company_telephony_cost CHECK (monthly_cost >= 0),
        contract_number  nvarchar(50)   NULL,
        support_contact  nvarchar(150)  NULL,
        notes            nvarchar(1000) NULL,
        updated_at       datetime2(0)   NOT NULL CONSTRAINT DF_company_telephony_updated_at DEFAULT SYSUTCDATETIME(),
        updated_by       nvarchar(320)  NULL
      );');

  IF COL_LENGTH(N'dbo.company_internet', N'dns_secondary') IS NULL OR OBJECT_ID(N'dbo.company_telephony', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed. Everything was rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db,
  COL_LENGTH(N'dbo.company_internet', N'dns_secondary') AS dns_secondary,
  OBJECT_ID(N'dbo.company_telephony', N'U') AS company_telephony;

/* ---------------------------------------------------------------------------
   ROLLBACK

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.company_telephony;
  ALTER TABLE dbo.company_internet DROP COLUMN dns_secondary;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
