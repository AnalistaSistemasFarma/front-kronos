/*
  Dashboard TI - table asset_photo (one picture per asset, shown at the
  top-right of the asset detail window). 2026-11-27.

  - Checks the database before any change (@expected_db).
  - Idempotent: creates the table only if it does not exist.
  - One transaction: COMMIT only if the table exists afterwards, otherwise
    ROLLBACK + THROW. Never leaves a transaction open.
  - Size limited to 1.5 MB per picture (the browser shrinks it to 900 px).

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

  IF OBJECT_ID(N'dbo.asset_photo', N'U') IS NULL
    EXEC (N'
      CREATE TABLE dbo.asset_photo (
        id_asset    int             NOT NULL CONSTRAINT PK_asset_photo PRIMARY KEY,
        mime        nvarchar(30)    NOT NULL CONSTRAINT CK_asset_photo_mime CHECK (mime IN (N''image/jpeg'', N''image/png'', N''image/webp'')),
        content     varbinary(max)  NOT NULL,
        updated_at  datetime2(0)    NOT NULL CONSTRAINT DF_asset_photo_updated_at DEFAULT SYSUTCDATETIME(),
        updated_by  nvarchar(320)   NULL,
        CONSTRAINT CK_asset_photo_size CHECK (DATALENGTH(content) <= 1500000)
      );');

  IF OBJECT_ID(N'dbo.asset_photo', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: table asset_photo was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db, OBJECT_ID(N'dbo.asset_photo', N'U') AS asset_photo;

/* ---------------------------------------------------------------------------
   ROLLBACK - drops the table (loses the uploaded pictures).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.asset_photo;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
