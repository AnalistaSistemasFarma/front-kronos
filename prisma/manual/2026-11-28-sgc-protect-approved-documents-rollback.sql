/*
  ROLLBACK - SGC documents: removes the triggers that protect approved documents and versions
  (2026-11-28-sgc-protect-approved-documents-*.sql). No data changes.
  Works in the test and production databases (production only with authorization).
  Controlled change of the sgc schema.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB')
  THROW 51330, N'Base no esperada para la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Rollback SGC F1 (2026-11-28): removal of the approved-document protection triggers.';

IF OBJECT_ID(N'[sgc].[document_version_protect_approved]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[document_version_protect_approved];
IF OBJECT_ID(N'[sgc].[document_protect_approved]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[document_protect_approved];

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;

DECLARE @remaining INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_protect_approved', N'document_protect_approved'));
PRINT N'Remaining triggers: ' + CAST(@remaining AS NVARCHAR(10));
