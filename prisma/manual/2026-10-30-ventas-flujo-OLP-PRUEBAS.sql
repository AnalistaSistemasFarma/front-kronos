-- Flujo «Oferta de venta» de OLP (id_company 3) en KRONOSDB_PRUEBAS. 2026-10-30.
-- Solo AGREGA filas (idempotente). Reversa: 2026-10-30-ventas-flujo-OLP-reversa-PRUEBAS.sql
-- OLP solo valida cupo (Nicolás Rivera, 2026-10-27): el flujo no tiene la rama de precios.
--   0 Tarea SAP · Evaluar reglas de venta
--   1 Tarea SAP · Pasar a AE                         (si «Excede cupo»)
--   2 Autorización · Extracupo dirección comercial    (si «Excede cupo»)
--   3 Tarea SAP · Pasar a AEDA                       (si «Excede cupo»)
--   4 Autorización · Extracupo dirección administrativa (si «Excede cupo»)
--   5 Tarea SAP · Crear pedido de venta              (cierra la solicitud)
-- Autorizador de PRUEBA: Nicolás Rivera (asignación directa, como el flujo de Compras).
-- Permiso «Ventas · Ofertas / Gestionar ofertas» para Nicolás y el usuario QA en OLP.
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50101, N'ABORTO: no es KRONOSDB_PRUEBAS', 1;
DECLARE @company INT = 3;
DECLARE @nico NVARCHAR(255) = (SELECT id FROM dbo.[user] WHERE email = N'nicolas.rivera@gsslatam.com');
DECLARE @qa NVARCHAR(255) = (SELECT id FROM dbo.[user] WHERE email = N'qa.sgc@gsslatam.com');
IF @nico IS NULL THROW 50102, N'ABORTO: no existe el usuario de Nicolás', 1;
IF OBJECT_ID(N'dbo.sales_company_config', N'U') IS NULL THROW 50103, N'ABORTO: falta el script de tablas de Ventas', 1;

BEGIN TRAN;
DECLARE @cat INT = (SELECT TOP 1 cr.id FROM dbo.category_request cr JOIN dbo.company_category_request ccr ON ccr.id_category_request = cr.id
                    WHERE ccr.id_company = @company AND cr.category = N'Ventas' ORDER BY cr.id);
IF @cat IS NULL
BEGIN
  INSERT INTO dbo.category_request (category, active) VALUES (N'Ventas', 1);
  SET @cat = SCOPE_IDENTITY();
  INSERT INTO dbo.user_category_request_general (id_category, id_user) VALUES (@cat, @nico);
  INSERT INTO dbo.company_category_request (id_category_request, id_company) VALUES (@cat, @company);
END

DECLARE @tipoCom INT = (SELECT id FROM dbo.types_authorization WHERE type_authorization = N'Ventas · Extracupo dirección comercial');
IF @tipoCom IS NULL BEGIN INSERT INTO dbo.types_authorization (type_authorization) VALUES (N'Ventas · Extracupo dirección comercial'); SET @tipoCom = SCOPE_IDENTITY(); END
DECLARE @tipoAdm INT = (SELECT id FROM dbo.types_authorization WHERE type_authorization = N'Ventas · Extracupo dirección administrativa');
IF @tipoAdm IS NULL BEGIN INSERT INTO dbo.types_authorization (type_authorization) VALUES (N'Ventas · Extracupo dirección administrativa'); SET @tipoAdm = SCOPE_IDENTITY(); END
DECLARE @tipoPre INT = (SELECT id FROM dbo.types_authorization WHERE type_authorization = N'Ventas · Precios');
IF @tipoPre IS NULL BEGIN INSERT INTO dbo.types_authorization (type_authorization) VALUES (N'Ventas · Precios'); SET @tipoPre = SCOPE_IDENTITY(); END
IF NOT EXISTS (SELECT 1 FROM dbo.user_types_authorization WHERE id_user = @nico AND type_authorization = @tipoCom)
  INSERT INTO dbo.user_types_authorization (type_authorization, id_user) VALUES (@tipoCom, @nico);
