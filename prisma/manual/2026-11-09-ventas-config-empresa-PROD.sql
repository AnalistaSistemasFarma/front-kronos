-- Ventas: parámetros por empresa que pidió la reunión del 2026-11-06 (y variantes de SAPSEND). PROD. 2026-11-09.
-- Solo AGREGA columnas con valor por defecto (aditivo, idempotente). No cambia datos.
--   descripcion_editable        BIT  (0): el usuario puede escribir la descripción del artículo en la línea
--                                         (servicios de Meditrack, como SAPSEND).
--   id_price_list_default       INT NULL: lista de precios a usar si el cliente no tiene lista o su precio es 0
--                                         (OLP: todos los clientes en «SIN ASIGNAR»).
--   id_process_category_directa INT NULL: flujo «Pedido directo» (solo la Tarea SAP «Crear pedido»). Si está,
--                                         el formulario ofrece «Crear pedido directo» además de la oferta.
--                                         Empresas que SOLO venden directo (Meditrack/Kelab en SAPSEND): su
--                                         id_process_category_oferta apunta a ese flujo.
--   exige_oc                    BIT  (1): la OC / referencia del cliente es obligatoria (como SAPSEND).
-- REVERSA: 2026-11-09-ventas-config-empresa-reversa.sql
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB' THROW 51490, N'Base no esperada: este script es para KRONOSDB (producción).', 1;
IF OBJECT_ID(N'dbo.sales_company_config', N'U') IS NULL THROW 51491, N'Falta la tabla dbo.sales_company_config (script 2026-10-30-ventas-autorizacion).', 1;
IF COL_LENGTH(N'dbo.sales_company_config', N'descripcion_editable') IS NULL
  ALTER TABLE dbo.sales_company_config ADD descripcion_editable BIT NOT NULL CONSTRAINT sales_company_config_desc_edit_df DEFAULT 0;
IF COL_LENGTH(N'dbo.sales_company_config', N'id_price_list_default') IS NULL
  ALTER TABLE dbo.sales_company_config ADD id_price_list_default INT NULL;
IF COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_directa') IS NULL
  ALTER TABLE dbo.sales_company_config ADD id_process_category_directa INT NULL;
IF COL_LENGTH(N'dbo.sales_company_config', N'exige_oc') IS NULL
  ALTER TABLE dbo.sales_company_config ADD exige_oc BIT NOT NULL CONSTRAINT sales_company_config_exige_oc_df DEFAULT 1;
GO
SELECT id_company, activo, valida_precio, descripcion_editable, id_price_list_default, id_process_category_directa, exige_oc FROM dbo.sales_company_config;
