/*
  REVERSA — Tarea «Plantilla de documento» (2026-11-18). Sirve para PRUEBAS, kronos_ci o KRONOSDB.
  Antes de correrla en una base con datos: respaldar task_doc_template y request_generated_document.
  Las tareas con task_kind = 'doc_template' pasan a 'normal' para poder restaurar el CHECK anterior.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.request_generated_document', N'U') IS NOT NULL DROP TABLE [dbo].[request_generated_document];
  IF OBJECT_ID(N'dbo.task_doc_template', N'U') IS NOT NULL DROP TABLE [dbo].[task_doc_template];

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_task_process_category_task_kind'
             AND definition LIKE N'%doc_template%')
  BEGIN
    EXEC (N'UPDATE [dbo].[task_process_category] SET task_kind = N''normal'' WHERE task_kind = N''doc_template'';');
    ALTER TABLE [dbo].[task_process_category] DROP CONSTRAINT [CK_task_process_category_task_kind];
    EXEC (N'ALTER TABLE [dbo].[task_process_category] ADD CONSTRAINT [CK_task_process_category_task_kind]
           CHECK ([task_kind] IN (N''normal'', N''authorization'', N''sap_executor''));');
  END

  COMMIT TRANSACTION;
  PRINT N'Reversa aplicada en ' + DB_NAME();
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