IF NOT EXISTS (SELECT 1 FROM dbo.user_types_authorization WHERE id_user = @nico AND type_authorization = @tipoAdm)
  INSERT INTO dbo.user_types_authorization (type_authorization, id_user) VALUES (@tipoAdm, @nico);

DECLARE @proc INT = (SELECT TOP 1 id FROM dbo.process_category WHERE id_category_request = @cat AND process = N'Oferta de venta' ORDER BY id);
IF @proc IS NULL
BEGIN
  INSERT INTO dbo.process_category (process, id_category_request, assigned, description, active, id_status, cost_center, is_external)
  VALUES (N'Oferta de venta', @cat, @nico,
          N'Oferta de venta en SAP (cotización + borrador de pedido). Se diligencia en el formulario de Ventas; el flujo evalúa el cupo, pide las autorizaciones y crea el pedido.',
          1, 6, NULL, 0);
  SET @proc = SCOPE_IDENTITY();
  INSERT INTO dbo.user_process_category_request_general (id_process_category, id_user) VALUES (@proc, @nico);
END

-- Campo de sistema para el condicional (lo llena la Tarea SAP de evaluación).
DECLARE @field INT = (SELECT id FROM dbo.process_form_field WHERE id_process_category = @proc AND field_label = N'Resultado de la evaluación de venta');
IF @field IS NULL
BEGIN
  INSERT INTO dbo.process_form_field (id_process_category, field_label, field_type, required, active, display_order, config_json, editable)
  VALUES (@proc, N'Resultado de la evaluación de venta', N'select', 0, 1, 99, N'{"system":true}', 0);
  SET @field = SCOPE_IDENTITY();
END
DECLARE @optCupo INT = (SELECT id FROM dbo.process_form_field_option WHERE id_form_field = @field AND option_label = N'Excede cupo');
IF @optCupo IS NULL BEGIN INSERT INTO dbo.process_form_field_option (id_form_field, option_label, active, display_order) VALUES (@field, N'Excede cupo', 1, 1); SET @optCupo = SCOPE_IDENTITY(); END
IF NOT EXISTS (SELECT 1 FROM dbo.process_form_field_option WHERE id_form_field = @field AND option_label = N'Requiere autorización de precio')
  INSERT INTO dbo.process_form_field_option (id_form_field, option_label, active, display_order) VALUES (@field, N'Requiere autorización de precio', 1, 2);

