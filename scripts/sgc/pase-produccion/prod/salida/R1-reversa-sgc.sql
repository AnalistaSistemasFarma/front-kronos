/*
  PASE SGC · R1 · REVERSA DEL SGC (datos y esquema sgc)
  Generado por scripts/sgc/pase-produccion/prod/armar-consolidado.mjs el 2026-10-10.
  Base esperada: KRONOSDB en SERFARMA03 (cada lote empieza con una guardia que hace THROW si no coincide).
  Correr SOLO con aplicar-sql.mjs (se detiene en el primer error) y con la autorización del pase.
  SIN --acepto-perdidas: una reversa con datos que perder se DETIENE (THROW).
  No toca dbo.scheduled_job/_run (existen en KRONOSDB desde antes del SGC): la reversa del S5 solo quita el job sgc_review_alerts.
  La app vieja no usa el esquema sgc: R1 solo hace falta si se abandona el SGC; para volver al código anterior basta R2.
*/
SET NOCOUNT ON;
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s13-firma-propia-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s13-firma-propia-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261008150000_sgc_s13_firma_propia_registro (SGC,
  Sprint 13). Se corre ANTES que la del Sprint 12.

  Quita el trigger signature_master_validacion_una_vez, el CHECK y las
  columnas origin, capture_method, validation_status, validated_by y
  validated_at de signature_master y self_signature_enabled de company_config,
  y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Las firmas PROPIAS (registradas por su titular) se REVOCAN antes de
  quitar las columnas: sin la columna de validación, una firma pendiente
  quedaría como si estuviera validada. Si hay firmas propias, la reversa se
  niega salvo sgc_reversa_firma_propia = 1 en la sesión. Las firmas ya
  estampadas en documentos no cambian (su huella está en sgc.signature).

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @propias INT = 0;
IF COL_LENGTH(N''sgc.signature_master'', N''origin'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[signature_master] WHERE [origin] = N''''propia'''''', N''@n INT OUTPUT'', @n = @propias OUTPUT;
IF @propias > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_firma_propia'') AS INT) IS NULL
  THROW 51111, N''Hay firmas propias registradas por su titular: exporte el maestro y declare sgc_reversa_firma_propia = 1 antes de la reversa (se revocarán).'', 1;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008150000_sgc_s13_firma_propia_registro'';

IF OBJECT_ID(N''[sgc].[signature_master_validacion_una_vez]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signature_master_validacion_una_vez];
IF COL_LENGTH(N''sgc.signature_master'', N''origin'') IS NOT NULL
  EXEC sp_executesql N''UPDATE [sgc].[signature_master] SET revoked_at = SYSUTCDATETIME(), revoked_by = N''''reversa-s13'''', revoke_reason = N''''Reversa del Sprint 13: se retira la firma propia.'''' WHERE [origin] = N''''propia'''' AND revoked_at IS NULL'';
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''signature_master_firma_propia_ck'')
  ALTER TABLE [sgc].[signature_master] DROP CONSTRAINT [signature_master_firma_propia_ck];

DECLARE @tbl SYSNAME;
DECLARE @col SYSNAME;
DECLARE @df SYSNAME;
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR SELECT t, c FROM (VALUES (N''signature_master'', N''origin''), (N''signature_master'', N''capture_method''), (N''signature_master'', N''validation_status''), (N''signature_master'', N''validated_by''), (N''signature_master'', N''validated_at''), (N''company_config'', N''self_signature_enabled'')) AS x(t, c);
OPEN cols;
FETCH NEXT FROM cols INTO @tbl, @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].['' + @tbl + N'']'') AND c.name = @col);
  IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].['' + @tbl + N''] DROP CONSTRAINT ['' + @df + N'']'');
  IF COL_LENGTH(N''sgc.'' + @tbl, @col) IS NOT NULL EXEC (N''ALTER TABLE [sgc].['' + @tbl + N''] DROP COLUMN ['' + @col + N'']'');
  FETCH NEXT FROM cols INTO @tbl, @col;
END;
CLOSE cols;
DEALLOCATE cols;

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008150000_sgc_s13_firma_propia_registro'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s13-firma-propia-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261008140000_sgc_s12_aprobadores_sustitutos (SGC,
  Sprint 12) y de su dato (tipo de autorización SGC-SUSTITUTOS, que se
  DESACTIVA, no se borra). Se corre ANTES que la del Sprint 11.

  Quita las tablas approver_authorization y signer_substitution (con sus
  triggers), la columna task_assignee.on_behalf_of y la columna
  company_config.approver_list_enforced (con su DEFAULT), y borra el registro
  de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Se pierde la LISTA de aprobadores autorizados y el HISTORIAL de
  sustituciones (exportarlos antes). Si hay alguna de las dos, la reversa se
  niega, salvo sgc_reversa_sustitutos = 1 en la sesión.
  ⚠️ signature.on_behalf_of SOLO se quita si ninguna firma la usa: una firma
  hecha por un sustituto lleva «en sustitución de» dentro de su registro
  encadenado (record_hash). Borrar ese dato haría ver la firma como alterada,
  así que en ese caso la columna SE CONSERVA (es nullable y el código anterior
  no la lee) y la reversa lo informa.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @datos INT = 0;
IF OBJECT_ID(N''[sgc].[approver_authorization]'', N''U'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[approver_authorization]'', N''@n INT OUTPUT'', @n = @datos OUTPUT;
DECLARE @sust INT = 0;
IF OBJECT_ID(N''[sgc].[signer_substitution]'', N''U'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[signer_substitution]'', N''@n INT OUTPUT'', @n = @sust OUTPUT;
IF (@datos + @sust) > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_sustitutos'') AS INT) IS NULL
  THROW 51102, N''Hay aprobadores autorizados o sustituciones de firmantes: exporte la lista y el historial y declare sgc_reversa_sustitutos = 1 antes de la reversa.'', 1;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008140000_sgc_s12_aprobadores_sustitutos'';

UPDATE [sgc].[authorization_type] SET [is_active] = 0, [updated_by] = N''reversa-s12'', [updated_at] = SYSUTCDATETIME() WHERE [code] = N''SGC-SUSTITUTOS'' AND [is_active] = 1;

IF OBJECT_ID(N''[sgc].[signer_substitution_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signer_substitution_solo_insercion];
IF OBJECT_ID(N''[sgc].[signer_substitution]'', N''U'') IS NOT NULL DROP TABLE [sgc].[signer_substitution];
IF OBJECT_ID(N''[sgc].[approver_authorization_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[approver_authorization_sin_borrado];
IF OBJECT_ID(N''[sgc].[approver_authorization]'', N''U'') IS NOT NULL DROP TABLE [sgc].[approver_authorization];

IF COL_LENGTH(N''sgc.task_assignee'', N''on_behalf_of'') IS NOT NULL
  ALTER TABLE [sgc].[task_assignee] DROP COLUMN [on_behalf_of];

DECLARE @firmasSust INT = 0;
IF COL_LENGTH(N''sgc.signature'', N''on_behalf_of'') IS NOT NULL
BEGIN
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[signature] WHERE [on_behalf_of] IS NOT NULL'', N''@n INT OUTPUT'', @n = @firmasSust OUTPUT;
  IF @firmasSust = 0
    ALTER TABLE [sgc].[signature] DROP COLUMN [on_behalf_of];
  ELSE
    PRINT CONCAT(N''AVISO: se CONSERVA sgc.signature.on_behalf_of: '', @firmasSust, N'' firma(s) de sustitutos la llevan en su registro encadenado.'');
END;

DECLARE @df SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = N''approver_list_enforced'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.company_config'', N''approver_list_enforced'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [approver_list_enforced];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008140000_sgc_s12_aprobadores_sustitutos'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261008130000_sgc_s11_copias_no_controladas (SGC,
  Sprint 11) y de su dato (tipo de autorización SGC-COPIA-NC, que se
  DESACTIVA, no se borra). Se corre ANTES que la del Sprint 10.

  Quita las tablas uncontrolled_copy_request y uncontrolled_copy_event (con
  sus triggers) y las columnas nuevas de company_config (con sus CHECK y
  DEFAULT), y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior. ⚠️ Se
  pierde el HISTORIAL de copias no controladas (quién, cuándo, por qué, quién
  autorizó y cada impresión): exportarlo antes. Si hay alguna solicitud la
  reversa se niega, salvo sgc_reversa_copias = 1 en la sesión.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @copias INT = 0;
IF OBJECT_ID(N''[sgc].[uncontrolled_copy_request]'', N''U'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[uncontrolled_copy_request]'', N''@n INT OUTPUT'', @n = @copias OUTPUT;
IF @copias > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_copias'') AS INT) IS NULL
  THROW 51092, N''Hay solicitudes de copias no controladas: exporte su historial y declare sgc_reversa_copias = 1 antes de la reversa.'', 1;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008130000_sgc_s11_copias_no_controladas'';

UPDATE [sgc].[authorization_type] SET [is_active] = 0, [updated_by] = N''reversa-s11'', [updated_at] = SYSUTCDATETIME() WHERE [code] = N''SGC-COPIA-NC'' AND [is_active] = 1;

IF OBJECT_ID(N''[sgc].[uncontrolled_copy_event_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[uncontrolled_copy_event_solo_insercion];
IF OBJECT_ID(N''[sgc].[uncontrolled_copy_event]'', N''U'') IS NOT NULL DROP TABLE [sgc].[uncontrolled_copy_event];
IF OBJECT_ID(N''[sgc].[uncontrolled_copy_request_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[uncontrolled_copy_request_sin_borrado];
IF OBJECT_ID(N''[sgc].[uncontrolled_copy_request]'', N''U'') IS NOT NULL DROP TABLE [sgc].[uncontrolled_copy_request];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''company_config_copias_ck'')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_copias_ck];
DECLARE @col SYSNAME;
DECLARE @df SYSNAME;
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (N''uncontrolled_copy_types''), (N''uncontrolled_copy_days''), (N''uncontrolled_copy_max_days''), (N''viewer_protection'')) AS x(name);
OPEN cols;
FETCH NEXT FROM cols INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = @col);
  IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df + N'']'');
  IF COL_LENGTH(N''sgc.company_config'', @col) IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP COLUMN ['' + @col + N'']'');
  FETCH NEXT FROM cols INTO @col;
END;
CLOSE cols;
DEALLOCATE cols;

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008130000_sgc_s11_copias_no_controladas'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s11-copias-no-controladas-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
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
DECLARE @Actor NVARCHAR(255) = N''reversa-s10'';

DECLARE @recap INT = 0;
IF OBJECT_ID(N''[sgc].[retraining]'', N''U'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[retraining]'', N''@n INT OUTPUT'', @n = @recap OUTPUT;
IF @recap > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_recapacitaciones'') AS INT) IS NULL
  THROW 51081, N''Hay recapacitaciones registradas: exporte sgc.retraining y declare sgc_reversa_recapacitaciones = 1 antes de la reversa.'', 1;

/* 1. Flujo: versión nueva sin la preparación de la capacitación. */
DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N''DOC'');
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N''vigente'');
IF @Prev IS NOT NULL AND EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N''preparacion_capacitacion'')
BEGIN
  IF EXISTS (SELECT 1 FROM [sgc].[request] r JOIN [sgc].[flow_task_def] t ON t.id_flow_version = r.id_flow_version AND t.task_key = N''preparacion_capacitacion'' WHERE r.status IN (N''abierta'', N''en_espera''))
     AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_flujo_s10'') AS INT) IS NULL
    THROW 51082, N''Hay solicitudes abiertas con el flujo de capacitación previa: ciérrelas o declare sgc_reversa_flujo_s10 = 1 (y cancélelas después).'', 1;
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
  DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
  DECLARE @Motivo NVARCHAR(1000) = N''Reversa del Sprint 10: se retira la preparación de la capacitación antes de la divulgación; la capacitación vuelve a depender del tipo documental.'';
  UPDATE [sgc].[flow_version] SET status = N''retirada'', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;
  DECLARE @IdVersion INT;
  INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
  VALUES (@IdProcess, @Number, N''vigente'', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
  SET @IdVersion = SCOPE_IDENTITY();
  INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
  SELECT @IdVersion, task_key, name,
         CASE WHEN task_key IN (N''divulgacion'', N''capacitacion'') THEN step_order - 1 ELSE step_order END,
         role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days,
         CASE WHEN condition_key = N''requiere_capacitacion'' THEN N''tipo_exige_capacitacion'' ELSE condition_key END,
         is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description
  FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key <> N''preparacion_capacitacion'';
  INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
  SELECT @IdVersion, from_task_key, action, CASE WHEN to_task_key = N''preparacion_capacitacion'' THEN N''divulgacion'' ELSE to_task_key END, terminal_status
  FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev AND from_task_key <> N''preparacion_capacitacion'';
  INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
  SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev AND (task_key IS NULL OR task_key <> N''preparacion_capacitacion'');
  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
  VALUES (@IdCompany, @Now, @Actor, N''flow_version'', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N''version.publicada'', @Motivo, CONCAT(N''{"vigente":'', @PrevNumber, N''}''), CONCAT(N''{"vigente":'', @Number, N'',"cambios":["Tarea retirada: preparacion_capacitacion."]}''));
  COMMIT TRANSACTION;
END;

/* 2. Esquema. */
EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008120000_sgc_s10_capacitacion_opcional'';

IF OBJECT_ID(N''[sgc].[retraining_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[retraining_solo_insercion];
IF OBJECT_ID(N''[sgc].[retraining]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[retraining];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''training_intentos_proveedor_ck'')
  ALTER TABLE [sgc].[training] DROP CONSTRAINT [training_intentos_proveedor_ck];
DECLARE @df SYSNAME;
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[training]'') AND c.name = N''max_attempts'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[training] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.training'', N''max_attempts'') IS NOT NULL ALTER TABLE [sgc].[training] DROP COLUMN [max_attempts];
IF COL_LENGTH(N''sgc.training'', N''evaluation_provider'') IS NOT NULL ALTER TABLE [sgc].[training] DROP COLUMN [evaluation_provider];

SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[training_result]'') AND c.name = N''extra_attempts'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[training_result] DROP CONSTRAINT ['' + @df + N'']'');
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[training_result]'') AND c.name = N''retraining_required'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[training_result] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.training_result'', N''attempt_number'') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [attempt_number];
IF COL_LENGTH(N''sgc.training_result'', N''extra_attempts'') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [extra_attempts];
IF COL_LENGTH(N''sgc.training_result'', N''retraining_required'') IS NOT NULL ALTER TABLE [sgc].[training_result] DROP COLUMN [retraining_required];

IF COL_LENGTH(N''sgc.request'', N''requires_training_suggested'') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [requires_training_suggested];
IF COL_LENGTH(N''sgc.request'', N''requires_training'') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [requires_training];
IF COL_LENGTH(N''sgc.request'', N''training_confirmed_by'') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [training_confirmed_by];
IF COL_LENGTH(N''sgc.request'', N''training_confirmed_at'') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [training_confirmed_at];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008120000_sgc_s10_capacitacion_opcional'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261008110000_sgc_s9_archivos_relaciones_correo
  (SGC, Sprint 9: carga masiva de PDF, relaciones propuestas, cierre de la
  carga inicial y política de correo). Se corre ANTES que la del Sprint 8.

  Deja el esquema `sgc` como estaba al cerrar el Sprint 8: quita las tablas
  bulk_upload y bulk_upload_item (con sus triggers), las columnas nuevas de
  document_relation y company_config (con sus CHECK y DEFAULT) y borra el
  registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Las relaciones PROPUESTAS (aún sin confirmar) quedarían visibles como si
  estuvieran confirmadas: la reversa las RETIRA (is_active = 0, con motivo)
  antes de quitar la columna. Si hay alguna, exige declarar
  sgc_reversa_propuestas = 1 en la sesión. Exportar antes sgc.bulk_upload y
  sgc.bulk_upload_item si se necesitan como evidencia (los documentos y sus
  versiones cargados por la carga masiva NO se tocan).
  ⚠️ El cierre de la carga inicial vive en columnas del Sprint 8: no se revierte aquí.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @propuestas INT = 0;
IF COL_LENGTH(N''sgc.document_relation'', N''status'') IS NOT NULL
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[document_relation] WHERE [status] = N''''propuesta'''' AND [is_active] = 1'', N''@n INT OUTPUT'', @n = @propuestas OUTPUT;
IF @propuestas > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_propuestas'') AS INT) IS NULL
  THROW 51072, N''Hay relaciones propuestas sin confirmar: declare sgc_reversa_propuestas = 1 para retirarlas antes de la reversa.'', 1;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008110000_sgc_s9_archivos_relaciones_correo'';

IF @propuestas > 0
  EXEC sp_executesql N''UPDATE [sgc].[document_relation] SET [is_active] = 0, [removed_by] = N''''reversa-s9'''', [removed_at] = SYSUTCDATETIME(), [remove_reason] = N''''Reversa del Sprint 9: relación propuesta sin confirmar.'''' WHERE [status] = N''''propuesta'''' AND [is_active] = 1;'';

IF OBJECT_ID(N''[sgc].[bulk_upload_item_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[bulk_upload_item_solo_insercion];
IF OBJECT_ID(N''[sgc].[bulk_upload_item]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[bulk_upload_item];
IF OBJECT_ID(N''[sgc].[bulk_upload_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[bulk_upload_solo_insercion];
IF OBJECT_ID(N''[sgc].[bulk_upload]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[bulk_upload];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''document_relation_origen_estado_ck'')
  ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [document_relation_origen_estado_ck];
DECLARE @df SYSNAME;
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[document_relation]'') AND c.name = N''origin'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT ['' + @df + N'']'');
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[document_relation]'') AND c.name = N''status'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.document_relation'', N''origin'') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [origin];
IF COL_LENGTH(N''sgc.document_relation'', N''status'') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [status];
IF COL_LENGTH(N''sgc.document_relation'', N''confirmed_by'') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [confirmed_by];
IF COL_LENGTH(N''sgc.document_relation'', N''confirmed_at'') IS NOT NULL ALTER TABLE [sgc].[document_relation] DROP COLUMN [confirmed_at];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''company_config_email_mode_ck'')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_email_mode_ck];
SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = N''email_mode'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.company_config'', N''email_mode'') IS NOT NULL ALTER TABLE [sgc].[company_config] DROP COLUMN [email_mode];
IF COL_LENGTH(N''sgc.company_config'', N''email_digest_last_date'') IS NOT NULL ALTER TABLE [sgc].[company_config] DROP COLUMN [email_digest_last_date];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008110000_sgc_s9_archivos_relaciones_correo'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261008100000_sgc_s8_encabezado_listado_maestro
  (SGC, Sprint 8: encabezado obligatorio, carga inicial, herencia del número
  del padre y listado maestro) y de su dato opcional
  (prisma/manual/2026-10-08-sgc-s8-guia-codificacion-olp.sql).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 7: quita las tablas
  master_list_import y master_list_import_row (con sus triggers), la columna
  request.id_parent_document (con su FK), las columnas nuevas de
  company_config y coding_guide (con sus CHECK y DEFAULT), devuelve el CHECK
  de estado del documento al del Sprint 1 y borra el registro de la migración
  en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior (Prisma lee
  estas columnas). ⚠️ Los documentos «pendientes de archivo» (importados del
  listado maestro sin PDF) NO caben en el CHECK anterior: la reversa se niega
  a correr si existe alguno, salvo que se declare
  sgc_reversa_pendientes_archivo = 1 en la sesión, y en ese caso los pasa a
  «anulado» con su motivo (no se borra ningún documento). También se niega si
  hay solicitudes con documento padre (se perdería con quién heredan el
  número), salvo sgc_reversa_padres = 1. Exportar antes sgc.master_list_import
  y sgc.master_list_import_row si se necesitan como evidencia.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

IF COL_LENGTH(N''sgc.request'', N''id_parent_document'') IS NOT NULL
   AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_padres'') AS INT) IS NULL
BEGIN
  DECLARE @padres INT;
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[request] WHERE [id_parent_document] IS NOT NULL'', N''@n INT OUTPUT'', @n = @padres OUTPUT;
  IF @padres > 0
    THROW 51062, N''Hay solicitudes con documento padre: exporte sgc.request (id_request, id_parent_document) y declare sgc_reversa_padres = 1 antes de la reversa.'', 1;
END;

DECLARE @pendientes INT = (SELECT COUNT(*) FROM [sgc].[document] WHERE [status] = N''pendiente_archivo'');
IF @pendientes > 0 AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_pendientes_archivo'') AS INT) IS NULL
  THROW 51063, N''Hay documentos pendientes de archivo (listado maestro): exporte el listado y declare sgc_reversa_pendientes_archivo = 1 para anularlos antes de la reversa.'', 1;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261008100000_sgc_s8_encabezado_listado_maestro'';

IF @pendientes > 0
BEGIN
  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
  SELECT id_company, SYSUTCDATETIME(), N''reversa-s8'', N''documento.anulacion'', N''document'', CAST(id_document AS NVARCHAR(60)), N''{"status":"pendiente_archivo"}'', N''{"status":"anulado"}'', N''Reversa del Sprint 8: el documento importado del listado maestro sin PDF se anula.''
  FROM [sgc].[document] WHERE [status] = N''pendiente_archivo'';
  UPDATE [sgc].[document] SET [status] = N''anulado'', [annulled_by] = N''reversa-s8'', [annulled_at] = SYSUTCDATETIME(), [annul_reason] = N''Reversa del Sprint 8: documento del listado maestro sin PDF.'', [updated_at] = SYSUTCDATETIME() WHERE [status] = N''pendiente_archivo'';
END;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''document_status_ck'' AND definition LIKE N''%pendiente_archivo%'')
  ALTER TABLE [sgc].[document] DROP CONSTRAINT [document_status_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''document_status_ck'')
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_status_ck] CHECK ([status] IN (N''borrador'', N''vigente'', N''obsoleto'', N''anulado''));

IF OBJECT_ID(N''[sgc].[master_list_import_row_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[master_list_import_row_solo_insercion];
IF OBJECT_ID(N''[sgc].[master_list_import_row]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[master_list_import_row];
IF OBJECT_ID(N''[sgc].[master_list_import_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[master_list_import_solo_insercion];
IF OBJECT_ID(N''[sgc].[master_list_import]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[master_list_import];

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N''request_id_parent_document_fkey'')
  ALTER TABLE [sgc].[request] DROP CONSTRAINT [request_id_parent_document_fkey];
IF COL_LENGTH(N''sgc.request'', N''id_parent_document'') IS NOT NULL
  ALTER TABLE [sgc].[request] DROP COLUMN [id_parent_document];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''coding_guide_herencia_ck'')
  ALTER TABLE [sgc].[coding_guide] DROP CONSTRAINT [coding_guide_herencia_ck];
IF COL_LENGTH(N''sgc.coding_guide'', N''child_pattern'') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_pattern];
IF COL_LENGTH(N''sgc.coding_guide'', N''child_type_codes'') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_type_codes];
IF COL_LENGTH(N''sgc.coding_guide'', N''child_sequence_digits'') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_sequence_digits];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''company_config_carga_inicial_ck'')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_carga_inicial_ck];
DECLARE @df1 SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = N''header_mandatory'');
IF @df1 IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df1 + N'']'');
DECLARE @df2 SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = N''initial_load_open'');
IF @df2 IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df2 + N'']'');
IF COL_LENGTH(N''sgc.company_config'', N''header_mandatory'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [header_mandatory];
IF COL_LENGTH(N''sgc.company_config'', N''initial_load_open'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_open];
IF COL_LENGTH(N''sgc.company_config'', N''initial_load_closed_by'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_closed_by];
IF COL_LENGTH(N''sgc.company_config'', N''initial_load_closed_at'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_closed_at];
IF COL_LENGTH(N''sgc.company_config'', N''initial_load_close_reason'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_close_reason];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261008100000_sgc_s8_encabezado_listado_maestro'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-03-sgc-correcciones-calidad-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-03-sgc-correcciones-calidad-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261003120000_sgc_correcciones_calidad (SGC,
  correcciones de Calidad OLP del 2026-10-02) y de sus datos
  (prisma/manual/2026-10-03-sgc-correcciones-calidad-olp.sql).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 6: quita las tablas
  document_layout y read_threshold_notice (con sus triggers), las columnas
  nuevas de company_config, document_version y draft_revision (con sus CHECK y
  DEFAULT) y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior (Prisma lee
  estas columnas). ⚠️ Se pierden la ubicación de firmas, los avisos de umbral,
  el logo y los dominios configurados y el motivo de las revisiones menores:
  exportarlos antes si se necesitan como evidencia. Una revisión menor ya
  guardada queda como revisión normal (su motivo se pierde): por eso la reversa
  se niega a correr si existe alguna, salvo que se declare
  sgc_reversa_revisiones_menores = 1 en la sesión.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

IF COL_LENGTH(N''sgc.draft_revision'', N''minor_reason'') IS NOT NULL
   AND TRY_CAST(SESSION_CONTEXT(N''sgc_reversa_revisiones_menores'') AS INT) IS NULL
BEGIN
  DECLARE @menores INT;
  EXEC sp_executesql N''SELECT @n = COUNT(*) FROM [sgc].[draft_revision] WHERE [minor_reason] IS NOT NULL'', N''@n INT OUTPUT'', @n = @menores OUTPUT;
  IF @menores > 0
    THROW 51052, N''Hay revisiones menores de Calidad registradas: exporte sgc.draft_revision y declare sgc_reversa_revisiones_menores = 1 antes de la reversa.'', 1;
END;

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261003120000_sgc_correcciones_calidad'';

IF OBJECT_ID(N''[sgc].[document_layout_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[document_layout_solo_insercion];
IF OBJECT_ID(N''[sgc].[document_layout]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[document_layout];

IF OBJECT_ID(N''[sgc].[read_threshold_notice_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[read_threshold_notice_solo_insercion];
IF OBJECT_ID(N''[sgc].[read_threshold_notice]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[read_threshold_notice];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''draft_revision_menor_ck'')
  ALTER TABLE [sgc].[draft_revision] DROP CONSTRAINT [draft_revision_menor_ck];
IF COL_LENGTH(N''sgc.draft_revision'', N''minor_reason'') IS NOT NULL
  ALTER TABLE [sgc].[draft_revision] DROP COLUMN [minor_reason];
IF COL_LENGTH(N''sgc.draft_revision'', N''base_sha256'') IS NOT NULL
  ALTER TABLE [sgc].[draft_revision] DROP COLUMN [base_sha256];

IF COL_LENGTH(N''sgc.document_version'', N''layout_json'') IS NOT NULL
  ALTER TABLE [sgc].[document_version] DROP COLUMN [layout_json];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''company_config_read_threshold_ck'')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_read_threshold_ck];
DECLARE @df SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N''[sgc].[company_config]'') AND c.name = N''read_threshold_pct'');
IF @df IS NOT NULL EXEC (N''ALTER TABLE [sgc].[company_config] DROP CONSTRAINT ['' + @df + N'']'');
IF COL_LENGTH(N''sgc.company_config'', N''read_threshold_pct'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [read_threshold_pct];
IF COL_LENGTH(N''sgc.company_config'', N''dissemination_domains'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [dissemination_domains];
IF COL_LENGTH(N''sgc.company_config'', N''logo_data_url'') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [logo_data_url];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261003120000_sgc_correcciones_calidad'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-03-sgc-correcciones-calidad-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-01-sgc-s6-endurecimiento-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-01-sgc-s6-endurecimiento-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de la migración 20261001200000_sgc_s6_endurecimiento (SGC, Sprint 6).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 5: quita el trigger de
  base de datos, el registro de cambios de estructura, la tabla de protección
  contra TRUNCATE/DROP, los índices únicos de la cadena de firmas y los tres
  índices de rendimiento, y borra el registro de la migración en
  _prisma_migrations. NO toca datos de negocio del SGC.

  Es un cambio controlado: declara la sesión antes de cada DROP (el trigger de
  protección rechaza DDL destructivo sin esa declaración).

  Correr ANTES que cualquier reversa de S1–S5. Idempotente.
  ⚠️ El contenido de sgc.ddl_event_log se pierde al quitar la tabla: exportarlo
  antes si se necesita como evidencia (el procedimiento de reversa lo exige).
*/

EXEC sp_set_session_context N''sgc_ddl_autorizado'', 1;
EXEC sp_set_session_context N''sgc_ddl_motivo'', N''Reversa de 20261001200000_sgc_s6_endurecimiento'';

IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = N''sgc_proteger_esquema'' AND parent_class = 0)
  DROP TRIGGER [sgc_proteger_esquema] ON DATABASE;

IF OBJECT_ID(N''[sgc].[ddl_event_log_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[ddl_event_log_solo_insercion];

IF OBJECT_ID(N''[sgc].[ddl_event_log]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[ddl_event_log];

IF OBJECT_ID(N''[sgc].[proteccion_registros]'', N''U'') IS NOT NULL
  DROP TABLE [sgc].[proteccion_registros];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N''signature_cadena_prev_uq'' AND object_id = OBJECT_ID(N''[sgc].[signature]''))
  DROP INDEX [signature_cadena_prev_uq] ON [sgc].[signature];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N''signature_cadena_genesis_uq'' AND object_id = OBJECT_ID(N''[sgc].[signature]''))
  DROP INDEX [signature_cadena_genesis_uq] ON [sgc].[signature];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N''IX_sgc_audit_log_actor_email_action_occurred_at'' AND object_id = OBJECT_ID(N''[sgc].[audit_log]''))
  DROP INDEX [IX_sgc_audit_log_actor_email_action_occurred_at] ON [sgc].[audit_log];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N''IX_sgc_request_id_document_status'' AND object_id = OBJECT_ID(N''[sgc].[request]''))
  DROP INDEX [IX_sgc_request_id_document_status] ON [sgc].[request];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N''IX_sgc_review_alert_id_document_version_alert_key'' AND object_id = OBJECT_ID(N''[sgc].[review_alert]''))
  DROP INDEX [IX_sgc_review_alert_id_document_version_alert_key] ON [sgc].[review_alert];

IF OBJECT_ID(N''[dbo].[_prisma_migrations]'', N''U'') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N''20261001200000_sgc_s6_endurecimiento'';

EXEC sp_set_session_context N''sgc_ddl_autorizado'', NULL;
EXEC sp_set_session_context N''sgc_ddl_motivo'', NULL;';
ELSE PRINT N'2026-10-01-sgc-s6-endurecimiento-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA — SGC documental, Sprint 5 (mapa de relaciones, vencimientos y
  accesos). Deshace la migración 20261001100000_sgc_s5_relaciones_vencimientos_accesos
  y los datos de prisma/manual/2026-10-01-sgc-s5-vencimientos-olp.sql. Deja el
  esquema `sgc` como quedó en el Sprint 4.

  ⚠️ BORRA las relaciones entre documentos, las posiciones del mapa, la
  configuración y el REGISTRO de avisos de vencimiento, los enlaces iCal y las
  solicitudes de acceso. Antes de correrla, exportar a JSON esas 6 tablas
  como evidencia (quedan en ~/.horus/rollbacks/). Solo con autorización de
  Nicolás. Idempotente.

  - Quita el job `sgc_review_alerts` del programador central (dbo.scheduled_job)
    y SOLO sus corridas (dbo.scheduled_job_run de ese job); no toca los demás jobs.
  - Los accesos de consulta que se otorgaron al aprobar solicitudes
    (sgc.document_access, tabla del S1) se CONSERVAN: son accesos válidos con
    su motivo; Calidad los revoca desde la ficha si hace falta.
  - NO toca sgc.audit_log (inmodificable): los avisos enviados siguen constando.

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;';
ELSE PRINT N'2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'IF OBJECT_ID(N''[sgc].[document_relation_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[document_relation_sin_borrado];
IF OBJECT_ID(N''[sgc].[review_alert_config_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[review_alert_config_sin_borrado];
IF OBJECT_ID(N''[sgc].[review_alert_inmodificable]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[review_alert_inmodificable];
IF OBJECT_ID(N''[sgc].[ical_token_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[ical_token_sin_borrado];
IF OBJECT_ID(N''[sgc].[access_request_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[access_request_sin_borrado];';
ELSE PRINT N'2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N''[dbo].[scheduled_job]'', N''U'') IS NOT NULL
  BEGIN
    IF OBJECT_ID(N''[dbo].[scheduled_job_run]'', N''U'') IS NOT NULL
      EXEC sp_executesql N''DELETE r FROM [dbo].[scheduled_job_run] r JOIN [dbo].[scheduled_job] j ON j.id = r.id_job WHERE j.job_type = N''''sgc_review_alerts'''';'';
    EXEC sp_executesql N''DELETE FROM [dbo].[scheduled_job] WHERE job_type = N''''sgc_review_alerts'''';'';
  END;

  IF OBJECT_ID(N''[sgc].[access_request]'', N''U'') IS NOT NULL      DROP TABLE [sgc].[access_request];
  IF OBJECT_ID(N''[sgc].[ical_token]'', N''U'') IS NOT NULL          DROP TABLE [sgc].[ical_token];
  IF OBJECT_ID(N''[sgc].[review_alert]'', N''U'') IS NOT NULL        DROP TABLE [sgc].[review_alert];
  IF OBJECT_ID(N''[sgc].[review_alert_config]'', N''U'') IS NOT NULL DROP TABLE [sgc].[review_alert_config];
  IF OBJECT_ID(N''[sgc].[graph_layout]'', N''U'') IS NOT NULL        DROP TABLE [sgc].[graph_layout];
  IF OBJECT_ID(N''[sgc].[document_relation]'', N''U'') IS NOT NULL   DROP TABLE [sgc].[document_relation];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20261001100000_sgc_s5_relaciones_vencimientos_accesos'';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;';
ELSE PRINT N'2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''despues'' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N''sgc'') ORDER BY t.name;';
ELSE PRINT N'2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-10-01-sgc-s4-divulgacion-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-10-01-sgc-s4-divulgacion-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA — SGC documental, Sprint 4 (divulgación, capacitación y vigencia).
  Deshace la migración 20261001000000_sgc_s4_divulgacion_capacitacion_vigencia
  y los datos de prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql.
  Deja el esquema `sgc` como quedó en el Sprint 3.

  ⚠️ BORRA el alcance de divulgación, las lecturas, las capacitaciones con
  sus cargas y resultados y las personas por cargo (las firmas «Leyó» y
  «Capacitó» de sgc.signature NO se tocan: son inmodificables; tampoco los
  archivos en OneDrive). Antes de correrla, exportar a JSON esas 6 tablas y
  document_version.id_superseded_by como evidencia (quedan en
  ~/.horus/rollbacks/). Solo con autorización de Nicolás. Idempotente.

  - El flujo DOC vuelve a su versión anterior VIGENTE; la versión con la
    divulgación habilitada queda RETIRADA (no se borra: puede tener
    solicitudes y el registro de cambios es inmodificable).
  - Las versiones de documento que pasaron a vigente u obsoleta por el flujo
    se conservan como quedaron (estado, fechas): revertir un documento
    vigente es un acto de Calidad (anulación), no de la reversa técnica.
  - NO toca sgc.audit_log ni sgc.config_change_log (inmodificables).

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;';
ELSE PRINT N'2026-10-01-sgc-s4-divulgacion-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'IF OBJECT_ID(N''[sgc].[dissemination_scope_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[dissemination_scope_sin_borrado];
IF OBJECT_ID(N''[sgc].[read_record_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[read_record_sin_borrado];
IF OBJECT_ID(N''[sgc].[read_record_firma_inmodificable]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[read_record_firma_inmodificable];
IF OBJECT_ID(N''[sgc].[training_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[training_sin_borrado];
IF OBJECT_ID(N''[sgc].[training_upload_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[training_upload_solo_insercion];
IF OBJECT_ID(N''[sgc].[training_result_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[training_result_solo_insercion];
IF OBJECT_ID(N''[sgc].[cargo_member_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[cargo_member_sin_borrado];';
ELSE PRINT N'2026-10-01-sgc-s4-divulgacion-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  /* Flujo DOC: la versión con la divulgación habilitada se retira y vuelve la anterior. */
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @V TABLE (id_flow_version INT, id_flow_process INT, version_number INT);
  INSERT INTO @V
    SELECT v.id_flow_version, v.id_flow_process, v.version_number FROM [sgc].[flow_version] v
    JOIN [sgc].[flow_process] p ON p.id_flow_process = v.id_flow_process
    WHERE p.code = N''DOC'' AND v.status = N''vigente''
      AND EXISTS (SELECT 1 FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N''divulgacion'' AND t.assignment = N''alcance'' AND t.is_enabled = 1);
  UPDATE v SET status = N''retirada'', retired_at = @Now, updated_at = @Now FROM [sgc].[flow_version] v JOIN @V x ON x.id_flow_version = v.id_flow_version;
  UPDATE prev SET status = N''vigente'', retired_at = NULL, updated_at = @Now
  FROM [sgc].[flow_version] prev JOIN @V x ON x.id_flow_process = prev.id_flow_process
  WHERE prev.version_number = (SELECT MAX(p2.version_number) FROM [sgc].[flow_version] p2 WHERE p2.id_flow_process = x.id_flow_process AND p2.version_number < x.version_number);

  IF OBJECT_ID(N''[sgc].[training_result]'', N''U'') IS NOT NULL     DROP TABLE [sgc].[training_result];
  IF OBJECT_ID(N''[sgc].[training_upload]'', N''U'') IS NOT NULL     DROP TABLE [sgc].[training_upload];
  IF OBJECT_ID(N''[sgc].[training]'', N''U'') IS NOT NULL            DROP TABLE [sgc].[training];
  IF OBJECT_ID(N''[sgc].[read_record]'', N''U'') IS NOT NULL         DROP TABLE [sgc].[read_record];
  IF OBJECT_ID(N''[sgc].[dissemination_scope]'', N''U'') IS NOT NULL DROP TABLE [sgc].[dissemination_scope];
  IF OBJECT_ID(N''[sgc].[cargo_member]'', N''U'') IS NOT NULL        DROP TABLE [sgc].[cargo_member];

  IF COL_LENGTH(N''[sgc].[document_version]'', N''id_superseded_by'') IS NOT NULL ALTER TABLE [sgc].[document_version] DROP COLUMN [id_superseded_by];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20261001000000_sgc_s4_divulgacion_capacitacion_vigencia'';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;';
ELSE PRINT N'2026-10-01-sgc-s4-divulgacion-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''despues'' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N''sgc'') ORDER BY t.name;';
ELSE PRINT N'2026-10-01-sgc-s4-divulgacion-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA — SGC documental, Sprint 3 (firma electrónica propia, PDF
  controlado, lista de chequeo de Calidad y borrador en la app). Deshace la
  migración 20260930230000_sgc_s3_firma_pdf_calidad y los datos de
  prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql. Deja el esquema
  `sgc` como quedó en el Sprint 2.

  ⚠️ BORRA las firmas electrónicas, consentimientos, maestro de firmas,
  revisiones del borrador y listas de chequeo (los archivos de evidencia en
  OneDrive SGC/<EMPRESA>/_firmas/ y los PDF controlados NO se tocan). Antes de
  correrla, exportar a JSON esas 5 tablas y las columnas nuevas como
  evidencia (quedan en ~/.horus/rollbacks/). Solo con autorización de
  Nicolás. Idempotente.

  - El flujo DOC vuelve a su versión anterior VIGENTE; la versión con lista de
    chequeo queda RETIRADA (no se borra: puede tener solicitudes y el registro
    de cambios es inmodificable).
  - Los puntos de firma vuelven al valor del S2 («pendiente_s3»), salvo los
    firmados, que quedan «firmada».
  - Las versiones de documento generadas por el S3 (estado «borrador») se
    conservan; pierden id_request, manifest_json y signed_content_sha256.
  - NO toca sgc.audit_log ni sgc.config_change_log (inmodificables).

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;';
ELSE PRINT N'2026-09-30-sgc-s3-firma-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'IF OBJECT_ID(N''[sgc].[signature_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signature_solo_insercion];
IF OBJECT_ID(N''[sgc].[signature_consent_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signature_consent_solo_insercion];
IF OBJECT_ID(N''[sgc].[draft_revision_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[draft_revision_solo_insercion];
IF OBJECT_ID(N''[sgc].[quality_check_solo_insercion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[quality_check_solo_insercion];
IF OBJECT_ID(N''[sgc].[signature_master_sin_borrado]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signature_master_sin_borrado];
IF OBJECT_ID(N''[sgc].[signature_master_solo_revocacion]'', N''TR'') IS NOT NULL DROP TRIGGER [sgc].[signature_master_solo_revocacion];';
ELSE PRINT N'2026-09-30-sgc-s3-firma-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  /* Flujo DOC: la versión con lista de chequeo se retira y vuelve la anterior. */
  IF COL_LENGTH(N''[sgc].[flow_form_field]'', N''quality_check'') IS NOT NULL
    EXEC sp_executesql N''
      DECLARE @Now DATETIME2 = SYSUTCDATETIME();
      DECLARE @V TABLE (id_flow_version INT, id_flow_process INT, version_number INT);
      INSERT INTO @V
        SELECT v.id_flow_version, v.id_flow_process, v.version_number FROM [sgc].[flow_version] v
        JOIN [sgc].[flow_process] p ON p.id_flow_process = v.id_flow_process
        WHERE p.code = N''''DOC'''' AND v.status = N''''vigente''''
          AND EXISTS (SELECT 1 FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1);
      UPDATE v SET status = N''''retirada'''', retired_at = @Now, updated_at = @Now FROM [sgc].[flow_version] v JOIN @V x ON x.id_flow_version = v.id_flow_version;
      UPDATE prev SET status = N''''vigente'''', retired_at = NULL, updated_at = @Now
      FROM [sgc].[flow_version] prev JOIN @V x ON x.id_flow_process = prev.id_flow_process
      WHERE prev.version_number = (SELECT MAX(p2.version_number) FROM [sgc].[flow_version] p2 WHERE p2.id_flow_process = x.id_flow_process AND p2.version_number < x.version_number);'';

  /* Puntos de firma al valor del S2. */
  UPDATE [sgc].[task_assignee] SET signature_status = N''pendiente_s3'' WHERE signature_status IN (N''pendiente'', N''sin_firma_s2'');

  IF OBJECT_ID(N''[sgc].[quality_check]'', N''U'') IS NOT NULL     DROP TABLE [sgc].[quality_check];
  IF OBJECT_ID(N''[sgc].[signature]'', N''U'') IS NOT NULL         DROP TABLE [sgc].[signature];
  IF OBJECT_ID(N''[sgc].[signature_consent]'', N''U'') IS NOT NULL DROP TABLE [sgc].[signature_consent];
  IF OBJECT_ID(N''[sgc].[signature_master]'', N''U'') IS NOT NULL  DROP TABLE [sgc].[signature_master];
  IF OBJECT_ID(N''[sgc].[draft_revision]'', N''U'') IS NOT NULL    DROP TABLE [sgc].[draft_revision];

  IF COL_LENGTH(N''[sgc].[task_assignee]'', N''id_signature'') IS NOT NULL ALTER TABLE [sgc].[task_assignee] DROP COLUMN [id_signature];
  IF COL_LENGTH(N''[sgc].[request]'', N''id_document_version'') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [id_document_version], [controlled_pdf_status], [controlled_pdf_error];
  IF COL_LENGTH(N''[sgc].[document_version]'', N''id_request'') IS NOT NULL ALTER TABLE [sgc].[document_version] DROP COLUMN [id_request], [manifest_json], [signed_content_sha256];
  IF OBJECT_ID(N''[sgc].[flow_form_field_quality_check_df]'', N''D'') IS NOT NULL ALTER TABLE [sgc].[flow_form_field] DROP CONSTRAINT [flow_form_field_quality_check_df];
  IF COL_LENGTH(N''[sgc].[flow_form_field]'', N''quality_check'') IS NOT NULL ALTER TABLE [sgc].[flow_form_field] DROP COLUMN [quality_check];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20260930230000_sgc_s3_firma_pdf_calidad'';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;';
ELSE PRINT N'2026-09-30-sgc-s3-firma-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''despues'' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N''sgc'') ORDER BY t.name;';
ELSE PRINT N'2026-09-30-sgc-s3-firma-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s2-flujos-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s2-flujos-reversa.sql (condicional: OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL) ===== */
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA — SGC documental, Sprint 2 (flujos validados, Tareas documentales y
  Autorizaciones SGC). Deshace la migración
  20260930200000_sgc_s2_flujos_tareas_autorizaciones y los datos de
  prisma/manual/2026-09-30-sgc-s2-flujo-documental-olp.sql. Deja el esquema
  `sgc` como quedó en el Sprint 1.

  ⚠️ BORRA las solicitudes documentales, sus tareas, historial, adjuntos
  (solo los metadatos: los archivos en OneDrive SGC/<EMPRESA>/_solicitudes/
  NO se tocan), autorizaciones, la definición de los flujos y su registro de
  cambios. Antes de correrla, exportar a JSON las 17 tablas como evidencia
  (quedan en ~/.horus/rollbacks/). Solo con autorización de Nicolás.
  Idempotente.

  NO toca sgc.audit_log (inmodificable): las filas del S2 quedan como
  historia.

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

IF OBJECT_ID(N''[sgc].[config_change_log_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[config_change_log_solo_insercion];';
ELSE PRINT N'2026-09-30-sgc-s2-flujos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'IF OBJECT_ID(N''[sgc].[interaction_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[interaction_solo_insercion];';
ELSE PRINT N'2026-09-30-sgc-s2-flujos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N''[sgc].[authorization]'', N''U'') IS NOT NULL            DROP TABLE [sgc].[authorization];
  IF OBJECT_ID(N''[sgc].[authorization_type_user]'', N''U'') IS NOT NULL  DROP TABLE [sgc].[authorization_type_user];
  IF OBJECT_ID(N''[sgc].[authorization_type]'', N''U'') IS NOT NULL       DROP TABLE [sgc].[authorization_type];
  IF OBJECT_ID(N''[sgc].[attachment]'', N''U'') IS NOT NULL               DROP TABLE [sgc].[attachment];
  IF OBJECT_ID(N''[sgc].[interaction]'', N''U'') IS NOT NULL              DROP TABLE [sgc].[interaction];
  IF OBJECT_ID(N''[sgc].[form_value]'', N''U'') IS NOT NULL               DROP TABLE [sgc].[form_value];
  IF OBJECT_ID(N''[sgc].[task_assignee]'', N''U'') IS NOT NULL            DROP TABLE [sgc].[task_assignee];
  IF OBJECT_ID(N''[sgc].[task]'', N''U'') IS NOT NULL                     DROP TABLE [sgc].[task];
  IF OBJECT_ID(N''[sgc].[request_signer]'', N''U'') IS NOT NULL           DROP TABLE [sgc].[request_signer];
  IF OBJECT_ID(N''[sgc].[request]'', N''U'') IS NOT NULL                  DROP TABLE [sgc].[request];
  IF OBJECT_ID(N''[sgc].[config_change_log]'', N''U'') IS NOT NULL        DROP TABLE [sgc].[config_change_log];
  IF OBJECT_ID(N''[sgc].[responsible_matrix]'', N''U'') IS NOT NULL       DROP TABLE [sgc].[responsible_matrix];
  IF OBJECT_ID(N''[sgc].[flow_form_field]'', N''U'') IS NOT NULL          DROP TABLE [sgc].[flow_form_field];
  IF OBJECT_ID(N''[sgc].[flow_transition]'', N''U'') IS NOT NULL          DROP TABLE [sgc].[flow_transition];
  IF OBJECT_ID(N''[sgc].[flow_task_def]'', N''U'') IS NOT NULL            DROP TABLE [sgc].[flow_task_def];
  IF OBJECT_ID(N''[sgc].[flow_version]'', N''U'') IS NOT NULL             DROP TABLE [sgc].[flow_version];
  IF OBJECT_ID(N''[sgc].[flow_process]'', N''U'') IS NOT NULL             DROP TABLE [sgc].[flow_process];
  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20260930200000_sgc_s2_flujos_tareas_autorizaciones'';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;';
ELSE PRINT N'2026-09-30-sgc-s2-flujos-reversa.sql: nada que revertir, se omite.';
GO
IF OBJECT_ID(N'sgc.authorization_type', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''despues'' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N''sgc'') ORDER BY t.name;';
ELSE PRINT N'2026-09-30-sgc-s2-flujos-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s1-repositorio-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s1-repositorio-reversa.sql (condicional: SCHEMA_ID(N'sgc') IS NOT NULL) ===== */
IF SCHEMA_ID(N'sgc') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA — SGC documental, Sprint 1 (repositorio y listado maestro).
  Deshace la migración 20260930150000_sgc_s1_repositorio y los datos de
  prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql. Deja el esquema `sgc`
  como quedó en el Sprint 0 (solo sgc.company_config).

  ⚠️ BORRA los documentos cargados, sus versiones, accesos y la AUDITORÍA del
  SGC. Antes de correrla, exportar a JSON las 8 tablas como evidencia
  (quedan en ~/.horus/rollbacks/). Los archivos en OneDrive (SGC/<EMPRESA>/…)
  NO se tocan. Solo con autorización de Nicolás. Idempotente.

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

IF OBJECT_ID(N''[sgc].[audit_log_solo_insercion]'', N''TR'') IS NOT NULL
  DROP TRIGGER [sgc].[audit_log_solo_insercion];';
ELSE PRINT N'2026-09-30-sgc-s1-repositorio-reversa.sql: nada que revertir, se omite.';
GO
IF SCHEMA_ID(N'sgc') IS NOT NULL
  EXEC sp_executesql N'SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N''[sgc].[audit_log]'', N''U'') IS NOT NULL        DROP TABLE [sgc].[audit_log];
  IF OBJECT_ID(N''[sgc].[document_access]'', N''U'') IS NOT NULL  DROP TABLE [sgc].[document_access];
  IF OBJECT_ID(N''[sgc].[document_version]'', N''U'') IS NOT NULL DROP TABLE [sgc].[document_version];
  IF OBJECT_ID(N''[sgc].[document]'', N''U'') IS NOT NULL         DROP TABLE [sgc].[document];
  IF OBJECT_ID(N''[sgc].[document_type]'', N''U'') IS NOT NULL    DROP TABLE [sgc].[document_type];
  IF OBJECT_ID(N''[sgc].[process_map]'', N''U'') IS NOT NULL      DROP TABLE [sgc].[process_map];
  IF OBJECT_ID(N''[sgc].[process_type]'', N''U'') IS NOT NULL     DROP TABLE [sgc].[process_type];
  IF OBJECT_ID(N''[sgc].[coding_guide]'', N''U'') IS NOT NULL     DROP TABLE [sgc].[coding_guide];
  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20260930150000_sgc_s1_repositorio'';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;';
ELSE PRINT N'2026-09-30-sgc-s1-repositorio-reversa.sql: nada que revertir, se omite.';
GO
IF SCHEMA_ID(N'sgc') IS NOT NULL
  EXEC sp_executesql N'SELECT ''despues'' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N''sgc'') ORDER BY t.name;';
ELSE PRINT N'2026-09-30-sgc-s1-repositorio-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · prisma/manual/2026-09-30-sgc-s0-cimientos-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/manual/2026-09-30-sgc-s0-cimientos-reversa.sql (condicional: SCHEMA_ID(N'sgc') IS NOT NULL) ===== */
IF SCHEMA_ID(N'sgc') IS NOT NULL
  EXEC sp_executesql N'/*
  REVERSA de prisma/manual/2026-09-30-sgc-s0-cimientos.sql y de la migración
  20260930110000_sgc_esquema_base. Deja la base como estaba antes del SGC.
  Solo con autorización. Idempotente.
*/
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url LIKE N''/process/sgc-documental%'';

  DELETE FROM [dbo].[subprocess] WHERE subprocess_url LIKE N''/process/sgc-documental%'';

  DELETE p FROM [dbo].[process] p
  WHERE p.process = N''Sistema de Gestión de Calidad''
    AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.id_process = p.id_process);

  IF OBJECT_ID(N''[sgc].[company_config]'', N''U'') IS NOT NULL DROP TABLE [sgc].[company_config];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = N''sgc'')
  AND NOT EXISTS (SELECT 1 FROM sys.objects o JOIN sys.schemas sc ON sc.schema_id = o.schema_id WHERE sc.name = N''sgc'')
  EXEC sp_executesql N''DROP SCHEMA [sgc];'';

DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N''20260930110000_sgc_esquema_base'';';
ELSE PRINT N'2026-09-30-sgc-s0-cimientos-reversa.sql: nada que revertir, se omite.';
GO
/* GUARDIA · registro-migraciones (reversa) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== registro-migraciones (reversa) ===== */
DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name LIKE N'%[_]sgc[_]%' AND migration_name <> N'20260930100000_sgc_s0_retiro_gestion_documental';
SELECT SCHEMA_ID(N'sgc') AS esquema_sgc, (SELECT COUNT(*) FROM sys.triggers WHERE parent_class = 0 AND name = N'sgc_proteger_esquema') AS trigger_bd,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/sgc-documental%') AS subprocesos_sgc;
GO
