/*
  Migración: sgc_generador_plantillas
  SGC documental — GENERADOR DE DOCUMENTOS desde plantillas aprobadas por
  Calidad (decisión de Nicolás Rivera del 2026-10-10: «el generador de
  documentos sí va»; idea explicada a Calidad OLP el 2026-10-07). Rescate de la
  demo de PiSA: rama rescate/pisa-demo-generador-2026-10-10.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[company_config].[generator_enabled] BIT (0 por defecto: APAGADO).
    - [sgc].[generator_template]: plantilla que parte de un documento VIGENTE
        (una por documento y empresa), su versión aprobada y el consecutivo de
        los registros. NO SE BORRA (se retira con motivo).
    - [sgc].[generator_template_version]: cada configuración (contenido
        congelado con sus marcas {{CAMPO:...}}, huella y campos editables),
        quién la propuso y quién de Calidad la decidió. NO SE BORRA y su
        contenido es INMUTABLE (triggers).
    - [sgc].[generated_document]: el REGISTRO generado (código consecutivo,
        valores, PDF en OneDrive con su SHA-256, quién y cuándo). NO SE BORRA
        y su contenido es INMUTABLE: solo se anula con motivo (triggers).

  ⚠️ ORDEN DEL PASE: después de la del Sprint 13 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).
  Guarda de base: corre en KRONOSDB_PRUEBAS y en la base efímera de la CI
  (kronos_ci); en cualquier otra base exige declarar antes en la sesión
  EXEC sp_set_session_context N'sgc_generador_bd_autorizada', 1;

  REVERSA: prisma/manual/2026-10-10-sgc-generador-plantillas-reversa.sql
*/

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') AND ISNULL(TRY_CAST(SESSION_CONTEXT(N'sgc_generador_bd_autorizada') AS INT), 0) <> 1
  THROW 51100, N'Generador SGC: esta migración solo corre en KRONOSDB_PRUEBAS (o la CI). En otra base declare sgc_generador_bd_autorizada = 1 con la autorización del pase.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261010100000_sgc_generador_plantillas (Generador de documentos)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'generator_enabled') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [generator_enabled] BIT NOT NULL CONSTRAINT [company_config_generator_enabled_df] DEFAULT 0;

