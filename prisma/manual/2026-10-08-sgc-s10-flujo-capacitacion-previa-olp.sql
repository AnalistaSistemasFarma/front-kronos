/*
  PASE MANUAL — SGC documental, Sprint 10 («DOC v6» del plan): FLUJO con la
  capacitación preparada ANTES de la divulgación y OPCIONAL por solicitud
  (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008120000_sgc_s10_capacitacion_opcional y el
  CÓDIGO del S10 desplegados (el código anterior no conoce la tarea
  «material» ni la condición «requiere_capacitacion»).

  QUÉ HACE (idempotente: solo si la versión vigente de DOC aún no tiene la
  preparación de la capacitación):
    1. Publica una versión NUEVA de DOC copiada de la vigente (que queda
       retirada; las solicitudes en curso siguen con su versión) con:
         - «Preparación de la capacitación» (preparacion_capacitacion, orden 4,
           grupo de Calidad, sin firma, condición «requiere_capacitacion»):
           Calidad registra el video o la sesión y la evaluación en Microsoft
           Forms o Google Forms; la divulgación no abre sin ese material;
         - Divulgación pasa al orden 5 y Capacitación al 6, con la condición
           «requiere_capacitacion» (la bandera de la solicitud);
         - Aprobación → Preparación → Divulgación; la preparación se puede cancelar.
    2. Deja el cambio en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.
  Para otra empresa: cambiar @IdCompany (id DE ESA BASE).

  REVERSA: prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql
  (publica otra versión sin la preparación; nunca edita ni borra versiones).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 10 (socialización con Calidad OLP 2026-10-07): la capacitación es opcional por solicitud y su material (video y evaluación en Microsoft Forms o Google Forms) se prepara ANTES de la divulgación; la lectura lo muestra debajo del documento; cuentan 2 intentos y quien no aprueba queda en recapacitación.';

DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'DOC');
IF @IdProcess IS NULL
  THROW 51083, N'La empresa no tiene el flujo DOC (falta el pase del S2).', 1;
DECLARE @Prev INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
IF @Prev IS NULL
  THROW 51084, N'El flujo DOC no tiene versión vigente.', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion' AND assignment = N'alcance' AND is_enabled = 1)
  THROW 51085, N'La versión vigente de DOC no tiene la divulgación habilitada (falta el SQL del S4).', 1;

SELECT 'antes' AS momento, v.version_number, v.status, (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'preparacion_capacitacion')
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @PrevNumber INT = (SELECT version_number FROM [sgc].[flow_version] WHERE id_flow_version = @Prev);
    DECLARE @Number INT = (SELECT MAX(version_number) + 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();
    DECLARE @OrdenDivulgacion INT = (SELECT step_order FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev AND task_key = N'divulgacion');

    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @Prev;

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, @Number, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    -- Copia de las tareas; las que van desde la divulgación corren un lugar.
    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    SELECT @IdVersion, task_key, name, CASE WHEN step_order >= @OrdenDivulgacion THEN step_order + 1 ELSE step_order END, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days,
           CASE WHEN task_key = N'capacitacion' THEN N'requiere_capacitacion' ELSE condition_key END,
           is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled,
           CASE WHEN task_key = N'capacitacion' THEN N'Calidad carga los resultados de la evaluación (Microsoft Forms o Google Forms; cuentan 2 intentos), registra la recapacitación de quien no aprobó y firma «Capacitó». Solo si la solicitud requiere capacitación.'
                WHEN task_key = N'divulgacion' THEN N'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance; si la solicitud requiere capacitación, debajo del documento van el video y la evaluación.'
                ELSE description END
    FROM [sgc].[flow_task_def] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES (@IdVersion, N'preparacion_capacitacion', N'Preparación de la capacitación', @OrdenDivulgacion, N'material', N'calidad', 0, NULL, NULL, 5, N'requiere_capacitacion', 0, NULL, N'SGC-VERIF-CALIDAD', 1,
            N'Antes de la divulgación, Calidad registra el material de la capacitación: video o sesión y evaluación en Microsoft Forms o Google Forms. Solo si la solicitud requiere capacitación.');

    -- Transiciones: la aprobación lleva a la preparación, y la preparación a la divulgación.
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    SELECT @IdVersion, from_task_key, action, CASE WHEN from_task_key = N'aprobacion' AND action = N'aprobar' THEN N'preparacion_capacitacion' ELSE to_task_key END, terminal_status
    FROM [sgc].[flow_transition] WHERE id_flow_version = @Prev;
    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES (@IdVersion, N'preparacion_capacitacion', N'aprobar', N'divulgacion', NULL),
           (@IdVersion, N'preparacion_capacitacion', N'cancelar', NULL, N'cancelada');

    INSERT INTO [sgc].[flow_form_field] (id_flow_version, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check)
    SELECT @IdVersion, task_key, field_key, label, field_type, required, options_json, help_text, sort_order, quality_check FROM [sgc].[flow_form_field] WHERE id_flow_version = @Prev;

    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, CONCAT(N'{"vigente":', @PrevNumber, N'}'),
            CONCAT(N'{"vigente":', @Number, N',"cambios":["Tarea agregada: preparacion_capacitacion (Preparación de la capacitación).","Transición cambiada: aprobacion:aprobar->preparacion_capacitacion.","Transiciones agregadas: preparacion_capacitacion:aprobar->divulgacion, preparacion_capacitacion:cancelar->cancelada.","Tarea Capacitación (capacitacion) cambió: conditionKey, stepOrder, description."]}'));

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
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones
FROM [sgc].[flow_version] v WHERE v.id_flow_process = @IdProcess ORDER BY v.version_number;
