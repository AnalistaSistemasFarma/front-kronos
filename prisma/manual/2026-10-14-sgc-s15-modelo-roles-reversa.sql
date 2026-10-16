/*
  REVERSA de la migración 20261014100000_sgc_s15_modelo_roles (SGC, Sprint 15,
  modelo de roles del DOC v7). Se corre DESPUÉS de la reversa de datos
  (2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql) y con el código ANTERIOR ya
  desplegado.

  Quita sgc.flow_version.role_model (con su CHECK), sgc.approver_authorization.
  id_department (con su FK, índice y CHECK) y devuelve el CHECK de las
  transiciones a aprobar/devolver/cancelar; borra el registro de la migración.

  ⚠️ SE NIEGA (THROW) si:
    - hay solicitudes ABIERTAS o en espera en una versión «solicitante_elabora»
      (el código anterior las trataría como del modelo viejo): ciérrelas o
      declare sgc_reversa_modelo_roles = 1 en la sesión (las pasa a moverse
      con las reglas viejas, bajo su responsabilidad);
    - hay LÍDERES POR DEPARTAMENTO registrados: el código anterior los leería
      como «aprobador de todos los procesos» y ACTIVARÍA la lista del S12. Con
      sgc_reversa_lideres_departamento = 1, en cada empresa que solo tenga
      líderes por departamento (sin aprobadores por proceso) se apaga
      company_config.approver_list_enforced (con su control de cambios); si una
      empresa tiene ambos, se niega igual (se resuelve a mano).
  ⚠️ El CHECK de las transiciones se CONSERVA con «rechazar» si alguna versión
  (aunque esté retirada) tiene esa transición: las versiones no se editan.
  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @abiertas INT = 0;
IF COL_LENGTH(N'sgc.flow_version', N'role_model') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[request] r JOIN [sgc].[flow_version] v ON v.id_flow_version = r.id_flow_version WHERE v.[role_model] = N''solicitante_elabora'' AND r.[status] IN (N''abierta'', N''en_espera'')', N'@n INT OUTPUT', @n = @abiertas OUTPUT;
IF @abiertas > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_modelo_roles') AS INT) IS NULL
  THROW 51150, N'Hay solicitudes abiertas con el flujo DOC v7 (el solicitante elabora): ciérrelas o declare sgc_reversa_modelo_roles = 1 antes de la reversa.', 1;

DECLARE @lideres INT = 0;
IF COL_LENGTH(N'sgc.approver_authorization', N'id_department') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[approver_authorization] WHERE [id_department] IS NOT NULL', N'@n INT OUTPUT', @n = @lideres OUTPUT;
IF @lideres > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_lideres_departamento') AS INT) IS NULL
  THROW 51151, N'Hay líderes aprobadores por departamento: el código anterior los leería como aprobadores de todos los procesos. Exporte la lista y declare sgc_reversa_lideres_departamento = 1 (apaga la lista del S12 donde solo haya líderes por departamento).', 1;

IF @lideres > 0
BEGIN
  DECLARE @mixtas INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(DISTINCT a.id_company) FROM [sgc].[approver_authorization] a WHERE a.[id_department] IS NOT NULL AND EXISTS (SELECT 1 FROM [sgc].[approver_authorization] b WHERE b.id_company = a.id_company AND b.[id_department] IS NULL)', N'@n INT OUTPUT', @n = @mixtas OUTPUT;
  IF @mixtas > 0
    THROW 51152, N'Hay empresas con líderes por departamento Y aprobadores por proceso: la reversa no puede decidir por ellas; resuélvalo a mano.', 1;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  EXEC sp_executesql N'
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    SELECT DISTINCT c.id_company, @Now, N''reversa-s15'', N''company_config'', CAST(c.id_company AS NVARCHAR(60)), N''empresa.lista_aprobadores'', N''Reversa del S15: la empresa solo tenía líderes por departamento; se apaga la lista del S12 para que no la active el código anterior.'', N''{"approverListEnforced":true}'', N''{"approverListEnforced":false}''
    FROM [sgc].[company_config] c WHERE c.approver_list_enforced = 1 AND EXISTS (SELECT 1 FROM [sgc].[approver_authorization] a WHERE a.id_company = c.id_company AND a.[id_department] IS NOT NULL);
    UPDATE c SET c.approver_list_enforced = 0, c.updated_at = @Now
    FROM [sgc].[company_config] c WHERE c.approver_list_enforced = 1 AND EXISTS (SELECT 1 FROM [sgc].[approver_authorization] a WHERE a.id_company = c.id_company AND a.[id_department] IS NOT NULL);', N'@Now DATETIME2', @Now = @Now;
END;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261014100000_sgc_s15_modelo_roles';

IF OBJECT_ID(N'[sgc].[approver_authorization_id_department_fkey]', N'F') IS NOT NULL
  ALTER TABLE [sgc].[approver_authorization] DROP CONSTRAINT [approver_authorization_id_department_fkey];
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'approver_authorization_alcance_ck')
  ALTER TABLE [sgc].[approver_authorization] DROP CONSTRAINT [approver_authorization_alcance_ck];
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'approver_authorization_id_department_idx' AND object_id = OBJECT_ID(N'[sgc].[approver_authorization]'))
  DROP INDEX [approver_authorization_id_department_idx] ON [sgc].[approver_authorization];
IF COL_LENGTH(N'sgc.approver_authorization', N'id_department') IS NOT NULL
  ALTER TABLE [sgc].[approver_authorization] DROP COLUMN [id_department];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_version_role_model_ck')
  ALTER TABLE [sgc].[flow_version] DROP CONSTRAINT [flow_version_role_model_ck];
IF COL_LENGTH(N'sgc.flow_version', N'role_model') IS NOT NULL
  ALTER TABLE [sgc].[flow_version] DROP COLUMN [role_model];

IF NOT EXISTS (SELECT 1 FROM [sgc].[flow_transition] WHERE [action] = N'rechazar')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_transition_action_ck' AND [definition] LIKE N'%rechazar%')
    ALTER TABLE [sgc].[flow_transition] DROP CONSTRAINT [flow_transition_action_ck];
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_transition_action_ck')
    ALTER TABLE [sgc].[flow_transition] ADD CONSTRAINT [flow_transition_action_ck]
      CHECK ([action] IN (N'aprobar', N'devolver', N'cancelar') AND ([to_task_key] IS NOT NULL OR [terminal_status] IN (N'completada', N'cancelada')));
END
ELSE
  PRINT N'AVISO: se CONSERVA «rechazar» en flow_transition_action_ck: hay versiones del flujo (retiradas o no) con esa transición y no se editan.';

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261014100000_sgc_s15_modelo_roles';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
