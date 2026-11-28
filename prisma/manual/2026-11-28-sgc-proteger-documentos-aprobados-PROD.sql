/*
  PASE MANUAL — SGC documental: PROTECCIÓN DE DOCUMENTOS Y VERSIONES APROBADOS (brecha F1, URS-FLU-03 y URS-RET-01).
  Base: KRONOSDB (la guarda DB_NAME() lo exige).

  QUÉ HACE (idempotente: si los triggers ya existen, no hace nada; sin cambios de datos):
    1. sgc.document_version: prohíbe borrar versiones y, en versiones ya aprobadas (estado distinto
       de borrador), cambiar archivo, huellas, manifiesto, número, documento, autor o solicitud.
       El estado solo avanza: vigente -> obsoleto | anulado; obsoleto -> anulado.
    2. sgc.document: prohíbe borrar documentos y, en documentos vigentes u obsoletos, cambiar
       empresa, código, título, autor o fecha de creación.
  La app ya cumple estas reglas (lib/sgc/db/vigencia.ts, documents.ts); los triggers las vuelven
  obligatorias también para cualquier SQL directo. Cambia la estructura del esquema sgc con
  sesión declarada (queda en sgc.ddl_event_log).

  CÓMO CORRERLO: scripts/sgc/pase-produccion/aplicar-sql.mjs (verifica DB_NAME()).
  Primero en PRUEBAS; en producción solo con la autorización del pase (script -PROD).
  REVERSA: prisma/manual/2026-11-28-sgc-proteger-documentos-aprobados-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51300, N'Base no esperada para este script (PROD): debe correrse en KRONOSDB.', 1;
IF OBJECT_ID(N'[sgc].[document_version]', N'U') IS NULL OR OBJECT_ID(N'[sgc].[document]', N'U') IS NULL
  THROW 51301, N'No existe el esquema sgc en esta base.', 1;

-- Cambio controlado del esquema sgc (queda en sgc.ddl_event_log).
EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'SGC validación F1/URS-FLU-03 (2026-11-28): protección de documentos y versiones aprobados.';

DECLARE @antes INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_proteger_aprobada', N'document_proteger_aprobado'));
PRINT N'Antes: ' + CAST(@antes AS NVARCHAR(10)) + N' de 2 triggers.';

/* 1. Versiones: nunca se borran; una vez aprobadas (estado distinto de borrador) su archivo,
      huellas, manifiesto e identidad no cambian, y el estado solo avanza:
      vigente -> obsoleto | anulado; obsoleto -> anulado. */
IF OBJECT_ID(N'[sgc].[document_version_proteger_aprobada]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_version_proteger_aprobada]
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

/* 2. Documentos: nunca se borran; una vez aprobados (vigente u obsoleto) no cambian su empresa,
      código ni título (el título solo cambia con una nueva versión). */
IF OBJECT_ID(N'[sgc].[document_proteger_aprobado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_proteger_aprobado]
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

DECLARE @despues INT = (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'document_version_proteger_aprobada', N'document_proteger_aprobado') AND is_disabled = 0);
PRINT N'Después: ' + CAST(@despues AS NVARCHAR(10)) + N' de 2 triggers activos.';
