/*
  PASE MANUAL — SGC documental, Sprint 3: flujo documental v2 de One Latam
  Pharma con la LISTA DE CHEQUEO de estructura documental de Calidad dentro
  de la Aprobación (datos). Autorizado por Nicolás Rivera el 2026-09-30 (plan
  del SGC documental de OLP, ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930230000_sgc_s3_firma_pdf_calidad aplicada y
  el flujo DOC v1 del S2 sembrado.

  QUÉ HACE (idempotente; si la versión vigente de DOC ya tiene lista de
  chequeo, no hace nada):
    1. Crea la versión N+1 del flujo DOC como COPIA de la vigente (tareas,
       transiciones y campos) y le agrega 3 puntos de chequeo de Calidad en la
       tarea «aprobacion» (campos con quality_check = 1): codificación,
       formato y anexos. Es la misma definición que SGC_DOCUMENT_FLOW_V2 de
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    2. La publica: la anterior queda RETIRADA (las solicitudes en curso
       siguen con la versión con la que arrancaron).
  Queda en sgc.config_change_log y en sgc.audit_log, con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 3: lista de chequeo de estructura documental de Calidad (codificación, formato y anexos) dentro de la Aprobación, como formulario configurable del flujo. Supuesto a validar con Calidad.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51010, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;

DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51011, N'El flujo DOC no tiene versión vigente.', 1;

SELECT 'antes' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1) AS puntos_chequeo
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev AND quality_check = 1)
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
    DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, to_task_key, terminal_status FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, N'aprobacion', x.field_key, x.label, N'si_no', x.required, NULL, x.help_text, x.sort_order, 1
    FROM (VALUES
      (N'chk_codificacion', N'Codificación conforme a la guía de codificación', 1, N'Código, versión y tipo documental según la guía de la empresa.', 10),
      (N'chk_formato', N'Formato institucional (encabezado, estructura y numeración)', 1, N'Plantilla vigente, secciones obligatorias y paginación.', 11),
      (N'chk_anexos', N'Anexos y formatos relacionados completos y referenciados', 0, N'Si el documento no tiene anexos, marque «No aplica».', 12)
    ) AS x (field_key, label, required, help_text, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = @IdVersion AND f.task_key = N'aprobacion' AND f.field_key = x.field_key);

    DECLARE @After NVARCHAR(MAX) = CONCAT(N'{"vigente":', @Number, N',"cambios":["Campo agregado: Codificación conforme a la guía de codificación (aprobacion.chk_codificacion).","Campo agregado: Formato institucional (encabezado, estructura y numeración) (aprobacion.chk_formato).","Campo agregado: Anexos y formatos relacionados completos y referenciados (aprobacion.chk_anexos)."]}');
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'), @After);

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N'}'), @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version) AS campos,
  (SELECT COUNT(*) FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1) AS puntos_chequeo
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
