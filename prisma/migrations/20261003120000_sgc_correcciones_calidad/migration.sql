/*
  Migración: sgc_correcciones_calidad
  SGC documental — correcciones pedidas por Calidad de One Latam Pharma en la
  reunión del 2026-10-02 (Juan Sebastián Mora), implementadas el 2026-10-03.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[company_config]: logo_data_url (logo de la empresa para el
      encabezado institucional del PDF controlado, sin red),
      dissemination_domains (dominios de correo de las personas de la empresa:
      la divulgación automática solo los incluye) y read_threshold_pct (umbral
      de avance de lectura que se avisa al creador y a Calidad; 90 por defecto).
    - [sgc].[document_version].layout_json: composición del PDF controlado
      (encabezado institucional, campo «Fecha de emisión» y firmas ubicadas).
    - [sgc].[draft_revision].minor_reason / base_sha256: REVISIÓN MENOR de
      Calidad durante la aprobación, con motivo y la huella que corrige.
    - [sgc].[document_layout]: ubicación de las firmas en el documento (copia
      congelada del mecanismo de SynerLink) y encabezado institucional; SOLO
      INSERCIÓN (cada guardado es una fila nueva).
    - [sgc].[read_threshold_notice]: aviso de avance de lectura por umbral,
      una sola vez por tarea y umbral; SOLO INSERCIÓN.
    - CHECK del umbral (1–100) y de la revisión menor (motivo y huella juntos).

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee las columnas nuevas).
  Idempotente: cada bloque verifica si el objeto existe. Es un cambio
  controlado del esquema `sgc` (lo declara en la sesión, ver Sprint 6).

  REVERSA: prisma/manual/2026-10-03-sgc-correcciones-calidad-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261003120000_sgc_correcciones_calidad (correcciones de Calidad OLP, reunión 2026-10-02)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'logo_data_url') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [logo_data_url] NVARCHAR(max) NULL;
IF COL_LENGTH(N'sgc.company_config', N'dissemination_domains') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [dissemination_domains] NVARCHAR(500) NULL;
IF COL_LENGTH(N'sgc.company_config', N'read_threshold_pct') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [read_threshold_pct] INT NOT NULL CONSTRAINT [company_config_read_threshold_pct_df] DEFAULT 90;

IF COL_LENGTH(N'sgc.document_version', N'layout_json') IS NULL
  ALTER TABLE [sgc].[document_version] ADD [layout_json] NVARCHAR(max) NULL;

IF COL_LENGTH(N'sgc.draft_revision', N'minor_reason') IS NULL
  ALTER TABLE [sgc].[draft_revision] ADD [minor_reason] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'sgc.draft_revision', N'base_sha256') IS NULL
  ALTER TABLE [sgc].[draft_revision] ADD [base_sha256] CHAR(64) NULL;

IF OBJECT_ID(N'[sgc].[document_layout]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document_layout] (
      [id_document_layout] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [institutional_header] BIT NOT NULL CONSTRAINT [document_layout_institutional_header_df] DEFAULT 0,
      [fields_json] NVARCHAR(max) NOT NULL,
      [content_sha256] CHAR(64),
      [saved_by] NVARCHAR(255) NOT NULL,
      [saved_at] DATETIME2 NOT NULL,
      [change_reason] NVARCHAR(1000),
      CONSTRAINT [document_layout_pkey] PRIMARY KEY CLUSTERED ([id_document_layout]),
      CONSTRAINT [document_layout_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [document_layout_id_request_idx] ON [sgc].[document_layout]([id_request]);
END;

IF OBJECT_ID(N'[sgc].[read_threshold_notice]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[read_threshold_notice] (
      [id_read_threshold_notice] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [threshold_pct] INT NOT NULL,
      [percent_at] DECIMAL(5,1) NOT NULL,
      [read_count] INT NOT NULL,
      [counted] INT NOT NULL,
      [recipients_json] NVARCHAR(2000) NOT NULL,
      [notified_at] DATETIME2 NOT NULL,
      CONSTRAINT [read_threshold_notice_pkey] PRIMARY KEY CLUSTERED ([id_read_threshold_notice]),
      CONSTRAINT [read_threshold_notice_id_task_threshold_pct_key] UNIQUE NONCLUSTERED ([id_task],[threshold_pct]),
      CONSTRAINT [read_threshold_notice_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [read_threshold_notice_id_request_idx] ON [sgc].[read_threshold_notice]([id_request]);
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

/* Restricciones sobre columnas nuevas (en lote aparte: se compilan después de crearlas). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_read_threshold_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[company_config] ADD CONSTRAINT [company_config_read_threshold_ck] CHECK ([read_threshold_pct] BETWEEN 1 AND 100);';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'draft_revision_menor_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[draft_revision] ADD CONSTRAINT [draft_revision_menor_ck] CHECK (([minor_reason] IS NULL AND [base_sha256] IS NULL) OR (LEN([minor_reason]) >= 10 AND [base_sha256] IS NOT NULL));';

/* Solo inserción: la composición del documento y los avisos de umbral no se modifican ni se borran. */
IF OBJECT_ID(N'[sgc].[document_layout_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_layout_solo_insercion]
ON [sgc].[document_layout]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51050, N''sgc.document_layout es de solo inserción: cada cambio de ubicación de firmas es una fila nueva.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[read_threshold_notice_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[read_threshold_notice_solo_insercion]
ON [sgc].[read_threshold_notice]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51051, N''sgc.read_threshold_notice es de solo inserción: no se modifica ni se borra.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
