/*
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

IF OBJECT_ID(N'[sgc].[config_change_log_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[config_change_log_solo_insercion];
GO

IF OBJECT_ID(N'[sgc].[interaction_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[interaction_solo_insercion];
GO

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'[sgc].[authorization]', N'U') IS NOT NULL            DROP TABLE [sgc].[authorization];
  IF OBJECT_ID(N'[sgc].[authorization_type_user]', N'U') IS NOT NULL  DROP TABLE [sgc].[authorization_type_user];
  IF OBJECT_ID(N'[sgc].[authorization_type]', N'U') IS NOT NULL       DROP TABLE [sgc].[authorization_type];
  IF OBJECT_ID(N'[sgc].[attachment]', N'U') IS NOT NULL               DROP TABLE [sgc].[attachment];
  IF OBJECT_ID(N'[sgc].[interaction]', N'U') IS NOT NULL              DROP TABLE [sgc].[interaction];
  IF OBJECT_ID(N'[sgc].[form_value]', N'U') IS NOT NULL               DROP TABLE [sgc].[form_value];
  IF OBJECT_ID(N'[sgc].[task_assignee]', N'U') IS NOT NULL            DROP TABLE [sgc].[task_assignee];
  IF OBJECT_ID(N'[sgc].[task]', N'U') IS NOT NULL                     DROP TABLE [sgc].[task];
  IF OBJECT_ID(N'[sgc].[request_signer]', N'U') IS NOT NULL           DROP TABLE [sgc].[request_signer];
  IF OBJECT_ID(N'[sgc].[request]', N'U') IS NOT NULL                  DROP TABLE [sgc].[request];
  IF OBJECT_ID(N'[sgc].[config_change_log]', N'U') IS NOT NULL        DROP TABLE [sgc].[config_change_log];
  IF OBJECT_ID(N'[sgc].[responsible_matrix]', N'U') IS NOT NULL       DROP TABLE [sgc].[responsible_matrix];
  IF OBJECT_ID(N'[sgc].[flow_form_field]', N'U') IS NOT NULL          DROP TABLE [sgc].[flow_form_field];
  IF OBJECT_ID(N'[sgc].[flow_transition]', N'U') IS NOT NULL          DROP TABLE [sgc].[flow_transition];
  IF OBJECT_ID(N'[sgc].[flow_task_def]', N'U') IS NOT NULL            DROP TABLE [sgc].[flow_task_def];
  IF OBJECT_ID(N'[sgc].[flow_version]', N'U') IS NOT NULL             DROP TABLE [sgc].[flow_version];
  IF OBJECT_ID(N'[sgc].[flow_process]', N'U') IS NOT NULL             DROP TABLE [sgc].[flow_process];
  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930200000_sgc_s2_flujos_tareas_autorizaciones';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO

SELECT 'despues' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N'sgc') ORDER BY t.name;
