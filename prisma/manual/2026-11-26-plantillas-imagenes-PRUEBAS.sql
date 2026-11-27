/*
  MANUAL MIGRATION (PRUEBAS) — «Anexar las imágenes de la solicitud» in document templates (2026-11-26; Calidad OLP:
  informe de auditoría con imágenes). Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conv. 129).
  WHAT IT DOES (idempotent, additive): dbo.task_doc_template.append_images BIT NOT NULL DEFAULT 0 (0 = as today).
  Locks: metadata-only. ORDER: before the code. REVERSAL: prisma/manual/2026-11-26-plantillas-imagenes-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51860, N'Unexpected database: this script is only for KRONOSDB_PRUEBAS.', 1;

IF COL_LENGTH(N'dbo.task_doc_template', N'append_images') IS NULL
  ALTER TABLE dbo.task_doc_template ADD append_images BIT NOT NULL CONSTRAINT DF_task_doc_template_append_images DEFAULT 0;

SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.task_doc_template', N'append_images') AS append_images;
