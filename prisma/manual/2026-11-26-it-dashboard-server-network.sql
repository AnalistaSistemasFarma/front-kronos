/*
  Dashboard TI - table asset_server_network (editable «Datos de red» of server
  assets, shown in the server panel of the asset detail window). 2026-11-26.

  - Checks the database before any change (@expected_db).
  - Idempotent: creates the table only if it does not exist.
  - One batch, one transaction: COMMIT only if the table exists afterwards,
    otherwise ROLLBACK + THROW. Never leaves a transaction open.
  - No foreign key: dbo.assets has no primary key on id; the API checks that
    the asset exists and is a server before writing.

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

SELECT N'BEFORE' AS moment, OBJECT_ID(N'dbo.asset_server_network', N'U') AS table_id;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.asset_server_network', N'U') IS NULL
  BEGIN
    EXEC (N'
      CREATE TABLE dbo.asset_server_network (
        id_asset     int            NOT NULL CONSTRAINT PK_asset_server_network PRIMARY KEY,
        hostname     nvarchar(100)  NULL,
        ip_address   nvarchar(45)   NULL,
        subnet_mask  nvarchar(45)   NULL,
        gateway      nvarchar(45)   NULL,
        dns_servers  nvarchar(200)  NULL,
        vlan         nvarchar(50)   NULL,
        mac_address  nvarchar(30)   NULL,
        notes        nvarchar(1000) NULL,
        updated_at   datetime2(0)   NOT NULL CONSTRAINT DF_asset_server_network_updated_at DEFAULT SYSUTCDATETIME(),
        updated_by   nvarchar(320)  NULL
      );');
  END;

  IF OBJECT_ID(N'dbo.asset_server_network', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: table asset_server_network was not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, c.name AS column_name, t.name AS data_type, c.max_length
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.asset_server_network')
ORDER BY c.column_id;

/* ---------------------------------------------------------------------------
   ROLLBACK - drops the table (loses the network data that was typed in).

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DROP TABLE IF EXISTS dbo.asset_server_network;
  IF OBJECT_ID(N'dbo.asset_server_network', N'U') IS NOT NULL
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
