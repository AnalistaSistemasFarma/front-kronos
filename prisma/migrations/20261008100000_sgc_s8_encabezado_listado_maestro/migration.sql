/*
  Migración: sgc_s8_encabezado_listado_maestro
  SGC documental — Sprint 8 del plan del 2026-10-08 (socialización con Calidad
  OLP del 2026-10-07): encabezado institucional obligatorio, carga inicial de
  vigentes abierta/cerrada, herencia del número del documento padre en la guía
  de codificación e importación del listado maestro (Excel).

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[company_config]:
        header_mandatory (BIT, 1 por defecto): el encabezado institucional es
          obligatorio en documento nuevo y nueva versión; el borrador PDF se
          rechaza. Configurable por empresa para poder revertirlo sin código.
        initial_load_open (BIT, 1 por defecto) + initial_load_closed_by,
          initial_load_closed_at, initial_load_close_reason: carga inicial de
          vigentes (sin el encabezado del sistema) abierta; Calidad la cierra
          con motivo (Sprint 9). CHECK: cerrada ⇒ quién, cuándo y motivo.
    - [sgc].[coding_guide]: child_pattern, child_type_codes,
        child_sequence_digits (herencia del número del padre; NULL = sin
        herencia, como hasta hoy). CHECK de los dígitos (1–6).
    - [sgc].[request].id_parent_document (FK a sgc.document): documento padre
        del que hereda el número un formato o instructivo nuevo.
    - [sgc].[document]: CHECK de estado con «pendiente_archivo» (documento del
        listado maestro al que le falta el PDF).
    - [sgc].[master_list_import] y [sgc].[master_list_import_row]: historial de
        cada importación del listado maestro con todas sus filas (cargadas o
        con error). SOLO INSERCIÓN (triggers).

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee las columnas nuevas).
  Idempotente: cada bloque verifica si el objeto existe. Es un cambio
  controlado del esquema `sgc` (lo declara en la sesión, ver Sprint 6).

  REVERSA: prisma/manual/2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008100000_sgc_s8_encabezado_listado_maestro (Sprint 8, socialización con Calidad OLP 2026-10-07)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'header_mandatory') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [header_mandatory] BIT NOT NULL CONSTRAINT [company_config_header_mandatory_df] DEFAULT 1;
IF COL_LENGTH(N'sgc.company_config', N'initial_load_open') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [initial_load_open] BIT NOT NULL CONSTRAINT [company_config_initial_load_open_df] DEFAULT 1;
IF COL_LENGTH(N'sgc.company_config', N'initial_load_closed_by') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [initial_load_closed_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.company_config', N'initial_load_closed_at') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [initial_load_closed_at] DATETIME2 NULL;
IF COL_LENGTH(N'sgc.company_config', N'initial_load_close_reason') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [initial_load_close_reason] NVARCHAR(1000) NULL;

IF COL_LENGTH(N'sgc.coding_guide', N'child_pattern') IS NULL
  ALTER TABLE [sgc].[coding_guide] ADD [child_pattern] NVARCHAR(200) NULL;
IF COL_LENGTH(N'sgc.coding_guide', N'child_type_codes') IS NULL
  ALTER TABLE [sgc].[coding_guide] ADD [child_type_codes] NVARCHAR(200) NULL;
IF COL_LENGTH(N'sgc.coding_guide', N'child_sequence_digits') IS NULL
  ALTER TABLE [sgc].[coding_guide] ADD [child_sequence_digits] INT NULL;

IF COL_LENGTH(N'sgc.request', N'id_parent_document') IS NULL
  ALTER TABLE [sgc].[request] ADD [id_parent_document] INT NULL;

IF OBJECT_ID(N'[sgc].[master_list_import]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[master_list_import] (
      [id_master_list_import] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [file_name] NVARCHAR(260) NOT NULL,
      [rows_sha256] CHAR(64) NOT NULL,
      [rows_total] INT NOT NULL,
      [rows_loaded] INT NOT NULL,
      [rows_error] INT NOT NULL,
      [imported_by] NVARCHAR(255) NOT NULL,
      [imported_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      CONSTRAINT [master_list_import_pkey] PRIMARY KEY CLUSTERED ([id_master_list_import]),
      CONSTRAINT [master_list_import_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [master_list_import_id_company_imported_at_idx] ON [sgc].[master_list_import]([id_company], [imported_at]);
END;

IF OBJECT_ID(N'[sgc].[master_list_import_row]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[master_list_import_row] (
      [id_master_list_import_row] INT NOT NULL IDENTITY(1,1),
      [id_master_list_import] INT NOT NULL,
      [row_number] INT NOT NULL,
      [code] NVARCHAR(60) NULL,
      [title] NVARCHAR(300) NULL,
      [document_type_code] NVARCHAR(10) NULL,
      [process_code] NVARCHAR(10) NULL,
      [version_number] INT NULL,
      [effective_date] DATE NULL,
      [confidentiality] NVARCHAR(20) NULL,
      [parent_code] NVARCHAR(60) NULL,
      [status] NVARCHAR(20) NOT NULL,
      [errors] NVARCHAR(2000) NULL,
      [warnings] NVARCHAR(2000) NULL,
      [id_document] INT NULL,
      CONSTRAINT [master_list_import_row_pkey] PRIMARY KEY CLUSTERED ([id_master_list_import_row]),
      CONSTRAINT [master_list_import_row_id_master_list_import_fkey] FOREIGN KEY ([id_master_list_import]) REFERENCES [sgc].[master_list_import]([id_master_list_import]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [master_list_import_row_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [master_list_import_row_id_master_list_import_idx] ON [sgc].[master_list_import_row]([id_master_list_import]);
  CREATE NONCLUSTERED INDEX [master_list_import_row_id_document_idx] ON [sgc].[master_list_import_row]([id_document]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/* Llaves y restricciones sobre columnas nuevas (en lote aparte: se compilan después de crearlas). */
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'request_id_parent_document_fkey')
  EXEC sp_executesql N'ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_parent_document_fkey] FOREIGN KEY ([id_parent_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_carga_inicial_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[company_config] ADD CONSTRAINT [company_config_carga_inicial_ck] CHECK ([initial_load_open] = 1 OR ([initial_load_closed_by] IS NOT NULL AND [initial_load_closed_at] IS NOT NULL AND LEN([initial_load_close_reason]) >= 10));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'coding_guide_herencia_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[coding_guide] ADD CONSTRAINT [coding_guide_herencia_ck] CHECK ([child_sequence_digits] IS NULL OR [child_sequence_digits] BETWEEN 1 AND 6);';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'master_list_import_row_status_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[master_list_import_row] ADD CONSTRAINT [master_list_import_row_status_ck] CHECK ([status] IN (N''cargada'', N''error''));';

/* Estado «pendiente de archivo» del documento (se rehace el CHECK del Sprint 1 solo si aún no lo admite). */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck' AND definition NOT LIKE N'%pendiente_archivo%')
  EXEC sp_executesql N'ALTER TABLE [sgc].[document] DROP CONSTRAINT [document_status_ck];';
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_status_ck] CHECK ([status] IN (N''borrador'', N''vigente'', N''obsoleto'', N''anulado'', N''pendiente_archivo''));';

/* Solo inserción: el historial del listado maestro no se modifica ni se borra. */
IF OBJECT_ID(N'[sgc].[master_list_import_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[master_list_import_solo_insercion]
ON [sgc].[master_list_import]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51060, N''sgc.master_list_import es de solo inserción: el historial del listado maestro no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[master_list_import_row_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[master_list_import_row_solo_insercion]
ON [sgc].[master_list_import_row]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51061, N''sgc.master_list_import_row es de solo inserción: las filas del listado maestro no se modifican ni se borran.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
