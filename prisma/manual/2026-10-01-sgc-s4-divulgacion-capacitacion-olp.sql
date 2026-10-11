/*
  PASE MANUAL — SGC documental, Sprint 4: flujo documental de One Latam
  Pharma con los pasos 4 (Divulgación con lectura obligatoria firmada) y 5
  (Capacitación) HABILITADOS (datos). Autorizado por Nicolás Rivera el
  2026-09-30 (plan del SGC documental de OLP, ejecución sprint por sprint
  hasta testing).

  PRERREQUISITO: migración 20261001000000_sgc_s4_divulgacion_capacitacion_vigencia
  aplicada y el flujo DOC del S3 (con la lista de chequeo de Calidad) vigente.

  QUÉ HACE (idempotente; si la versión vigente de DOC ya tiene la divulgación
  habilitada, no hace nada):
    1. Crea la versión N+1 del flujo DOC como COPIA de la vigente (tareas,
       transiciones y campos) y en ella:
         - «divulgacion»: asignación «alcance» (cada persona del alcance firma
           su lectura), habilitada; la administra el grupo SGC-VERIF-CALIDAD;
         - «capacitacion»: habilitada (grupo de Calidad, firma «Capacitó»);
         - agrega «cancelar» desde divulgación y capacitación (solo Calidad
           lo puede usar; la versión aprobada se anula y nunca llega a vigente).
       Es la misma definición que SGC_DOCUMENT_FLOW_V3 de
       lib/sgc/flows/documentFlow.ts (una prueba de integración lo verifica).
    2. La publica: la anterior queda RETIRADA. Las solicitudes en curso siguen
       con la versión con la que arrancaron (las que ya estaban «en espera» en
       la divulgación de una versión anterior siguen en espera: se cancelan y
       se vuelven a pedir si hace falta).
  Queda en sgc.config_change_log y en sgc.audit_log, con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-10-01-sgc-s4-divulgacion-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 4: se habilitan la Divulgación (lectura obligatoria hasta el final y firma «Leyó» de cada persona del alcance) y la Capacitación (sesión o video, evaluación de Microsoft Forms y firma «Capacitó»); al terminar, la versión pasa a vigente y la anterior a obsoleta. En estos pasos solo Calidad cancela.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51030, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;

DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51031, N'El flujo DOC no tiene versión vigente.', 1;

SELECT 'antes' AS momento, v.version_number, v.status,
  (SELECT TOP 1 CONCAT(t.assignment, N'/', CAST(t.is_enabled AS NVARCHAR(1))) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'divulgacion') AS divulgacion,
  (SELECT TOP 1 CAST(t.is_enabled AS NVARCHAR(1)) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'capacitacion') AS capacitacion
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion' AND assignment = N'alcance' AND is_enabled = 1)
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

    UPDATE [sgc].[flow_task_def]
      SET assignment = N'alcance', multi_assignee = 0, signing_mode_default = NULL, is_enabled = 1, is_authorization = 0, authorization_type_code = NULL,
          pool_authorization_type_code = N'SGC-VERIF-CALIDAD', signature_meaning = N'leyo',
          description = N'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance (departamentos, cargos, personas o toda la empresa). La administra Aseguramiento de Calidad.'
      WHERE id_flow_version = @IdVersion AND task_key = N'divulgacion';
    UPDATE [sgc].[flow_task_def]
      SET is_enabled = 1,
          description = N'Sesión o video y evaluación en Microsoft Forms; Calidad carga el Excel de resultados (nota mínima configurable) y firma «Capacitó». Obligatoria para todos los tipos documentales.'
      WHERE id_flow_version = @IdVersion AND task_key = N'capacitacion';

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, to_task_key, terminal_status FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, x.from_task_key, N'cancelar', NULL, N'cancelada'
    FROM (VALUES (N'divulgacion'), (N'capacitacion')) AS x (from_task_key)
    WHERE NOT EXISTS (SELECT 1 FROM [sgc].[flow_transition] t WHERE t.id_flow_version = @IdVersion AND t.from_task_key = x.from_task_key AND t.action = N'cancelar');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    DECLARE @After NVARCHAR(MAX) = CONCAT(N'{"vigente":', @Number, N',"cambios":["Tarea Divulgación (divulgacion) cambió: assignment, isEnabled, description.","Tarea Capacitación (capacitacion) cambió: isEnabled, description.","Transición agregada: divulgacion:cancelar->cancelada.","Transición agregada: capacitacion:cancelar->cancelada."]}');
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
  (SELECT TOP 1 CONCAT(t.assignment, N'/', CAST(t.is_enabled AS NVARCHAR(1))) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'divulgacion') AS divulgacion,
  (SELECT TOP 1 CAST(t.is_enabled AS NVARCHAR(1)) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'capacitacion') AS capacitacion
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
