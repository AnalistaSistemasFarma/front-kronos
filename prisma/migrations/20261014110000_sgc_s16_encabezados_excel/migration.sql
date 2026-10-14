/*
  Migración: sgc_s16_encabezados_excel
  SGC documental — Sprint 16 del plan del 2026-10-13: ENCABEZADO POR TIPO
  DOCUMENTAL (R31, D20), FORMATOS EN EXCEL (R32, D17) y CARGA DE LO YA
  APROBADO EN WORD Y EXCEL (R33).

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`):
    - [sgc].[header_template]: plantillas de encabezado (rótulos y fila
        inferior del encabezado institucional) por empresa, con versión; una
        por defecto por empresa (índice filtrado). NO SE BORRAN (trigger): se
        desactivan. Cada cambio queda en sgc.config_change_log.
    - [sgc].[document_type].[id_header_template] (NULL = la por defecto) y
      [draft_extensions] (NULL = solo Word; «docx,xlsx» admite Excel).
    - [sgc].[document_version].[source_sha256]: huella del ORIGINAL (Word o
        Excel) de la carga inicial.
    - [sgc].[bulk_upload_item].[source_kind] (pdf | docx | xlsx).
  Los DATOS de OLP (plantilla por defecto y Excel en «Formato») van aparte:
  prisma/manual/2026-10-14-sgc-s16-encabezados-excel-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del S15 y ANTES que el código del S16.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-14-sgc-s16-encabezados-excel-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261014110000_sgc_s16_encabezados_excel (Sprint 16)';

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[sgc].[header_template]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[header_template] (
      [id_header_template] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(30) NOT NULL,
      [name] NVARCHAR(150) NOT NULL,
      [config_json] NVARCHAR(MAX) NOT NULL,
      [is_default] BIT NOT NULL CONSTRAINT [header_template_is_default_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [header_template_is_active_df] DEFAULT 1,
      [version] INT NOT NULL CONSTRAINT [header_template_version_df] DEFAULT 1,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [header_template_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_by] NVARCHAR(255) NOT NULL,
      [updated_at] DATETIME2 NOT NULL CONSTRAINT [header_template_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [header_template_pkey] PRIMARY KEY CLUSTERED ([id_header_template]),
      CONSTRAINT [header_template_id_company_code_key] UNIQUE NONCLUSTERED ([id_company], [code]),
      CONSTRAINT [header_template_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF COL_LENGTH(N'sgc.document_type', N'id_header_template') IS NULL
  ALTER TABLE [sgc].[document_type] ADD [id_header_template] INT NULL;
IF COL_LENGTH(N'sgc.document_type', N'draft_extensions') IS NULL
  ALTER TABLE [sgc].[document_type] ADD [draft_extensions] NVARCHAR(100) NULL;
IF COL_LENGTH(N'sgc.document_version', N'source_sha256') IS NULL
  ALTER TABLE [sgc].[document_version] ADD [source_sha256] CHAR(64) NULL;
IF COL_LENGTH(N'sgc.bulk_upload_item', N'source_kind') IS NULL
  ALTER TABLE [sgc].[bulk_upload_item] ADD [source_kind] NVARCHAR(10) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF OBJECT_ID(N'[sgc].[document_type_id_header_template_fkey]', N'F') IS NULL
  EXEC sp_executesql N'ALTER TABLE [sgc].[document_type] ADD CONSTRAINT [document_type_id_header_template_fkey] FOREIGN KEY ([id_header_template]) REFERENCES [sgc].[header_template]([id_header_template]) ON DELETE NO ACTION ON UPDATE NO ACTION;';

-- Una sola plantilla por defecto por empresa.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'header_template_un_defecto_ux' AND object_id = OBJECT_ID(N'[sgc].[header_template]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [header_template_un_defecto_ux] ON [sgc].[header_template]([id_company]) WHERE [is_default] = 1;';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'header_template_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[header_template] ADD CONSTRAINT [header_template_valores_ck] CHECK ([version] >= 1 AND LEN([name]) >= 3 AND LEFT(LTRIM([config_json]), 1) = N''{'' AND ([is_default] = 0 OR [is_active] = 1));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_type_draft_extensions_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[document_type] ADD CONSTRAINT [document_type_draft_extensions_ck] CHECK ([draft_extensions] IS NULL OR [draft_extensions] IN (N''docx'', N''xlsx'', N''docx,xlsx''));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'bulk_upload_item_source_kind_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[bulk_upload_item] ADD CONSTRAINT [bulk_upload_item_source_kind_ck] CHECK ([source_kind] IS NULL OR [source_kind] IN (N''pdf'', N''docx'', N''xlsx''));';

IF OBJECT_ID(N'[sgc].[header_template_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[header_template_sin_borrado]
ON [sgc].[header_template]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51160, N''sgc.header_template no se borra: una plantilla de encabezado se desactiva con motivo.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
