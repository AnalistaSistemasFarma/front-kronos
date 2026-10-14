/*
  PASE MANUAL — SGC documental, Sprint 15: FLUJO DOC v7, NUEVO MODELO DE ROLES
  (primera prueba en producción con Calidad OLP, 2026-10-13; decisiones de
  Nicolás de las 14:44: D14 a D16).

  PRERREQUISITOS:
    - migración 20261014100000_sgc_s15_modelo_roles (role_model, «rechazar»);
    - CÓDIGO del S15 desplegado (el código anterior no conoce el modelo
      «solicitante_elabora», la asignación «creador» ni la acción «rechazar»);
    - el flujo DOC vigente ya tiene la preparación de la capacitación (S10).

  QUÉ HACE (idempotente: solo si la versión vigente de DOC aún no es del modelo
  «solicitante_elabora»):
    1. Publica una versión NUEVA de DOC copiada de la vigente (que queda
       retirada; LAS SOLICITUDES EN CURSO SIGUEN CON SU VERSIÓN) con:
         - modelo de roles «solicitante_elabora»: quien hace la solicitud la
           elabora (R16) y asigna revisores y aprobadores de su departamento
           (R17); revisor del área o de Calidad, nunca el elaborador (R18);
           aprueba el líder (R19, lista por departamento SIN restricción hasta
           que Calidad encienda el ajuste, D16);
         - «Autorización de la creación» (autorizacion_creacion, orden 1, grupo
           SGC-VERIF-CALIDAD, tarea de autorización): Calidad autoriza (sigue a
           la elaboración) o RECHAZA (cierra la solicitud con su motivo) (R15);
         - las demás tareas corren un lugar (elaboración 2 … capacitación 7);
         - «Preparación de la capacitación» y «Capacitación» pasan al CREADOR
           del documento (R27); la capacitación conserva el cupo del grupo de
           Calidad para su cierre (D18 abierta: ajuste por empresa, encendido).
    2. Deja el cambio en sgc.config_change_log y sgc.audit_log.

  NO CAMBIA el ajuste «Calidad revisa lo que elaboró» (D14: sigue encendido en
  OLP) ni la lista del S12.

  CÓMO CORRERLO: scripts/sgc/pase-produccion/aplicar-sql.mjs (lee DATABASE_URL
  del .env y verifica DB_NAME()). Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo
  con la autorización del pase. Imprime antes y después.
  Para otra empresa: cambiar @IdCompany (id DE ESA BASE).

  REVERSA: prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql
  (publica otra versión con el modelo anterior; nunca edita ni borra versiones).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 15 (prueba en producción con Calidad OLP, 2026-10-13; decisiones de Nicolás 14:44): el solicitante elabora su documento y asigna revisores y aprobadores de su departamento; Aseguramiento de Calidad autoriza (o rechaza) la creación; revisa alguien del área o de Calidad, nunca el elaborador; aprueba el líder; la capacitación la prepara y la dicta el creador.';

IF COL_LENGTH(N'sgc.flow_version', N'role_model') IS NULL
  THROW 51153, N'Falta la migración 20261014100000_sgc_s15_modelo_roles (columna sgc.flow_version.role_model).', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51154, N'La empresa no tiene el SGC configurado.', 1;
DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51155, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51156, N'El flujo DOC no tiene versión vigente.', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-VERIF-CALIDAD' AND is_active = 1)
  THROW 51157, N'Falta el tipo de autorización SGC-VERIF-CALIDAD activo (grupo de Calidad).', 1;

DECLARE @PrevModel NVARCHAR(30);
EXEC sp_executesql N'SELECT @m = role_model FROM [sgc].[flow_version] WHERE id_flow_version = @v', N'@m NVARCHAR(30) OUTPUT, @v INT', @m = @PrevModel OUTPUT, @v = @Prev;

IF ISNULL(@PrevModel, N'') <> N'solicitante_elabora'
  AND NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'preparacion_capacitacion')
  THROW 51158, N'La versión vigente de DOC no tiene la preparación de la capacitación (falta el SQL del S10).', 1;

SELECT 'antes' AS momento, v.version_number, v.status, (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF ISNULL(@PrevModel, N'') <> N'solicitante_elabora'
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
    EXEC sp_executesql N'UPDATE [sgc].[flow_version] SET role_model = N''solicitante_elabora'' WHERE id_flow_version = @v', N'@v INT', @v = @IdVersion;

    -- Copia de las tareas: todas desde la elaboración corren un lugar; la capacitación pasa al creador.
    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, CASE WHEN step_order >= 1 THEN step_order + 1 ELSE step_order END, role,
           CASE WHEN task_key IN (N'preparacion_capacitacion', N'capacitacion') THEN N'creador' ELSE assignment END,
           multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code,
           CASE WHEN task_key = N'preparacion_capacitacion' THEN NULL ELSE pool_authorization_type_code END,
           is_enabled,
           CASE task_key
             WHEN N'solicitud' THEN N'Cualquier persona del área registra la necesidad (nuevo, nueva versión o modificación) con su justificación; ella misma elaborará el documento.'
             WHEN N'elaboracion' THEN N'Quien hizo la solicitud elabora el documento: carga el borrador y asigna revisores y aprobadores de su departamento (un revisor también puede ser de Aseguramiento de Calidad).'
             WHEN N'revision' THEN N'Revisa alguien del área o de Aseguramiento de Calidad, nunca el elaborador.'
             WHEN N'aprobacion' THEN N'Aprueba el líder del departamento; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental con la lista de chequeo (no se estampa en el documento).'
             WHEN N'preparacion_capacitacion' THEN N'Antes de la divulgación, el creador del documento registra el material de la capacitación: video o sesión, quién dicta y la evaluación. Solo si la solicitud requiere capacitación.'
             WHEN N'capacitacion' THEN N'El creador del documento dicta la capacitación, carga los resultados de la evaluación y firma «Capacitó»; Aseguramiento de Calidad la cierra si la empresa lo mantiene. Solo si la solicitud requiere capacitación.'
             ELSE description END
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES (@IdVersion, N'autorizacion_creacion', N'Autorización de la creación', 1, N'calidad', N'calidad', 0, NULL, NULL, 3, NULL, 1, N'SGC-VERIF-CALIDAD', N'SGC-VERIF-CALIDAD', 1,
            N'Aseguramiento de Calidad autoriza o rechaza la creación del documento (por ejemplo, porque ya existe uno vigente que cubre el tema). Mientras no la autorice, nadie elabora.');

    -- Transiciones: la solicitud lleva a la autorización; la autorización a la elaboración, o rechaza / cancela.
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, CASE WHEN from_task_key = N'solicitud' AND action = N'aprobar' THEN N'autorizacion_creacion' ELSE to_task_key END, terminal_status
    FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES (@IdVersion, N'autorizacion_creacion', N'aprobar', N'elaboracion', NULL),
           (@IdVersion, N'autorizacion_creacion', N'rechazar', NULL, N'cancelada'),
           (@IdVersion, N'autorizacion_creacion', N'cancelar', NULL, N'cancelada');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'),
            CONCAT(N'{"vigente":', @Number, N',"cambios":["Modelo de roles: el solicitante elabora y asigna firmantes de su departamento; Calidad autoriza la creación (DOC v7).","Tarea agregada: autorizacion_creacion (Autorización de la creación).","Transición cambiada: solicitud:aprobar->autorizacion_creacion.","Transiciones agregadas: autorizacion_creacion:aprobar->elaboracion, autorizacion_creacion:rechazar->cancelada, autorizacion_creacion:cancelar->cancelada.","Tareas Preparación de la capacitación y Capacitación: asignación al creador del documento.","Todas las tareas desde la elaboración corren un lugar (stepOrder)."]}'));

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), CONCAT(N'{"version":', @PrevNumber, N'}'), CONCAT(N'{"version":', @Number, N',"roleModel":"solicitante_elabora"}'), @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

-- Solicitudes en curso: conservan su versión (deben seguir en la anterior).
SELECT 'en_curso' AS momento, r.id_request, v.version_number, r.status, r.current_task_key
FROM [sgc].[request] r JOIN [sgc].[flow_version] v ON v.id_flow_version = r.id_flow_version
WHERE r.id_company = @IdCompany AND r.status IN (N'abierta', N'en_espera') ORDER BY r.id_request;
