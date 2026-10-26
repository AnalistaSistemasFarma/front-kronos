/*
  REVERSA — SGC documental: FLUJO «REDIV» (redivulgación). Sirve para KRONOSDB_PRUEBAS y KRONOSDB.
  Retira la versión vigente de REDIV y desactiva el proceso (nunca borra: las solicitudes de
  redivulgación ya hechas conservan su flujo, sus lecturas y su auditoría). Con el proceso
  inactivo, SynerLink ya no permite crear redivulgaciones (falta el flujo vigente).
  Idempotente. Deja el cambio en sgc.config_change_log y sgc.audit_log.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS')
  THROW 51195, N'Base no esperada: esta reversa es solo para KRONOSDB o KRONOSDB_PRUEBAS.', 1;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Reversa de la redivulgación de documentos vigentes (flujo REDIV).';
DECLARE @IdProcess INT = (SELECT id_flow_process FROM [sgc].[flow_process] WHERE id_company = @IdCompany AND code = N'REDIV');

SELECT 'antes' AS momento, p.code, p.is_active, v.version_number, v.status
FROM [sgc].[flow_process] p LEFT JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_flow_process = @IdProcess;

SELECT 'en_curso' AS momento, r.id_request, r.status, r.current_task_key
FROM [sgc].[request] r JOIN [sgc].[flow_version] v ON v.id_flow_version = r.id_flow_version
WHERE v.id_flow_process = @IdProcess AND r.status IN (N'abierta', N'en_espera');

IF @IdProcess IS NOT NULL AND EXISTS (SELECT 1 FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente')
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();
    DECLARE @IdVersion INT = (SELECT id_flow_version FROM [sgc].[flow_version] WHERE id_flow_process = @IdProcess AND status = N'vigente');
    UPDATE [sgc].[flow_version] SET status = N'retirada', retired_at = @Now, updated_at = @Now WHERE id_flow_version = @IdVersion;
    UPDATE [sgc].[flow_process] SET is_active = 0, updated_at = @Now WHERE id_flow_process = @IdProcess;
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, id_flow_process, id_flow_version, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), @IdProcess, @IdVersion, N'version.retirada', @Motivo, N'{"proceso":"REDIV","vigente":1}', N'{"proceso":"REDIV","activo":false}');
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'flujo.retirado', N'flow_version', CAST(@IdVersion AS NVARCHAR(60)), N'{"proceso":"REDIV","version":1}', N'{"activo":false}', @Motivo);
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

SELECT 'despues' AS momento, p.code, p.is_active, v.version_number, v.status
FROM [sgc].[flow_process] p LEFT JOIN [sgc].[flow_version] v ON v.id_flow_process = p.id_flow_process
WHERE p.id_flow_process = @IdProcess;
