/*
  REVERSA — SGC documental: retira los triggers de protección de documentos y versiones aprobados
  (2026-11-28-sgc-proteger-documentos-aprobados-*.sql). No toca datos.
  Sirve en KRONOSDB_PRUEBAS y en KRONOSDB (solo con autorización). Cambio controlado del esquema sgc.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB')
  THROW 51330, N'Base no esperada para la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa SGC F1 (2026-11-28): retiro de los triggers de protección de documentos aprobados.';

IF OBJECT_ID(N'[sgc].[document_version_proteger_aprobada]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[document_version_proteger_aprobada];
IF OBJECT_ID(N'[sgc].[document_proteger_aprobado]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[document_proteger_aprobado];

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;

DECLARE @restantes INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_proteger_aprobada', N'document_proteger_aprobado'));
PRINT N'Triggers restantes: ' + CAST(@restantes AS NVARCHAR(10));
