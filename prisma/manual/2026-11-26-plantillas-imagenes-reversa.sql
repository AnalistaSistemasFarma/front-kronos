/*
  REVERSAL — append_images of document templates (2026-11-26). Deploy the previous CODE first.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51862, N'Unexpected database: this reversal only runs on KRONOSDB, KRONOSDB_PRUEBAS or kronos_ci.', 1;

IF OBJECT_ID(N'dbo.DF_task_doc_template_append_images', N'D') IS NOT NULL ALTER TABLE dbo.task_doc_template DROP CONSTRAINT DF_task_doc_template_append_images;
IF COL_LENGTH(N'dbo.task_doc_template', N'append_images') IS NOT NULL ALTER TABLE dbo.task_doc_template DROP COLUMN append_images;
SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.task_doc_template', N'append_images') AS append_images;
