/*
  REVERSA de la migración 20261008100000_sgc_s8_encabezado_listado_maestro
  (SGC, Sprint 8: encabezado obligatorio, carga inicial, herencia del número
  del padre y listado maestro) y de su dato opcional
  (prisma/manual/2026-10-08-sgc-s8-guia-codificacion-olp.sql).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 7: quita las tablas
  master_list_import y master_list_import_row (con sus triggers), la columna
  request.id_parent_document (con su FK), las columnas nuevas de
  company_config y coding_guide (con sus CHECK y DEFAULT), devuelve el CHECK
  de estado del documento al del Sprint 1 y borra el registro de la migración
  en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior (Prisma lee
  estas columnas). ⚠️ Los documentos «pendientes de archivo» (importados del
  listado maestro sin PDF) NO caben en el CHECK anterior: la reversa se niega
  a correr si existe alguno, salvo que se declare
  sgc_reversa_pendientes_archivo = 1 en la sesión, y en ese caso los pasa a
  «anulado» con su motivo (no se borra ningún documento). También se niega si
  hay solicitudes con documento padre (se perdería con quién heredan el
  número), salvo sgc_reversa_padres = 1. Exportar antes sgc.master_list_import
  y sgc.master_list_import_row si se necesitan como evidencia.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

IF COL_LENGTH(N'sgc.request', N'id_parent_document') IS NOT NULL
   AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_padres') AS INT) IS NULL
BEGIN
  DECLARE @padres INT;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[request] WHERE [id_parent_document] IS NOT NULL', N'@n INT OUTPUT', @n = @padres OUTPUT;
  IF @padres > 0
    THROW 51062, N'Hay solicitudes con documento padre: exporte sgc.request (id_request, id_parent_document) y declare sgc_reversa_padres = 1 antes de la reversa.', 1;
END;

DECLARE @pendientes INT = (SELECT COUNT(*) FROM [sgc].[document] WHERE [status] = N'pendiente_archivo');
IF @pendientes > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_pendientes_archivo') AS INT) IS NULL
  THROW 51063, N'Hay documentos pendientes de archivo (listado maestro): exporte el listado y declare sgc_reversa_pendientes_archivo = 1 para anularlos antes de la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008100000_sgc_s8_encabezado_listado_maestro';

IF @pendientes > 0
BEGIN
  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
  SELECT id_company, SYSUTCDATETIME(), N'reversa-s8', N'documento.anulacion', N'document', CAST(id_document AS NVARCHAR(60)), N'{"status":"pendiente_archivo"}', N'{"status":"anulado"}', N'Reversa del Sprint 8: el documento importado del listado maestro sin PDF se anula.'
  FROM [sgc].[document] WHERE [status] = N'pendiente_archivo';
  UPDATE [sgc].[document] SET [status] = N'anulado', [annulled_by] = N'reversa-s8', [annulled_at] = SYSUTCDATETIME(), [annul_reason] = N'Reversa del Sprint 8: documento del listado maestro sin PDF.', [updated_at] = SYSUTCDATETIME() WHERE [status] = N'pendiente_archivo';
END;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck' AND definition LIKE N'%pendiente_archivo%')
  ALTER TABLE [sgc].[document] DROP CONSTRAINT [document_status_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck')
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_status_ck] CHECK ([status] IN (N'borrador', N'vigente', N'obsoleto', N'anulado'));

IF OBJECT_ID(N'[sgc].[master_list_import_row_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[master_list_import_row_solo_insercion];
IF OBJECT_ID(N'[sgc].[master_list_import_row]', N'U') IS NOT NULL
  DROP TABLE [sgc].[master_list_import_row];
IF OBJECT_ID(N'[sgc].[master_list_import_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[master_list_import_solo_insercion];
IF OBJECT_ID(N'[sgc].[master_list_import]', N'U') IS NOT NULL
  DROP TABLE [sgc].[master_list_import];

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'request_id_parent_document_fkey')
  ALTER TABLE [sgc].[request] DROP CONSTRAINT [request_id_parent_document_fkey];
IF COL_LENGTH(N'sgc.request', N'id_parent_document') IS NOT NULL
  ALTER TABLE [sgc].[request] DROP COLUMN [id_parent_document];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'coding_guide_herencia_ck')
  ALTER TABLE [sgc].[coding_guide] DROP CONSTRAINT [coding_guide_herencia_ck];
IF COL_LENGTH(N'sgc.coding_guide', N'child_pattern') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_pattern];
IF COL_LENGTH(N'sgc.coding_guide', N'child_type_codes') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_type_codes];
IF COL_LENGTH(N'sgc.coding_guide', N'child_sequence_digits') IS NOT NULL
  ALTER TABLE [sgc].[coding_guide] DROP COLUMN [child_sequence_digits];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_carga_inicial_ck')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_carga_inicial_ck];
DECLARE @df1 SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'header_mandatory');
IF @df1 IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df1 + N']');
DECLARE @df2 SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'initial_load_open');
IF @df2 IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df2 + N']');
IF COL_LENGTH(N'sgc.company_config', N'header_mandatory') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [header_mandatory];
IF COL_LENGTH(N'sgc.company_config', N'initial_load_open') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_open];
IF COL_LENGTH(N'sgc.company_config', N'initial_load_closed_by') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_closed_by];
IF COL_LENGTH(N'sgc.company_config', N'initial_load_closed_at') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_closed_at];
IF COL_LENGTH(N'sgc.company_config', N'initial_load_close_reason') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [initial_load_close_reason];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008100000_sgc_s8_encabezado_listado_maestro';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
