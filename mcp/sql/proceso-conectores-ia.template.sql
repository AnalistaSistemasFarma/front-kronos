/* =============================================================================
   Proceso "Solicitud de conectores para agentes IA" para una empresa
   -----------------------------------------------------------------------------
   Duplica el proceso 249 de UNIDOSSIS (KRONOSDB) con el MISMO flujo: tres tareas
   secuenciales (Autorización -> Instalación -> Auditoría de seguridad), sin
   formulario dinámico ni archivos requeridos (249 no tiene). Cambia solo el
   autorizador de la tarea de autorización.

   Inserta en las mismas tablas y con los mismos valores que la pantalla de
   creación de flujos (POST /api/requests-general/create-workflow):
     process_category, user_process_category_request_general,
     task_process_category, user_task_request_general.
   Diferencia con la pantalla: la pantalla crea el proceso inactivo (active = 0)
   y se activa después; aquí se deja active = 1 / id_status = 6, como está 249.

   Idempotente: si ya existe un proceso con ese nombre en la categoría, no hace
   nada y lo informa. Todo en una transacción; aborta si DB_NAME() no coincide.

   USO
   - PRUEBAS: @expected_db = N'KRONOSDB_PRUEBAS'.
   - PRODUCCIÓN (solo con autorización explícita): @expected_db = N'KRONOSDB'.
   - Ajuste @company_name / @category_like / @authorizer_email por empresa.
     OLP: ONELATAMPHARMA, categoría 'Tecnolog%' (prod id 5, pruebas id 30),
     autoriza andrea.duque@onelatampharma.com.
   ============================================================================= */
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @expected_db        sysname       = N'{{EXPECTED_DB}}';
DECLARE @company_name       nvarchar(200) = N'{{COMPANY_NAME}}';
DECLARE @category_like      nvarchar(200) = N'{{CATEGORY_LIKE}}';
DECLARE @create_category    bit           = {{CREATE_CATEGORY}};   -- 1 solo en PRUEBAS si la empresa no tiene la categoría
DECLARE @category_new_name  nvarchar(200) = N'Tecnologia';
DECLARE @process_name       varchar(1000) = 'Solicitud de conectores para agentes IA';
DECLARE @auth_type_name     nvarchar(200) = N'Autorizacion agentes ia';
DECLARE @authorizer_email   nvarchar(255) = N'{{AUTHORIZER_EMAIL}}';
DECLARE @installer_email    nvarchar(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @auditor_email      nvarchar(255) = N'ivan.gutierrez@gsslatam.com';
DECLARE @owner_email        nvarchar(255) = N'nicolas.rivera@gsslatam.com';

IF DB_NAME() <> @expected_db
  THROW 50001, 'DB_NAME() no coincide con @expected_db; se aborta.', 1;

BEGIN TRANSACTION;

DECLARE @id_company int = (SELECT id_company FROM company WHERE UPPER(LTRIM(RTRIM(company))) = UPPER(@company_name));
IF @id_company IS NULL THROW 50002, 'Empresa no encontrada.', 1;
IF UPPER(@company_name) = N'GSS' THROW 50003, 'Nunca en GSS.', 1;

DECLARE @n_cat int = (SELECT COUNT(*) FROM category_request cr
                       JOIN company_category_request ccr ON ccr.id_category_request = cr.id
                      WHERE ccr.id_company = @id_company AND cr.active = 1 AND cr.category LIKE @category_like);
DECLARE @id_category int;
IF @n_cat = 1
  SET @id_category = (SELECT cr.id FROM category_request cr
                       JOIN company_category_request ccr ON ccr.id_category_request = cr.id
                      WHERE ccr.id_company = @id_company AND cr.active = 1 AND cr.category LIKE @category_like);
ELSE IF @n_cat = 0 AND @create_category = 1
BEGIN
  INSERT INTO category_request (category, active) VALUES (@category_new_name, 1);
  SET @id_category = SCOPE_IDENTITY();
  INSERT INTO company_category_request (id_company, id_category_request) VALUES (@id_company, @id_category);
END
ELSE
  THROW 50004, 'Categoría ambigua o inexistente para la empresa.', 1;

DECLARE @id_authorizer nvarchar(255) = (SELECT id FROM [user] WHERE LOWER(email) = LOWER(@authorizer_email));
DECLARE @id_installer  nvarchar(255) = (SELECT id FROM [user] WHERE LOWER(email) = LOWER(@installer_email));
DECLARE @id_auditor    nvarchar(255) = (SELECT id FROM [user] WHERE LOWER(email) = LOWER(@auditor_email));
DECLARE @id_owner      nvarchar(255) = (SELECT id FROM [user] WHERE LOWER(email) = LOWER(@owner_email));
IF @id_authorizer IS NULL OR @id_installer IS NULL OR @id_auditor IS NULL OR @id_owner IS NULL
  THROW 50005, 'Algún usuario (autorizador/instalador/auditor/encargado) no existe.', 1;

-- Tipo de autorización (en prod ya existe: id 9). En pruebas se crea si falta.
DECLARE @id_type int = (SELECT TOP 1 id FROM types_authorization WHERE type_authorization = @auth_type_name ORDER BY id);
IF @id_type IS NULL
BEGIN
  INSERT INTO types_authorization (type_authorization) VALUES (@auth_type_name);
  SET @id_type = SCOPE_IDENTITY();
END

DECLARE @existing int = (SELECT TOP 1 id FROM process_category WHERE id_category_request = @id_category AND process = @process_name);
IF @existing IS NOT NULL
BEGIN
  SELECT 'ya existía' AS resultado, @existing AS id_process_category, @id_company AS id_company, @id_category AS id_category;
  COMMIT TRANSACTION;
  RETURN;
END

-- Proceso (copia de 249).
DECLARE @t TABLE (id int);
INSERT INTO process_category (process, id_category_request, active, id_status, cost_center, is_external)
OUTPUT INSERTED.id INTO @t
VALUES (@process_name, @id_category, 1, 6, N'Tecnología', 0);
DECLARE @id_process int = (SELECT id FROM @t);

INSERT INTO user_process_category_request_general (id_process_category, id_user) VALUES (@id_process, @id_owner);

-- Tareas (mismos nombres, orden, secuencialidad y centro de costo que 249).
DECLARE @tk TABLE (id int);
INSERT INTO task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
OUTPUT INSERTED.id INTO @tk
VALUES (N'Autorizacion del conector', @id_process, 1, 0, N'Tecnología', 1, 0, 1, @id_type);
DECLARE @id_t1 int = (SELECT id FROM @tk); DELETE FROM @tk;
INSERT INTO user_task_request_general (id_task, id_user) VALUES (@id_t1, @id_authorizer);

INSERT INTO task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
OUTPUT INSERTED.id INTO @tk
VALUES (N'Instalación de conector ', @id_process, 1, 0, NULL, 1, 1, 0, NULL);
DECLARE @id_t2 int = (SELECT id FROM @tk); DELETE FROM @tk;
INSERT INTO user_task_request_general (id_task, id_user) VALUES (@id_t2, @id_installer);

INSERT INTO task_process_category (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
OUTPUT INSERTED.id INTO @tk
VALUES (N'Auditoria de seguridad', @id_process, 1, 0, N'Tecnología', 1, 2, 0, NULL);
DECLARE @id_t3 int = (SELECT id FROM @tk);
INSERT INTO user_task_request_general (id_task, id_user) VALUES (@id_t3, @id_auditor);

COMMIT TRANSACTION;

SELECT 'creado' AS resultado, @id_process AS id_process_category, @id_company AS id_company, @id_category AS id_category,
       @id_type AS id_type_authorization, @id_t1 AS task_autorizacion, @id_t2 AS task_instalacion, @id_t3 AS task_auditoria,
       @authorizer_email AS autorizador;
