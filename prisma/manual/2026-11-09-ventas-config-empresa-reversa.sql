-- REVERSA de 2026-11-09-ventas-config-empresa (PRUEBAS o PROD): quita las 4 columnas y sus defaults.
SET XACT_ABORT ON; SET NOCOUNT ON;
IF COL_LENGTH(N'dbo.sales_company_config', N'descripcion_editable') IS NOT NULL
BEGIN ALTER TABLE dbo.sales_company_config DROP CONSTRAINT sales_company_config_desc_edit_df; ALTER TABLE dbo.sales_company_config DROP COLUMN descripcion_editable; END
IF COL_LENGTH(N'dbo.sales_company_config', N'id_price_list_default') IS NOT NULL ALTER TABLE dbo.sales_company_config DROP COLUMN id_price_list_default;
IF COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_directa') IS NOT NULL ALTER TABLE dbo.sales_company_config DROP COLUMN id_process_category_directa;
IF COL_LENGTH(N'dbo.sales_company_config', N'exige_oc') IS NOT NULL
BEGIN ALTER TABLE dbo.sales_company_config DROP CONSTRAINT sales_company_config_exige_oc_df; ALTER TABLE dbo.sales_company_config DROP COLUMN exige_oc; END
