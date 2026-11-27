-- "Price list update" workflow in KRONOSDB_PRUEBAS for every company with Sales enabled. 2026-11-27.
--   0 Authorization · "Ventas · Precios" type (TEST approver: Nicolás Rivera)
--   1 SAP task · apply approved prices in SAP (prices.apply) — closes the request
-- Additive and idempotent. Rollback: delete each company's process (without requests) and set
-- sales_company_config.id_process_category_price_list = NULL.
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50101, N'ABORT: not KRONOSDB_PRUEBAS', 1;
DECLARE @nico NVARCHAR(255) = (SELECT id FROM dbo.[user] WHERE email = N'nicolas.rivera@gsslatam.com');
DECLARE @priceType INT = (SELECT id FROM dbo.types_authorization WHERE type_authorization = N'Ventas · Precios');
IF @nico IS NULL OR @priceType IS NULL THROW 50102, N'ABORT: missing user or the price authorization type', 1;
DECLARE @c INT = (SELECT MIN(id_company) FROM dbo.sales_company_config WHERE activo = 1);
BEGIN TRAN;
WHILE @c IS NOT NULL
BEGIN
  DECLARE @cat INT = (SELECT TOP 1 cr.id FROM dbo.category_request cr JOIN dbo.company_category_request ccr ON ccr.id_category_request = cr.id
                      WHERE ccr.id_company = @c AND cr.category = N'Ventas' ORDER BY cr.id);
  IF @cat IS NOT NULL
  BEGIN
    DECLARE @proc INT = (SELECT TOP 1 id FROM dbo.process_category WHERE id_category_request = @cat AND process = N'Actualización de lista de precios' ORDER BY id);
    IF @proc IS NULL
    BEGIN
      INSERT INTO dbo.process_category (process, id_category_request, assigned, description, active, id_status, cost_center, is_external)
      VALUES (N'Actualización de lista de precios', @cat, @nico,
              N'Precios renegociados con un cliente: se piden aquí, se autorizan y una Tarea SAP los deja en la lista del cliente (o como precio especial si su lista es compartida).',
              1, 6, NULL, 0);
      SET @proc = SCOPE_IDENTITY();
      INSERT INTO dbo.user_process_category_request_general (id_process_category, id_user) VALUES (@proc, @nico);
      DECLARE @t0 INT, @t1 INT;
      INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
      VALUES (N'Autorizar precios', @proc, 1, 0, NULL, 1, 0, 1, @priceType, NULL, N'authorization', 0); SET @t0 = SCOPE_IDENTITY();
      INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
      VALUES (N'Aplicar precios en SAP', @proc, 1, 0, NULL, 1, 1, 0, NULL, NULL, N'sap_executor', 1); SET @t1 = SCOPE_IDENTITY();
      INSERT INTO dbo.task_sap_action (id_task, trigger_event, action_key, mapping, display_order, active) VALUES (@t1, N'on_execute', N'prices.apply', NULL, 1, 1);
      INSERT INTO dbo.user_task_request_general (id_task, id_user) VALUES (@t0, @nico);
    END
    UPDATE dbo.sales_company_config SET id_process_category_price_list = @proc WHERE id_company = @c AND id_process_category_price_list IS NULL;
  END
  SET @c = (SELECT MIN(id_company) FROM dbo.sales_company_config WHERE activo = 1 AND id_company > @c);
END
COMMIT;
SELECT s.id_company, s.id_process_category_price_list AS process_id,
       (SELECT COUNT(*) FROM dbo.task_process_category t WHERE t.id_process_category = s.id_process_category_price_list) AS tasks
FROM dbo.sales_company_config s ORDER BY s.id_company;
