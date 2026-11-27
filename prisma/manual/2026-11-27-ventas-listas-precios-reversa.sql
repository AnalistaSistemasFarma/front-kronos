-- REVERSA de 2026-11-27-ventas-listas-precios (PRUEBAS o PROD). Se detiene si ya hay solicitudes de precios.
SET XACT_ABORT ON; SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.price_update', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.price_update)
  THROW 51701, N'Hay solicitudes de actualización de precios: no se revierte.', 1;
IF OBJECT_ID(N'dbo.price_update_line', N'U') IS NOT NULL DROP TABLE dbo.price_update_line;
IF OBJECT_ID(N'dbo.price_update', N'U') IS NOT NULL DROP TABLE dbo.price_update;
IF COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_precios_lista') IS NOT NULL
  ALTER TABLE dbo.sales_company_config DROP COLUMN id_process_category_precios_lista;
