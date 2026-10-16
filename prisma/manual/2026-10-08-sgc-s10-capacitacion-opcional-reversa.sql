/*
  REVERSA de la migración 20261008120000_sgc_s10_capacitacion_opcional (SGC,
  Sprint 10) y del flujo con capacitación previa
  (prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql). Se
  corre ANTES que la del Sprint 9.

  1. FLUJO: si la versión VIGENTE de DOC tiene la «Preparación de la
     capacitación», se publica una versión NUEVA igual a la anterior (sin esa
     tarea y con la condición del tipo documental); nunca se borra ni se edita
     una versión. Las solicitudes en curso con la versión del S10 deben
     cerrarse o cancelarse ANTES: si hay alguna abierta, la reversa se niega,
     salvo sgc_reversa_flujo_s10 = 1 (Calidad las cancela después).
  2. ESQUEMA: quita la tabla retraining (y su trigger) y las columnas nuevas
     de request, training y training_result (con sus CHECK y DEFAULT) y borra
     el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior. ⚠️ Se
  pierden la sugerencia/confirmación de capacitación de cada solicitud, el
  proveedor y los intentos de cada capacitación, el intento que contó y las
  recapacitaciones: exportarlos antes. Si hay recapacitaciones registradas la
  reversa se niega, salvo sgc_reversa_recapacitaciones = 1.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
  Para otra empresa: cambiar @IdCompany.
*/

SET XACT_ABORT ON;
DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'reversa-s10';

DECLARE @recap INT = 0;
IF OBJECT_ID(N'[sgc].[retraining]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[retraining]', N'@n INT OUTPUT', @n = @recap OUTPUT;
IF @recap > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_recapacitaciones') AS INT) IS NULL
  THROW 51081, N'Hay recapacitaciones registradas: exporte sgc.retraining y declare sgc_reversa_recapacitaciones = 1 antes de la reversa.', 1;

/* 1. Flujo: versión nueva sin la preparación de la capacitación. */
DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NOT NULL AND EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'preparacion_capacitacion')
BEGIN
  IF EXISTS (SELECT 1 FROM [sgc].[request] r JOIN [sgc].[flow_task_def] t ON t.id_flow_version = r.id_flow_version AND t.task_key = N'preparacion_capacitacion' WHERE r.status IN (N'abierta', N'en_espera'))
     AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_flujo_s10') AS INT) IS NULL
    THROW 51082, N'Hay solicitudes abiertas con el flujo de capacitación previa: ciérrelas o declare sgc_reversa_flujo_s10 = 1 (y cancélelas después).', 1;
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
  DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
  DECLARE @Motivo NVARCHAR(1000) = N'Reversa del Sprint 10: se retira la preparación de la capacitación antes de la divulgación; la capacitación vuelve a depender del tipo documental.';
  UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;
  DECLARE @IdVersion INT;
  INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
  VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
  SET @IdVersion = SCOPE_IDENTITY();
  INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
  SELECT @IdVersion, task_key, name,
         CASE WHEN task_key IN (N'divulgacion', N'capacitacion') THEN step_order - 1 ELSE step_order END,
         role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days,
         CASE WHEN condition_key = N'requiere_capacitacion' THEN N'tipo_exige_capacitacion' ELSE condition_key END,
         is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description
  FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key <> N'preparacion_capacitacion';
  INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
  SELECT @IdVersion, from_task_key, action, CASE WHEN to_task_key = N'preparacion_capacitacion' THEN N'divulgacion' ELSE to_task_key END, terminal_status
  FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev AND from_task_key <> N'preparacion_capacitacion';
  INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
  SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev AND (task_key IS NULL OR task_key <> N'preparacion_capacitacion');
  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
  VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'), CONCAT(N'{"vigente":', @Number, N',"cambios":["Tarea retirada: preparacion_capacitacion."]}'));
  COMMIT TRANSACTION;
END;

/* 2. Esquema. */
EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008120000_sgc_s10_capacitacion_opcional';

IF OBJECT_ID(N'[sgc].[retraining_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[retraining_solo_insercion];
IF OBJECT_ID(N'[sgc].[retraining]', N'U') IS NOT NULL
  DROP TABLE [sgc].[retraining];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck')
  ALTER TABLE [sgc].[training] DROP CONSTRAINT [training_intentos_proveedor_ck];
DECLARE @df SYSNAME;
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[training]') AND c.name = N'max_attempts');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[training] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.training', N'max_attempts') IS NOT NULL ALTER TABLE [sgc].[training] DROP COLUMN [max_attempts];
IF COL_LENGTH(N'sgc.training', N'evaluation_provider') IS NOT NULL ALTER TABLE [sgc].[training] DROP COLUMN [evaluation_provider];

SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[training_result]') AND c.name = N'extra_attempts');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[training_result] DROP CONSTRAINT [' + @df + N']');
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[training_result]') AND c.name = N'retraining_required');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[training_result] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.training_result', N'attempt_number') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [attempt_number];
IF COL_LENGTH(N'sgc.training_result', N'extra_attempts') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [extra_attempts];
IF COL_LENGTH(N'sgc.training_result', N'retraining_required') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [retraining_required];

IF COL_LENGTH(N'sgc.request', N'requires_training_suggested') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [requires_training_suggested];
IF COL_LENGTH(N'sgc.request', N'requires_training') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [requires_training];
IF COL_LENGTH(N'sgc.request', N'training_confirmed_by') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [training_confirmed_by];
IF COL_LENGTH(N'sgc.request', N'training_confirmed_at') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [training_confirmed_at];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008120000_sgc_s10_capacitacion_opcional';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
