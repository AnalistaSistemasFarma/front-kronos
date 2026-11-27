-- ROLLBACK of 2026-11-27-sales-price-lists (PRUEBAS or PROD). Stops if price update requests already exist.
SET XACT_ABORT ON; SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.price_update', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.price_update)
  THROW 51701, N'Price update requests exist: rollback aborted.', 1;
IF OBJECT_ID(N'dbo.price_update_line', N'U') IS NOT NULL DROP TABLE dbo.price_update_line;
IF OBJECT_ID(N'dbo.price_update', N'U') IS NOT NULL DROP TABLE dbo.price_update;
IF COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_price_list') IS NOT NULL
  ALTER TABLE dbo.sales_company_config DROP COLUMN id_process_category_price_list;
