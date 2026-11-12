-- Flujo «Pedido directo» de KELAB (9) en KRONOSDB_PRUEBAS. 2026-11-12 (como vende Kelab en SAPSEND), con descripción editable (servicios de análisis y desarrollo).
-- Es como venden Meditrack y Kelab en SAPSEND. Para PROBARLO se habilita en OLP (id_company 3) como opción
-- adicional («Pedido directo» en el formulario); la oferta normal sigue igual. Idempotente; solo agrega filas.
-- Reversa: UPDATE dbo.sales_company_config SET id_process_category_directa = NULL WHERE id_company = 9;
--          y borrar el proceso «Pedido directo» (task_sap_action, task_process_category, process_category).
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50101, N'ABORTO: no es KRONOSDB_PRUEBAS', 1;
DECLARE @company INT = 9;
DECLARE @nico NVARCHAR(255) = (SELECT id FROM dbo.[user] WHERE email = N'nicolas.rivera@gsslatam.com');
DECLARE @cat INT = (SELECT TOP 1 cr.id FROM dbo.category_request cr JOIN dbo.company_category_request ccr ON ccr.id_category_request = cr.id
                    WHERE ccr.id_company = @company AND cr.category = N'Ventas' ORDER BY cr.id);
IF @cat IS NULL THROW 50102, N'ABORTO: la empresa no tiene la categoría Ventas', 1;
BEGIN TRAN;
DECLARE @proc INT = (SELECT TOP 1 id FROM dbo.process_category WHERE id_category_request = @cat AND process = N'Pedido directo de venta' ORDER BY id);
IF @proc IS NULL
BEGIN
  INSERT INTO dbo.process_category (process, id_category_request, assigned, description, active, id_status, cost_center, is_external)
  VALUES (N'Pedido directo de venta', @cat, @nico,
          N'Pedido de venta directo en SAP, sin autorizaciones de precio ni de cupo (como Meditrack y Kelab en SAPSEND). Se crea desde el formulario de Ventas.',
          1, 6, NULL, 0);
  SET @proc = SCOPE_IDENTITY();
  INSERT INTO dbo.user_process_category_request_general (id_process_category, id_user) VALUES (@proc, @nico);
  DECLARE @t INT;
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Crear pedido de venta en SAP', @proc, 1, 0, NULL, 1, 0, 0, NULL, NULL, N'sap_executor', 1); SET @t = SCOPE_IDENTITY();
  INSERT INTO dbo.task_sap_action (id_task, trigger_event, action_key, mapping, display_order, active) VALUES (@t, N'on_execute', N'sales.create_order', NULL, 1, 1);
END
UPDATE dbo.sales_company_config SET id_process_category_directa = @proc WHERE id_company = @company AND id_process_category_directa IS NULL;
COMMIT;
SELECT id_company, id_process_category_oferta, id_process_category_directa FROM dbo.sales_company_config WHERE id_company = @company;
GO
-- Servicios con descripción escrita por el usuario (reunión del 2026-11-06). Reversa: descripcion_editable = 0.
UPDATE dbo.sales_company_config SET descripcion_editable = 1 WHERE id_company = 9;
SELECT id_company, valida_precio, descripcion_editable, id_process_category_oferta, id_process_category_directa FROM dbo.sales_company_config WHERE id_company = 9;
