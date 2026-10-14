/*
  REVERSA (datos) del SQL 2026-10-14-sgc-s15-flujo-doc-v7-olp.sql (SGC,
  Sprint 15): publica una versión NUEVA de DOC con el modelo ANTERIOR
  (calidad_asigna), copiada de la vigente del DOC v7:
    - sin «Autorización de la creación» (la solicitud va directo a elaboración);
    - todas las tareas desde la elaboración vuelven un lugar atrás;
    - «Preparación de la capacitación» y «Capacitación» vuelven al grupo de
      Calidad (SGC-VERIF-CALIDAD), como en el DOC v6 del S10.
  NUNCA edita ni borra versiones: la versión v7 queda RETIRADA y las solicitudes
  que nacieron con ella la conservan (para cerrarlas con las reglas viejas use
  la reversa del esquema solo después, ver su encabezado).

  Idempotente: si la versión vigente ya no es «solicitante_elabora», no hace nada.
  Se corre ANTES de la reversa del esquema (2026-10-14-sgc-s15-modelo-roles-reversa.sql).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Reversa del Sprint 15: el flujo documental vuelve al modelo anterior (elaborador por configuración y firmantes confirmados por Calidad; Calidad prepara y cierra la capacitación). Las solicitudes en curso conservan su versión.';

IF COL_LENGTH(N'sgc.flow_version', N'role_model') IS NULL
BEGIN
  PRINT N'Sin la columna role_model no hay DOC v7 que revertir.';
  RETURN;
END;
DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
DECLARE @PrevModel NVARCHAR(30);
IF @Prev IS NOT NULL
  EXEC sp_executesql N'SELECT @m = role_model FROM [sgc].[flow_version] WHERE id_flow_version = @v', N'@m NVARCHAR(30) OUTPUT, @v INT', @m = @PrevModel OUTPUT, @v = @Prev;

IF @Prev IS NOT NULL AND @PrevModel = N'solicitante_elabora'
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
    SELECT @IdVersion, task_key, name, CASE WHEN step_order >= 2 THEN step_order - 1 ELSE step_order END, role,
           CASE WHEN assignment = N'creador' THEN N'calidad' ELSE assignment END,
           multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code,
           CASE WHEN assignment = N'creador' THEN N'SGC-VERIF-CALIDAD' ELSE pool_authorization_type_code END,
           is_enabled,
           CASE task_key
             WHEN N'solicitud' THEN N'El dueño del proceso registra la necesidad (nuevo, nueva versión o modificación) con su justificación.'
             WHEN N'elaboracion' THEN N'El elaborador carga el borrador (Word) y asigna revisores y aprobadores, con su modo de firma.'
             WHEN N'revision' THEN N'Los revisores dejan observaciones y aprueban o devuelven a elaboración.'
             WHEN N'aprobacion' THEN N'Aprueban los responsables del área; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental.'
             WHEN N'preparacion_capacitacion' THEN N'Antes de la divulgación, Calidad registra el material de la capacitación: video o sesión y evaluación en Microsoft Forms o Google Forms. Solo si la solicitud requiere capacitación.'
             WHEN N'capacitacion' THEN N'Calidad carga los resultados de la evaluación (Microsoft Forms o Google Forms; cuentan 2 intentos), registra la recapacitación de quien no aprobó y firma «Capacitó». Solo si la solicitud requiere capacitación.'
             ELSE description END
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key <> N'autorizacion_creacion';

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, CASE WHEN from_task_key = N'solicitud' AND action = N'aprobar' THEN N'elaboracion' ELSE to_task_key END, terminal_status
    FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev AND from_task_key <> N'autorizacion_creacion';

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev AND ISNULL(task_key, N'') <> N'autorizacion_creacion';

    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N',"roleModel":"solicitante_elabora"}'),
            CONCAT(N'{"vigente":', @Number, N',"cambios":["Modelo de roles: elaborador por configuración y firmantes confirmados por Calidad.","Tarea retirada: autorizacion_creacion.","Preparación de la capacitación y Capacitación: grupo de Calidad."]}'));
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N'}'), @Motivo);
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status, (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
