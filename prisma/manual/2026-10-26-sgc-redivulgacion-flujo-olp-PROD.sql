/*
  PASE MANUAL — SGC documental: FLUJO «REDIV» (REDIVULGACIÓN de un documento vigente), solo DATOS.
  Base: KRONOSDB (la guarda DB_NAME() lo exige). Empresa: One Latam Pharma (@IdCompany).

  Decisión de Nicolás Rivera (2026-10-26): un documento VIGENTE se puede volver a divulgar sin
  crear una versión nueva (personal nuevo, reinducción, hallazgo de auditoría, documentos de la
  carga inicial que nunca se divulgaron). A quien ya leyó esa versión se le vuelve a pedir la
  lectura; antes de lanzarla, Aseguramiento de Calidad ve cuántas personas ya la habían leído
  y lo confirma.

  QUÉ HACE (idempotente: si REDIV ya existe en la empresa, no hace nada):
    1. Crea el proceso de flujo REDIV («Redivulgación de documento vigente», categoría documental).
    2. Publica su versión 1 VIGENTE con dos pasos:
         0 Solicitud de redivulgación (Aseguramiento de Calidad registra el motivo y el alcance);
         1 Divulgación (lectura obligatoria firmada «Leyó» de cada persona del alcance; el cierre,
           los recordatorios y la exclusión justificada son los de siempre).
       Transiciones: solicitud → divulgación; divulgación → completada; cancelar → cancelada.
    3. Deja el cambio en sgc.config_change_log y sgc.audit_log.
  NO TOCA el flujo DOC ni ninguna solicitud. NO cambia el esquema (sin DDL).

  CÓMO CORRERLO: scripts/sgc/pase-produccion/aplicar-sql.mjs (lee DATABASE_URL y verifica DB_NAME()).
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con la autorización del pase. Imprime antes y después.
  REVERSA: prisma/manual/2026-10-26-sgc-redivulgacion-flujo-olp-reversa.sql (retira la versión y
  desactiva el proceso; nunca borra).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51190, N'Base no esperada para este script (PROD): debe correrse en KRONOSDB.', 1;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Redivulgación de documentos vigentes (decisión de Nicolás Rivera, 2026-10-26): volver a divulgar la versión vigente sin crear una versión nueva; a quien ya la leyó se le vuelve a pedir la lectura, con la confirmación previa de Aseguramiento de Calidad.';

IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51191, N'La empresa no tiene el SGC configurado.', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-VERIF-CALIDAD' AND is_active = 1)
  THROW 51192, N'Falta el tipo de autorización SGC-VERIF-CALIDAD activo (grupo de Calidad).', 1;

SELECT 'antes' AS momento, p.code, p.is_active, v.version_number, v.status
FROM [sgc].[flow_process] p LEFT JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_company = @IdCompany AND p.code = N'REDIV';

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'REDIV')
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();
    DECLARE @IdProcess INT;
    INSERT INTO [sgc].[flow_process] (id_company, code, name, description, category, owner_email, is_active, created_by, created_at, updated_at)
    VALUES (@IdCompany, N'REDIV', N'Redivulgación de documento vigente', N'Vuelve a divulgar la versión vigente de un documento (lectura obligatoria firmada) sin crear una versión nueva.', N'documental', @Actor, 1, @Actor, @Now, @Now);
    SET @IdProcess = SCOPE_IDENTITY();

    DECLARE @IdVersion INT;
    INSERT INTO [sgc].[flow_version] (id_flow_process, version_number, status, change_reason, created_by, created_at, updated_at, published_by, published_at)
    VALUES (@IdProcess, 1, N'vigente', @Motivo, @Actor, @Now, @Now, @Actor, @Now);
    SET @IdVersion = SCOPE_IDENTITY();

    INSERT INTO [sgc].[flow_task_def] (id_flow_version, task_key, name, step_order, role, assignment, multi_assignee, signing_mode_default, signature_meaning, target_days, condition_key, is_authorization, authorization_type_code, pool_authorization_type_code, is_enabled, description)
    VALUES
      (@IdVersion, N'solicitud', N'Solicitud de redivulgación', 0, N'solicitante', N'solicitante', 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, 1,
       N'Aseguramiento de Calidad registra el motivo y el alcance de la redivulgación de la versión vigente (sin versión nueva).'),
      (@IdVersion, N'divulgacion', N'Divulgación', 1, N'alcance', N'alcance', 0, NULL, N'leyo', 10, NULL, 0, NULL, N'SGC-VERIF-CALIDAD', 1,
       N'Lectura obligatoria del PDF controlado vigente hasta el final y firma «Leyó» de cada persona del alcance, aunque ya la hubiera leído antes.');

    INSERT INTO [sgc].[flow_transition] (id_flow_version, from_task_key, action, to_task_key, terminal_status)
    VALUES (@IdVersion, N'solicitud', N'aprobar', N'divulgacion', NULL),
           (@IdVersion, N'solicitud', N'cancelar', NULL, N'cancelada'),
           (@IdVersion, N'divulgacion', N'aprobar', NULL, N'completada'),
           (@IdVersion, N'divulgacion', N'cancelar', NULL, N'cancelada');

    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.publicada', @Motivo, NULL,
            N'{"proceso":"REDIV","vigente":1,"tareas":["solicitud","divulgacion"]}');

    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.publicado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), NULL, N'{"proceso":"REDIV","version":1}', @Motivo);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, p.code, p.is_active, v.version_number, v.status,
  (SELECT COUNT(*) FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version) AS tareas,
  (SELECT COUNT(*) FROM [sgc].[flow_transition] t WHERE t.id_flow_version = v.id_flow_version) AS transiciones
FROM [sgc].[flow_process] p JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_company = @IdCompany AND p.code = N'REDIV';
