/*
  MANUAL PASS - SGC documents: PROTECTION OF APPROVED DOCUMENTS AND VERSIONS (gap F1, URS-FLU-03, URS-RET-01).
  Database: production database (the DB_NAME() guard enforces it).

  WHAT IT DOES (idempotent: does nothing if the triggers already exist; no data changes):
    1. sgc.document_version: versions cannot be deleted; once approved (status other than
       borrador) their file, hashes, manifest, number, document, author and request cannot
       change, and the status only moves forward: vigente -> obsoleto | anulado; obsoleto -> anulado.
    2. sgc.document: documents cannot be deleted; vigente or obsoleto documents keep their
       company, code, title, author and creation date.
  The app already follows these rules (lib/sgc/db/vigencia.ts, documents.ts); the triggers make
  them mandatory for any direct SQL too. Structure change of the sgc schema with a declared
  session (logged in sgc.ddl_event_log).

  HOW TO RUN: scripts/sgc/pase-produccion/aplicar-sql.mjs (checks DB_NAME()).
  Test database first; production only with the pass authorization (-PROD script).
  ROLLBACK: prisma/manual/2026-11-28-sgc-protect-approved-documents-rollback.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51300, N'Base no esperada para este script (PROD): debe correrse en KRONOSDB.', 1;
IF OBJECT_ID(N'[sgc].[document_version]', N'U') IS NULL OR OBJECT_ID(N'[sgc].[document]', N'U') IS NULL
  THROW 51301, N'No existe el esquema sgc en esta base.', 1;

-- Controlled change of the sgc schema (logged in sgc.ddl_event_log).
EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'SGC validation F1/URS-FLU-03 (2026-11-28): protection of approved documents and versions.';

DECLARE @before INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_protect_approved', N'document_protect_approved'));
PRINT N'Before: ' + CAST(@before AS NVARCHAR(10)) + N' of 2 triggers.';

/* 1. Versions: never deleted; once approved their file, hashes, manifest and identity are fixed,
      and the status only moves forward. */
IF OBJECT_ID(N'[sgc].[document_version_protect_approved]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_version_protect_approved]
ON [sgc].[document_version]
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51310, N''sgc.document_version no permite borrar versiones: se anulan con motivo.'', 1;
  IF EXISTS (
    SELECT 1
    FROM deleted d
    JOIN inserted i ON i.id_document_version = d.id_document_version
    WHERE d.status <> N''borrador''
      AND (   i.id_document <> d.id_document
           OR i.version_number <> d.version_number
           OR i.pdf_item_id <> d.pdf_item_id
           OR i.pdf_path <> d.pdf_path
           OR i.pdf_file_name <> d.pdf_file_name
           OR i.pdf_sha256 <> d.pdf_sha256
           OR i.pdf_size <> d.pdf_size
           OR ISNULL(i.source_item_id, N'''') <> ISNULL(d.source_item_id, N'''')
           OR ISNULL(i.source_sha256, '''') <> ISNULL(d.source_sha256, '''')
           OR ISNULL(i.signed_content_sha256, '''') <> ISNULL(d.signed_content_sha256, '''')
           OR ISNULL(i.manifest_json, N'''') <> ISNULL(d.manifest_json, N'''')
           OR i.created_by <> d.created_by
           OR i.created_at <> d.created_at
           OR ISNULL(i.id_request, -1) <> ISNULL(d.id_request, -1))
  )
    THROW 51311, N''Una versión aprobada no se modifica: cualquier cambio exige una nueva versión.'', 1;
  IF EXISTS (
    SELECT 1
    FROM deleted d
    JOIN inserted i ON i.id_document_version = d.id_document_version
    WHERE i.status <> d.status
      AND NOT (   d.status = N''borrador''
               OR (d.status = N''vigente'' AND i.status IN (N''obsoleto'', N''anulado''))
               OR (d.status = N''obsoleto'' AND i.status = N''anulado''))
  )
    THROW 51312, N''Cambio de estado no permitido para una versión aprobada (vigente → obsoleto o anulado; obsoleto → anulado).'', 1;
END;';

/* 2. Documents: never deleted; approved ones keep company, code and title (title changes
      with a new version). */
IF OBJECT_ID(N'[sgc].[document_protect_approved]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_protect_approved]
ON [sgc].[document]
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51320, N''sgc.document no permite borrar documentos: se anulan con motivo.'', 1;
  IF EXISTS (
    SELECT 1
    FROM deleted d
    JOIN inserted i ON i.id_document = d.id_document
    WHERE d.status IN (N''vigente'', N''obsoleto'')
      AND (i.id_company <> d.id_company OR i.code <> d.code OR i.title <> d.title
           OR i.created_by <> d.created_by OR i.created_at <> d.created_at)
  )
    THROW 51321, N''Un documento aprobado no cambia su empresa, código ni título: el título cambia con una nueva versión.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;

DECLARE @after INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_protect_approved', N'document_protect_approved') AND is_disabled = 0);
PRINT N'After: ' + CAST(@after AS NVARCHAR(10)) + N' of 2 triggers enabled.';
