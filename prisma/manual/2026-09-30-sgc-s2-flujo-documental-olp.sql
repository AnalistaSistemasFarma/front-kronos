/*
  PASE MANUAL — SGC documental, Sprint 2: flujo documental v1, Autorizaciones
  SGC y matriz de responsables de EJEMPLO para One Latam Pharma (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP,
  ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930200000_sgc_s2_flujos_tareas_autorizaciones
  aplicada y OLP (id_company = 3) con maestros del S1.

  QUÉ HACE (idempotente, solo INSERT de lo que falta; no modifica lo que ya se
  haya configurado desde el administrador de flujos):
    1. Tipos de Autorización SGC (tablas propias; NO dbo.types_authorization):
       SGC-APROBACION  «Aprobación de documento SGC»
       SGC-VERIF-CALIDAD «Verificación de estructura documental (Calidad)»,
       con Nicolás Rivera como integrante inicial del grupo de Calidad.
    2. Proceso validado «DOC — Gestión documental» con su versión 1 VIGENTE:
       6 pasos (solicitud, elaboración, revisión, aprobación, divulgación y
       capacitación; las dos últimas definidas pero en espera hasta el S4),
       12 transiciones y 3 campos. Es la misma definición que
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    3. Matriz de responsables de EJEMPLO (is_example = 1, por cargo) para que
       Calidad vea cómo funciona; se reemplaza con la matriz que entregue
       Nicolás (supuesto a validar).
  Cada alta queda en sgc.config_change_log y en sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s2-flujos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 2: flujo documental v1 (6 pasos) y Autorizaciones SGC de One Latam Pharma, según las decisiones de Nicolás Rivera del 2026-09-30.';

SELECT 'antes' AS momento,
  (SELECT COUNT(*) FROM [sgc].[authorization_type] WHERE id_company = @IdCompany) AS tipos_autorizacion,
  (SELECT COUNT(*) FROM [sgc].[flow_process] WHERE id_company = @IdCompany) AS flujos,
  (SELECT COUNT(*) FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany) AS matriz;

IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51001, N'OLP no está configurada en sgc.company_config (falta el pase del S0).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* sgc.config_change_log y sgc.audit_log tienen triggers de solo inserción:
     SQL Server no permite OUTPUT INTO directo a ellas; se recoge y se inserta después. */
  DECLARE @Cambio TABLE (entity NVARCHAR(40), entity_id NVARCHAR(60), action NVARCHAR(40), after_json NVARCHAR(MAX), id_flow_process INT NULL, id_flow_version INT NULL);

  /* 1) Tipos de Autorización SGC */
  DECLARE @Tipos TABLE (code NVARCHAR(40), name NVARCHAR(150), description NVARCHAR(1000));
  INSERT INTO @Tipos VALUES
    (N'SGC-APROBACION', N'Aprobación de documento SGC', N'Aprobación de los responsables del área en el paso 3 del flujo documental (firma «Aprobó»).'),
    (N'SGC-VERIF-CALIDAD', N'Verificación de estructura documental (Calidad)', N'Aseguramiento de Calidad verifica guía de codificación, formato y anexos dentro de la aprobación.');

  INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
  OUTPUT N'authorization_type', CAST(inserted.id_authorization_type AS NVARCHAR(60)), N'autorizacion.tipo_creado',
         CONCAT(N'{"code":"', inserted.code, N'"}'), NULL, NULL
    INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
  SELECT @IdCompany, t.code, t.name, t.description, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Tipos t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
  OUTPUT N'authorization_type_user', CAST(inserted.id_authorization_type_user AS NVARCHAR(60)), N'autorizacion.grupo_agregado',
         CONCAT(N'{"email":"', inserted.user_email, N'"}'), NULL, NULL
    INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
  SELECT t.id_authorization_type, @Actor, @Actor, N'Integrante inicial del grupo de Calidad (Sprint 2); Calidad lo ajusta desde Autorizaciones SGC.', SYSUTCDATETIME()
  FROM [sgc].[authorization_type] t
  WHERE t.id_company = @IdCompany AND t.code = N'SGC-VERIF-CALIDAD'
    AND NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.user_email = @Actor AND u.revoked_at IS NULL);

  /* 2) Flujo documental v1 */
  DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
  IF @IdProcess IS NULL
  BEGIN
    INSERT INTO [sgc].[flow_process] (id_company, code, name, description, category, owner_email, is_active, created_by, created_at, updated_at)
    VALUES (@IdCompany, N'DOC', N'Gestión documental', N'Flujo documental del SGC: solicitud, elaboración, revisión, aprobación con verificación de Calidad, divulgación y capacitación.', N'documental', @Actor, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME());
    SET @IdProcess = SCOPE_IDENTITY();
    INSERT INTO @Cambio VALUES (N'flow_process', CAST(@IdProcess AS NVARCHAR(60)), N'proceso.creado', N'{"code":"DOC","name":"Gestión documental"}', @IdProcess, NULL);
  END

  IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess)
  BEGIN
    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, 1, N'vigente', @Motivo, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME(), @Actor, SYSUTCDATETIME());
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES
      (@IdVersion, N'solicitud',    N'Solicitud documental', 0, N'solicitante',  N'solicitante', 0, NULL,        NULL,       NULL, NULL, 0, NULL, NULL, 1, N'El dueño del proceso registra la necesidad (nuevo, nueva versión o modificación) con su justificación.'),
      (@IdVersion, N'elaboracion',  N'Elaboración',          1, N'elaborador',   N'elaborador',  0, NULL,        N'elaboro', 10,   NULL, 0, NULL, NULL, 1, N'El elaborador carga el borrador (Word) y asigna revisores y aprobadores, con su modo de firma.'),
      (@IdVersion, N'revision',     N'Revisión',             2, N'revisor',      N'firmantes',   1, N'paralelo', N'reviso',  5,    NULL, 0, NULL, NULL, 1, N'Los revisores dejan observaciones y aprueban o devuelven a elaboración.'),
      (@IdVersion, N'aprobacion',   N'Aprobación',           3, N'aprobador',    N'firmantes',   1, N'orden',    N'aprobo',  5,    NULL, 1, N'SGC-APROBACION', N'SGC-VERIF-CALIDAD', 1, N'Aprueban los responsables del área; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental.'),
      (@IdVersion, N'divulgacion',  N'Divulgación',          4, N'alcance',      N'calidad',     0, NULL,        N'leyo',    10,   NULL, 0, NULL, N'SGC-VERIF-CALIDAD', 0, N'Lectura obligatoria firmada por las personas del alcance (se habilita en el Sprint 4).'),
      (@IdVersion, N'capacitacion', N'Capacitación',         5, N'capacitacion', N'calidad',     0, NULL,        N'capacito', 15,  N'tipo_exige_capacitacion', 0, NULL, N'SGC-VERIF-CALIDAD', 0, N'Video, evaluación y carga de resultados (obligatoria para todos los tipos; se habilita en el Sprint 4).');

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES
      (@IdVersion, N'solicitud',    N'aprobar',  N'elaboracion', NULL),
      (@IdVersion, N'solicitud',    N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'elaboracion',  N'aprobar',  N'revision',    NULL),
      (@IdVersion, N'elaboracion',  N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'revision',     N'aprobar',  N'aprobacion',  NULL),
      (@IdVersion, N'revision',     N'devolver', N'elaboracion', NULL),
      (@IdVersion, N'revision',     N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'aprobacion',   N'aprobar',  N'divulgacion', NULL),
      (@IdVersion, N'aprobacion',   N'devolver', N'elaboracion', NULL),
      (@IdVersion, N'aprobacion',   N'cancelar', NULL,           N'cancelada'),
      (@IdVersion, N'divulgacion',  N'aprobar',  N'capacitacion', NULL),
      (@IdVersion, N'capacitacion', N'aprobar',  NULL,           N'completada');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order)
    VALUES
      (@IdVersion, NULL, N'referencia_cambio', N'Referencia de control de cambios', N'texto', 0, NULL, N'Número del control de cambios que origina la solicitud, si existe.', 1),
      (@IdVersion, NULL, N'urgencia', N'Prioridad', N'seleccion', 1, N'["Normal","Alta","Requerimiento regulatorio"]', NULL, 2),
      (@IdVersion, N'elaboracion', N'resumen_cambios', N'Resumen de los cambios frente a la versión anterior', N'texto_largo', 0, NULL, N'Para nuevas versiones y modificaciones.', 3);

    INSERT INTO @Cambio VALUES (N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), N'version.publicada', N'{"version":1,"tareas":6,"transiciones":12,"campos":3}', @IdProcess, @IdVersion);
  END

  /* 3) Matriz de responsables de EJEMPLO (por cargo; solo sugiere) */
  DECLARE @Gc INT = (SELECT id_process_map FROM [sgc].[process_map] WHERE id_company = @IdCompany AND code = N'GC');
  DECLARE @Pr INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'PR');
  IF NOT EXISTS (SELECT 1 FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany AND is_example = 1)
  BEGIN
    INSERT INTO [sgc].[responsible_matrix] (id_company, id_process_map, id_document_type, role, user_email, id_cargo, cargo_name, sort_order, is_active, is_example, updated_by, created_at, updated_at)
    OUTPUT N'responsible_matrix', CAST(inserted.id_responsible AS NVARCHAR(60)), N'matriz.fila_agregada',
           CONCAT(N'{"role":"', inserted.role, N'","cargo":"', inserted.cargo_name, N'","ejemplo":true}'), NULL, NULL
      INTO @Cambio (entity, entity_id, action, after_json, id_flow_process, id_flow_version)
    VALUES
      (@IdCompany, @Gc,  @Pr,  N'elaborador', NULL, NULL, N'Analista de Aseguramiento de Calidad', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, @Gc,  @Pr,  N'revisor',    NULL, NULL, N'Coordinador(a) de Aseguramiento de Calidad', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, NULL, NULL, N'revisor',    NULL, NULL, N'Jefe del área dueña del proceso', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME()),
      (@IdCompany, NULL, NULL, N'aprobador',  NULL, NULL, N'Director(a) Técnico(a)', 1, 1, 1, @Actor, SYSUTCDATETIME(), SYSUTCDATETIME());
  END

  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, after_json)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor, c.entity, c.entity_id, c.id_flow_process, c.id_flow_version, c.action, @Motivo, c.after_json FROM @Cambio c;

  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor,
         CASE WHEN c.entity LIKE N'flow%' THEN CASE WHEN c.action = N'version.publicada' THEN N'flujo.publicado' ELSE N'flujo.configurado' END
              WHEN c.entity = N'responsible_matrix' THEN N'matriz.editada'
              ELSE N'autorizacion.configurada' END,
         c.entity, c.entity_id, c.after_json, @Motivo
  FROM @Cambio c;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, p.code, p.name, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version) AS campos
FROM [sgc].[flow_process] p JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_company = @IdCompany;
SELECT 'despues' AS momento, t.code, t.name, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany;
SELECT 'despues' AS momento, COUNT(*) AS filas_matriz FROM [sgc].[responsible_matrix] WHERE id_company = @IdCompany;