IF OBJECT_ID(N'[sgc].[generator_template]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[generator_template] (
      [id_template] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_document] INT NOT NULL,
      [name] NVARCHAR(300) NOT NULL,
      [description] NVARCHAR(1000) NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [generator_template_status_df] DEFAULT N'activa',
      [current_version_id] INT NULL,
      [last_sequence] INT NOT NULL CONSTRAINT [generator_template_last_sequence_df] DEFAULT 0,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL,
      [retired_by] NVARCHAR(255) NULL,
      [retired_at] DATETIME2 NULL,
      [retire_reason] NVARCHAR(1000) NULL,
      CONSTRAINT [generator_template_pkey] PRIMARY KEY CLUSTERED ([id_template]),
      CONSTRAINT [generator_template_id_company_id_document_key] UNIQUE NONCLUSTERED ([id_company], [id_document]),
      CONSTRAINT [generator_template_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [generator_template_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'[sgc].[generator_template_version]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[generator_template_version] (
      [id_template_version] INT NOT NULL IDENTITY(1,1),
      [id_template] INT NOT NULL,
      [version_number] INT NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [generator_template_version_status_df] DEFAULT N'pendiente',
      [id_document_version] INT NOT NULL,
      [body_html] NVARCHAR(MAX) NOT NULL,
      [body_sha256] CHAR(64) NOT NULL,
      [fields_json] NVARCHAR(MAX) NOT NULL,
      [change_reason] NVARCHAR(1000) NOT NULL,
      [proposed_by] NVARCHAR(255) NOT NULL,
      [proposed_at] DATETIME2 NOT NULL,
      [decided_by] NVARCHAR(255) NULL,
      [decided_at] DATETIME2 NULL,
      [decision_reason] NVARCHAR(1000) NULL,
      CONSTRAINT [generator_template_version_pkey] PRIMARY KEY CLUSTERED ([id_template_version]),
      CONSTRAINT [generator_template_version_id_template_version_number_key] UNIQUE NONCLUSTERED ([id_template], [version_number]),
      CONSTRAINT [generator_template_version_id_template_fkey] FOREIGN KEY ([id_template]) REFERENCES [sgc].[generator_template]([id_template]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [generator_template_version_id_template_status_idx] ON [sgc].[generator_template_version]([id_template], [status]);
END;

IF OBJECT_ID(N'[sgc].[generated_document]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[generated_document] (
      [id_generated] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_template] INT NOT NULL,
      [id_template_version] INT NOT NULL,
      [id_document] INT NOT NULL,
      [id_document_version] INT NOT NULL,
      [sequence_number] INT NOT NULL,
      [code] NVARCHAR(80) NOT NULL,
      [values_json] NVARCHAR(MAX) NOT NULL,
      [pdf_item_id] NVARCHAR(200) NOT NULL,
      [pdf_path] NVARCHAR(600) NOT NULL,
      [pdf_sha256] CHAR(64) NOT NULL,
      [pdf_size] INT NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [generated_document_status_df] DEFAULT N'emitido',
      [generated_by] NVARCHAR(255) NOT NULL,
      [generated_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      [annulled_by] NVARCHAR(255) NULL,
      [annulled_at] DATETIME2 NULL,
      [annul_reason] NVARCHAR(1000) NULL,
      CONSTRAINT [generated_document_pkey] PRIMARY KEY CLUSTERED ([id_generated]),
      CONSTRAINT [generated_document_id_company_code_key] UNIQUE NONCLUSTERED ([id_company], [code]),
      CONSTRAINT [generated_document_id_template_sequence_number_key] UNIQUE NONCLUSTERED ([id_template], [sequence_number]),
      CONSTRAINT [generated_document_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [generated_document_id_template_fkey] FOREIGN KEY ([id_template]) REFERENCES [sgc].[generator_template]([id_template]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [generated_document_id_template_version_fkey] FOREIGN KEY ([id_template_version]) REFERENCES [sgc].[generator_template_version]([id_template_version]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [generated_document_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [generated_document_id_company_generated_by_idx] ON [sgc].[generated_document]([id_company], [generated_by]);
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

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'generator_template_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[generator_template] ADD CONSTRAINT [generator_template_valores_ck] CHECK ([status] IN (N''activa'', N''retirada'') AND [last_sequence] >= 0 AND ([status] = N''activa'' OR ([retired_by] IS NOT NULL AND [retired_at] IS NOT NULL)));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'generator_template_version_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[generator_template_version] ADD CONSTRAINT [generator_template_version_valores_ck] CHECK ([status] IN (N''pendiente'', N''aprobada'', N''rechazada'', N''reemplazada'') AND [version_number] >= 1 AND ([status] = N''pendiente'' OR ([decided_by] IS NOT NULL AND [decided_at] IS NOT NULL)) AND ([decided_by] IS NULL OR [decided_by] <> [proposed_by]));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'generated_document_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[generated_document] ADD CONSTRAINT [generated_document_valores_ck] CHECK ([status] IN (N''emitido'', N''anulado'') AND [sequence_number] >= 1 AND ([status] = N''emitido'' OR ([annulled_by] IS NOT NULL AND [annulled_at] IS NOT NULL AND [annul_reason] IS NOT NULL)));';

IF OBJECT_ID(N'[sgc].[generator_template_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[generator_template_sin_borrado]
ON [sgc].[generator_template]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51101, N''sgc.generator_template no se borra: una plantilla se retira con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[generator_template_version_inmutable]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[generator_template_version_inmutable]
ON [sgc].[generator_template_version]
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51102, N''sgc.generator_template_version no se borra: una configuración se rechaza o se reemplaza.'', 1;
  IF UPDATE([id_template]) OR UPDATE([version_number]) OR UPDATE([id_document_version]) OR UPDATE([body_html]) OR UPDATE([body_sha256]) OR UPDATE([fields_json]) OR UPDATE([change_reason]) OR UPDATE([proposed_by]) OR UPDATE([proposed_at])
    THROW 51103, N''El contenido y los campos de una versión de plantilla son inmutables: proponga una versión nueva.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[generated_document_inmutable]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[generated_document_inmutable]
ON [sgc].[generated_document]
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51104, N''sgc.generated_document no se borra: un registro generado se anula con motivo.'', 1;
  IF UPDATE([id_company]) OR UPDATE([id_template]) OR UPDATE([id_template_version]) OR UPDATE([id_document]) OR UPDATE([id_document_version]) OR UPDATE([sequence_number]) OR UPDATE([code]) OR UPDATE([values_json]) OR UPDATE([pdf_item_id]) OR UPDATE([pdf_path]) OR UPDATE([pdf_sha256]) OR UPDATE([pdf_size]) OR UPDATE([generated_by]) OR UPDATE([generated_at])
    THROW 51105, N''Un registro generado es inmutable: solo se anula con motivo.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
