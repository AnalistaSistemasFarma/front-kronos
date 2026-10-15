/*
  REVERSA de la migración 20261014110000_sgc_s16_encabezados_excel (SGC,
  Sprint 16) y de su dato de OLP. Se corre con el código ANTERIOR ya
  desplegado y ANTES de la reversa del S15.

  Quita sgc.header_template (con su trigger, índice y CHECK),
  document_type.id_header_template y draft_extensions, bulk_upload_item.
  source_kind y, si ninguna versión la usa, document_version.source_sha256.

  ⚠️ SE NIEGA (THROW) sin sgc_reversa_encabezados = 1 si hay plantillas de
  encabezado, tipos con Excel habilitado o solicitudes ABIERTAS con un
  borrador en Excel (el código anterior no sabe componerlo).
  ⚠️ document_version.source_sha256 se CONSERVA si alguna versión la usa (es
  la huella del original de una carga inicial: no se borra evidencia; el
  código anterior no la lee).
  Cambio controlado (trigger del Sprint 6). Idempotente.
*/
SET NOCOUNT ON;

DECLARE @n INT = 0;
IF OBJECT_ID(N'[sgc].[header_template]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[header_template]', N'@n INT OUTPUT', @n = @n OUTPUT;
DECLARE @excel INT = 0;
IF COL_LENGTH(N'sgc.document_type', N'draft_extensions') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[document_type] WHERE [draft_extensions] LIKE N''%xlsx%''', N'@n INT OUTPUT', @n = @excel OUTPUT;
DECLARE @abiertas INT = (
  SELECT COUNT(*) FROM [sgc].[request] r
  WHERE r.[status] IN (N'abierta', N'en_espera')
    AND EXISTS (SELECT 1 FROM [sgc].[attachment] a WHERE a.id_request = r.id_request AND a.purpose = N'borrador' AND a.withdrawn_at IS NULL AND LOWER(a.file_name) LIKE N'%.xlsx'));
IF (@n + @excel + @abiertas) > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_encabezados') AS INT) IS NULL
  THROW 51161, N'Hay plantillas de encabezado, tipos con borrador en Excel o solicitudes abiertas con un Excel: exporte la configuración, cierre o devuelva esas solicitudes y declare sgc_reversa_encabezados = 1.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261014110000_sgc_s16_encabezados_excel';

IF OBJECT_ID(N'[sgc].[document_type_id_header_template_fkey]', N'F') IS NOT NULL
  ALTER TABLE [sgc].[document_type] DROP CONSTRAINT [document_type_id_header_template_fkey];
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_type_draft_extensions_ck')
  ALTER TABLE [sgc].[document_type] DROP CONSTRAINT [document_type_draft_extensions_ck];
IF COL_LENGTH(N'sgc.document_type', N'id_header_template') IS NOT NULL
  ALTER TABLE [sgc].[document_type] DROP COLUMN [id_header_template];
IF COL_LENGTH(N'sgc.document_type', N'draft_extensions') IS NOT NULL
  ALTER TABLE [sgc].[document_type] DROP COLUMN [draft_extensions];

IF OBJECT_ID(N'[sgc].[header_template_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[header_template_sin_borrado];
IF OBJECT_ID(N'[sgc].[header_template]', N'U') IS NOT NULL DROP TABLE [sgc].[header_template];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'bulk_upload_item_source_kind_ck')
  ALTER TABLE [sgc].[bulk_upload_item] DROP CONSTRAINT [bulk_upload_item_source_kind_ck];
IF COL_LENGTH(N'sgc.bulk_upload_item', N'source_kind') IS NOT NULL
  ALTER TABLE [sgc].[bulk_upload_item] DROP COLUMN [source_kind];

DECLARE @conHuella INT = 0;
IF COL_LENGTH(N'sgc.document_version', N'source_sha256') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[document_version] WHERE [source_sha256] IS NOT NULL', N'@n INT OUTPUT', @n = @conHuella OUTPUT;
  IF @conHuella = 0
    ALTER TABLE [sgc].[document_version] DROP COLUMN [source_sha256];
  ELSE
    PRINT CONCAT(N'AVISO: se CONSERVA sgc.document_version.source_sha256: ', @conHuella, N' versión(es) guardan la huella de su original Word o Excel.');
END;

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261014110000_sgc_s16_encabezados_excel';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
