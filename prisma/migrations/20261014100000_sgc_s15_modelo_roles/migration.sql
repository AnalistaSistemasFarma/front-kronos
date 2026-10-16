/*
  Migración: sgc_s15_modelo_roles
  SGC documental — Sprint 15 del plan del 2026-10-13 (primera prueba en
  producción con Calidad OLP): NUEVO MODELO DE ROLES del flujo documental
  (DOC v7; R15 a R19 y R27).

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[flow_version].[role_model] (NULL): modelo de roles de la versión.
        NULL = calidad_asigna (hasta el DOC v6, como hoy);
        solicitante_elabora = el solicitante elabora y asigna firmantes de su
        departamento, y Calidad autoriza la creación. Las solicitudes en curso
        conservan su versión (y su modelo).
    - [sgc].[approver_authorization].[id_department] (NULL): LÍDER que aprueba
        los documentos de un departamento (R19). NULL = autorización por
        proceso del S12 (sin cambios). La lista por departamento solo restringe
        si la empresa enciende el ajuste (apagado por defecto, decisión D16).
    - CHECK [flow_transition_action_ck]: admite la acción «rechazar» (Calidad
        NO autoriza la creación; cierra la solicitud como cancelada, R15).

  Los DATOS del flujo DOC v7 de OLP van aparte:
  prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-olp.sql (después del código).

  ⚠️ ORDEN DEL PASE: después de las del S13 y ANTES que el código del S15 (el
  código lee role_model e id_department). Idempotente. Cambio controlado del
  esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-14-sgc-s15-modelo-roles-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261014100000_sgc_s15_modelo_roles (Sprint 15, DOC v7)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.flow_version', N'role_model') IS NULL
  ALTER TABLE [sgc].[flow_version] ADD [role_model] NVARCHAR(30) NULL;

IF COL_LENGTH(N'sgc.approver_authorization', N'id_department') IS NULL
  ALTER TABLE [sgc].[approver_authorization] ADD [id_department] INT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_version_role_model_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[flow_version] ADD CONSTRAINT [flow_version_role_model_ck] CHECK ([role_model] IS NULL OR [role_model] IN (N''calidad_asigna'', N''solicitante_elabora''));';

IF OBJECT_ID(N'[sgc].[approver_authorization_id_department_fkey]', N'F') IS NULL
  EXEC sp_executesql N'ALTER TABLE [sgc].[approver_authorization] ADD CONSTRAINT [approver_authorization_id_department_fkey] FOREIGN KEY ([id_department]) REFERENCES [dbo].[department]([id_department]) ON DELETE NO ACTION ON UPDATE NO ACTION;';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'approver_authorization_id_department_idx' AND object_id = OBJECT_ID(N'[sgc].[approver_authorization]'))
  EXEC sp_executesql N'CREATE NONCLUSTERED INDEX [approver_authorization_id_department_idx] ON [sgc].[approver_authorization]([id_company], [id_department]);';

-- Un líder se registra por departamento O por proceso (nunca ambos).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'approver_authorization_alcance_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[approver_authorization] ADD CONSTRAINT [approver_authorization_alcance_ck] CHECK ([id_department] IS NULL OR [id_process_map] IS NULL);';

-- La acción «rechazar» (S15, R15): se reemplaza el CHECK del S2 solo si aún no la admite.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_transition_action_ck' AND [definition] NOT LIKE N'%rechazar%')
  ALTER TABLE [sgc].[flow_transition] DROP CONSTRAINT [flow_transition_action_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_transition_action_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[flow_transition] ADD CONSTRAINT [flow_transition_action_ck] CHECK ([action] IN (N''aprobar'', N''devolver'', N''cancelar'', N''rechazar'') AND ([to_task_key] IS NOT NULL OR [terminal_status] IN (N''completada'', N''cancelada'')));';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