-- Tareas (secuenciales). Se crean solo si el proceso aún no tiene tareas.
IF NOT EXISTS (SELECT 1 FROM dbo.task_process_category WHERE id_process_category = @proc)
BEGIN
  DECLARE @t0 INT, @t1 INT, @t2 INT, @t3 INT, @t4 INT, @t5 INT;
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Evaluar reglas de venta (cupo)', @proc, 1, 0, NULL, 1, 0, 0, NULL, NULL, N'sap_executor', 0); SET @t0 = SCOPE_IDENTITY();
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Pasar a «En autorización de extracupo»', @proc, 1, 0, NULL, 1, 1, 0, NULL, NULL, N'sap_executor', 0); SET @t1 = SCOPE_IDENTITY();
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Autorizar extracupo · Dirección comercial', @proc, 1, 0, NULL, 1, 2, 1, @tipoCom, NULL, N'authorization', 0); SET @t2 = SCOPE_IDENTITY();
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Pasar a «En autorización por dirección administrativa»', @proc, 1, 0, NULL, 1, 3, 0, NULL, NULL, N'sap_executor', 0); SET @t3 = SCOPE_IDENTITY();
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Autorizar extracupo · Dirección administrativa', @proc, 1, 0, NULL, 1, 4, 1, @tipoAdm, NULL, N'authorization', 0); SET @t4 = SCOPE_IDENTITY();
  INSERT INTO dbo.task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization, id_linked_process, task_kind, closes_request)
  VALUES (N'Crear pedido de venta en SAP', @proc, 1, 0, NULL, 1, 5, 0, NULL, NULL, N'sap_executor', 1); SET @t5 = SCOPE_IDENTITY();

  INSERT INTO dbo.task_sap_action (id_task, trigger_event, action_key, mapping, display_order, active) VALUES
    (@t0, N'on_execute', N'sales.evaluate_rules', NULL, 1, 1),
    (@t1, N'on_execute', N'sales.state_ae', NULL, 1, 1),
    (@t2, N'on_reject', N'sales.state_rejected', NULL, 1, 1),
    (@t3, N'on_execute', N'sales.state_aeda', NULL, 1, 1),
    (@t4, N'on_reject', N'sales.state_rejected', NULL, 1, 1),
    (@t5, N'on_execute', N'sales.create_order', NULL, 1, 1);

  INSERT INTO dbo.task_condition_option (id_task, id_option) VALUES (@t1, @optCupo), (@t2, @optCupo), (@t3, @optCupo), (@t4, @optCupo);
  INSERT INTO dbo.user_task_request_general (id_task, id_user) VALUES (@t2, @nico), (@t4, @nico);
END

IF NOT EXISTS (SELECT 1 FROM dbo.sales_company_config WHERE id_company = @company)
  INSERT INTO dbo.sales_company_config (id_company, activo, valida_precio, id_process_category_oferta, ventas_emails, default_currency)
  VALUES (@company, 1, 0, @proc, N'nicolas.rivera@gsslatam.com', N'COP');
ELSE IF ISNULL((SELECT id_process_category_oferta FROM dbo.sales_company_config WHERE id_company = @company), @proc) <> @proc
  THROW 50104, N'ABORTO: OLP ya tiene otro flujo de oferta configurado; no se pisa', 1;
ELSE
  UPDATE dbo.sales_company_config SET id_process_category_oferta = @proc WHERE id_company = @company AND id_process_category_oferta IS NULL;

-- Permisos de Ventas en OLP (Nicolás y QA).
DECLARE @sRead INT = (SELECT id_subprocess FROM dbo.subprocess WHERE subprocess_url = N'/process/sales');
DECLARE @sManage INT = (SELECT id_subprocess FROM dbo.subprocess WHERE subprocess_url = N'/process/sales/manage');
DECLARE @cuN INT = (SELECT id_company_user FROM dbo.company_user WHERE id_user = @nico AND id_company = @company);
DECLARE @cuQ INT = (SELECT id_company_user FROM dbo.company_user WHERE id_user = @qa AND id_company = @company);
IF @cuN IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company WHERE id_company_user = @cuN AND id_subprocess = @sRead) INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user) VALUES (@sRead, @cuN);
  IF NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company WHERE id_company_user = @cuN AND id_subprocess = @sManage) INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user) VALUES (@sManage, @cuN);
END
IF @cuQ IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company WHERE id_company_user = @cuQ AND id_subprocess = @sRead) INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user) VALUES (@sRead, @cuQ);
  IF NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company WHERE id_company_user = @cuQ AND id_subprocess = @sManage) INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user) VALUES (@sManage, @cuQ);
END
COMMIT;

SELECT @cat AS id_categoria, @proc AS id_proceso, @field AS id_campo, @optCupo AS id_opcion_cupo, @tipoCom AS tipo_comercial, @tipoAdm AS tipo_administrativa,
       (SELECT COUNT(*) FROM dbo.task_process_category WHERE id_process_category = @proc) AS tareas,
       (SELECT COUNT(*) FROM dbo.task_sap_action tsa JOIN dbo.task_process_category t ON t.id = tsa.id_task WHERE t.id_process_category = @proc) AS acciones_sap;
