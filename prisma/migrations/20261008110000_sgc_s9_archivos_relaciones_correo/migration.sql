/*
  Migración: sgc_s9_archivos_relaciones_correo
  SGC documental — Sprint 9 del plan del 2026-10-08: carga masiva de los PDF
  del listado maestro, relaciones propuestas por código («Relacionar
  documentos»), cierre de la carga inicial y política de correo por empresa.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[document_relation]: origin (manual | codigo | listado), status
        (propuesta | confirmada; las existentes quedan «confirmada»),
        confirmed_by y confirmed_at. El mapa solo muestra las confirmadas.
    - [sgc].[company_config]: email_mode (nunca | vencimientos |
        resumen_diario; «nunca» por defecto: solo campana y tablero) y
        email_digest_last_date (el resumen diario sale una vez al día).
    - [sgc].[bulk_upload] y [sgc].[bulk_upload_item]: cada carga masiva de PDF
        y cada archivo con su resultado (cargado o error) y el aviso si el
        nombre no coincide con el del listado. SOLO INSERCIÓN (triggers).

  ⚠️ ORDEN DEL PASE: va DESPUÉS de la del Sprint 8 y ANTES que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).
  ⚠️ Con email_mode = «nunca» por defecto, los avisos de vencimiento dejan de
  salir por correo aunque su configuración lo tenga encendido: Calidad lo
  vuelve a encender en «Configuración → Encabezado y divulgación».

  REVERSA: prisma/manual/2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008110000_sgc_s9_archivos_relaciones_correo (Sprint 9)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.document_relation', N'origin') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD [origin] NVARCHAR(20) NOT NULL CONSTRAINT [document_relation_origin_df] DEFAULT N'manual';
IF COL_LENGTH(N'sgc.document_relation', N'status') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD [status] NVARCHAR(20) NOT NULL CONSTRAINT [document_relation_status_df] DEFAULT N'confirmada';
IF COL_LENGTH(N'sgc.document_relation', N'confirmed_by') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD [confirmed_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.document_relation', N'confirmed_at') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD [confirmed_at] DATETIME2 NULL;

IF COL_LENGTH(N'sgc.company_config', N'email_mode') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [email_mode] NVARCHAR(20) NOT NULL CONSTRAINT [company_config_email_mode_df] DEFAULT N'nunca';
IF COL_LENGTH(N'sgc.company_config', N'email_digest_last_date') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [email_digest_last_date] DATE NULL;

IF OBJECT_ID(N'[sgc].[bulk_upload]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[bulk_upload] (
      [id_bulk_upload] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [files_total] INT NOT NULL,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      CONSTRAINT [bulk_upload_pkey] PRIMARY KEY CLUSTERED ([id_bulk_upload]),
      CONSTRAINT [bulk_upload_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [bulk_upload_id_company_created_at_idx] ON [sgc].[bulk_upload]([id_company], [created_at]);
END;

IF OBJECT_ID(N'[sgc].[bulk_upload_item]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[bulk_upload_item] (
      [id_bulk_upload_item] INT NOT NULL IDENTITY(1,1),
      [id_bulk_upload] INT NOT NULL,
      [file_name] NVARCHAR(260) NOT NULL,
      [size_bytes] INT NOT NULL,
      [sha256] CHAR(64) NULL,
      [code] NVARCHAR(60) NULL,
      [id_document] INT NULL,
      [id_document_version] INT NULL,
      [status] NVARCHAR(20) NOT NULL,
      [warning] NVARCHAR(1000) NULL,
      [error] NVARCHAR(1000) NULL,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL,
      CONSTRAINT [bulk_upload_item_pkey] PRIMARY KEY CLUSTERED ([id_bulk_upload_item]),
      CONSTRAINT [bulk_upload_item_id_bulk_upload_fkey] FOREIGN KEY ([id_bulk_upload]) REFERENCES [sgc].[bulk_upload]([id_bulk_upload]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [bulk_upload_item_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [bulk_upload_item_id_bulk_upload_idx] ON [sgc].[bulk_upload_item]([id_bulk_upload]);
  CREATE NONCLUSTERED INDEX [bulk_upload_item_id_document_idx] ON [sgc].[bulk_upload_item]([id_document]);
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

/* Restricciones sobre columnas nuevas (en lote aparte). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_origen_estado_ck] CHECK ([origin] IN (N''manual'', N''codigo'', N''listado'') AND [status] IN (N''propuesta'', N''confirmada''));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_email_mode_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[company_config] ADD CONSTRAINT [company_config_email_mode_ck] CHECK ([email_mode] IN (N''nunca'', N''vencimientos'', N''resumen_diario''));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'bulk_upload_item_status_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[bulk_upload_item] ADD CONSTRAINT [bulk_upload_item_status_ck] CHECK ([status] IN (N''cargado'', N''error''));';

IF OBJECT_ID(N'[sgc].[bulk_upload_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[bulk_upload_solo_insercion]
ON [sgc].[bulk_upload]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51070, N''sgc.bulk_upload es de solo inserción: el historial de la carga masiva no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[bulk_upload_item_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[bulk_upload_item_solo_insercion]
ON [sgc].[bulk_upload_item]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51071, N''sgc.bulk_upload_item es de solo inserción: el resultado de cada archivo no se modifica ni se borra.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
