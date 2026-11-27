/*
  Rollback of 2026-11-27-ventas-mapeo-aprendido (learned item mappings).
  Drops both tables (the learned mappings and their audit are lost: export them first if needed).
  Deploy the previous front-kronos version first (or remove the tables from objetos-requeridos.json).
  Set @expected_db to N'KRONOSDB_PRUEBAS' or N'KRONOSDB'. One batch, XACT_ABORT, LOCK_TIMEOUT 5000, COMMIT/ROLLBACK.
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
  IF OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') IS NOT NULL DROP TABLE dbo.sales_item_mapping_learned_log;
  IF OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') IS NOT NULL DROP TABLE dbo.sales_item_mapping_learned;
  IF OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') IS NOT NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50002, N'Validation failed: the tables still exist. Rolled back.', 1;
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') AS mapping_table, OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') AS log_table;
