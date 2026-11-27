/*
  Dashboard TI - table asset_maintenance (maintenance log of computers: date,
  Preventivo / Correctivo, note, who and when). 2026-11-27.

  - Checks the database before any change (@expected_db).
  - Idempotent: creates the table only if it does not exist.
  - One transaction: COMMIT only if the table exists afterwards, otherwise
    ROLLBACK + THROW. Never leaves a transaction open.
  - No foreign key: dbo.assets has no primary key on id; the API checks that
    the asset exists and is a computer before writing.

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

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.asset_maintenance', N'U') IS NULL
    EXEC (N'
      CREATE TABLE dbo.asset_maintenance (
        id                int IDENTITY(1,1) NOT NULL CONSTRAINT PK_asset_maintenance PRIMARY KEY,
        id_asset          int            NOT NULL,
        maintenance_date  date           NOT NULL,
        kind              nvarchar(20)   NOT NULL CONSTRAINT CK_asset_maintenance_kind CHECK (kind IN (N''preventivo'', N''correctivo'')),
        notes             nvarchar(500)  NULL,
        created_at        datetime2(0)   NOT NULL CONSTRAINT DF_asset_maintenance_created_at DEFAULT SYSUTCDATETIME(),
        created_by        nvarchar(320)  NULL
      );
      CREATE INDEX IX_asset_maintenance_asset ON dbo.asset_maintenance (id_asset, maintenance_date DESC);');

  IF OBJECT_ID(N'dbo.asset_maintenance', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: table asset_maintenance was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, OBJECT_ID(N'dbo.asset_maintenance', N'U') AS asset_maintenance;

/* ---------------------------------------------------------------------------
   ROLLBACK - drops the table (loses the maintenance log).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.asset_maintenance;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
