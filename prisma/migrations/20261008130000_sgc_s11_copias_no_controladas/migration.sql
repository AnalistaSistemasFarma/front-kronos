/*
  Migración: sgc_s11_copias_no_controladas
  SGC documental — Sprint 11 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): COPIAS NO CONTROLADAS y protección del visor.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[uncontrolled_copy_request]: solicitud de copia no controlada
        (documento y versión, justificación, destino, días), decisión del grupo
        SGC-COPIA-NC (quién, cuándo, motivo), vencimiento y si se puede bajar
        (solo para un tercero). NO SE BORRA (trigger).
    - [sgc].[uncontrolled_copy_event]: cada impresión o descarga. SOLO INSERCIÓN.
    - [sgc].[company_config]: uncontrolled_copy_types (FO,FR por defecto),
        uncontrolled_copy_days (30), uncontrolled_copy_max_days (90) y
        viewer_protection (1: marca en mosaico, ocultar sin foco y registro de
        «Imprimir pantalla»).
  El tipo de autorización SGC-COPIA-NC (grupo exclusivo) es un DATO:
  prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 10 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s11-copias-no-controladas-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008130000_sgc_s11_copias_no_controladas (Sprint 11)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'uncontrolled_copy_types') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [uncontrolled_copy_types] NVARCHAR(200) NULL CONSTRAINT [company_config_uncontrolled_copy_types_df] DEFAULT N'FO,FR' WITH VALUES;
IF COL_LENGTH(N'sgc.company_config', N'uncontrolled_copy_days') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [uncontrolled_copy_days] INT NOT NULL CONSTRAINT [company_config_uncontrolled_copy_days_df] DEFAULT 30;
IF COL_LENGTH(N'sgc.company_config', N'uncontrolled_copy_max_days') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [uncontrolled_copy_max_days] INT NOT NULL CONSTRAINT [company_config_uncontrolled_copy_max_days_df] DEFAULT 90;
IF COL_LENGTH(N'sgc.company_config', N'viewer_protection') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [viewer_protection] BIT NOT NULL CONSTRAINT [company_config_viewer_protection_df] DEFAULT 1;

IF OBJECT_ID(N'[sgc].[uncontrolled_copy_request]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[uncontrolled_copy_request] (
      [id_copy_request] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_document] INT NOT NULL,
      [id_document_version] INT NOT NULL,
      [requester_email] NVARCHAR(255) NOT NULL,
      [justification] NVARCHAR(1000) NOT NULL,
      [destination] NVARCHAR(20) NOT NULL,
      [destination_detail] NVARCHAR(300) NULL,
      [days_requested] INT NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [uncontrolled_copy_request_status_df] DEFAULT N'pendiente',
      [decided_by] NVARCHAR(255) NULL,
      [decided_at] DATETIME2 NULL,
      [decision_reason] NVARCHAR(1000) NULL,
      [expires_at] DATETIME2 NULL,
      [allow_download] BIT NOT NULL CONSTRAINT [uncontrolled_copy_request_allow_download_df] DEFAULT 0,
      [created_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      CONSTRAINT [uncontrolled_copy_request_pkey] PRIMARY KEY CLUSTERED ([id_copy_request]),
      CONSTRAINT [uncontrolled_copy_request_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [uncontrolled_copy_request_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [uncontrolled_copy_request_id_company_status_idx] ON [sgc].[uncontrolled_copy_request]([id_company], [status]);
  CREATE NONCLUSTERED INDEX [uncontrolled_copy_request_requester_email_idx] ON [sgc].[uncontrolled_copy_request]([requester_email]);
END;

IF OBJECT_ID(N'[sgc].[uncontrolled_copy_event]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[uncontrolled_copy_event] (
      [id_copy_event] INT NOT NULL IDENTITY(1,1),
      [id_copy_request] INT NOT NULL,
      [event] NVARCHAR(20) NOT NULL,
      [actor_email] NVARCHAR(255) NOT NULL,
      [occurred_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      [user_agent] NVARCHAR(400) NULL,
      CONSTRAINT [uncontrolled_copy_event_pkey] PRIMARY KEY CLUSTERED ([id_copy_event]),
      CONSTRAINT [uncontrolled_copy_event_id_copy_request_fkey] FOREIGN KEY ([id_copy_request]) REFERENCES [sgc].[uncontrolled_copy_request]([id_copy_request]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [uncontrolled_copy_event_id_copy_request_idx] ON [sgc].[uncontrolled_copy_event]([id_copy_request]);
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

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'uncontrolled_copy_request_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[uncontrolled_copy_request] ADD CONSTRAINT [uncontrolled_copy_request_valores_ck] CHECK ([status] IN (N''pendiente'', N''autorizada'', N''rechazada'', N''cancelada'') AND [destination] IN (N''interno'', N''tercero'') AND [days_requested] BETWEEN 1 AND 365 AND ([status] <> N''autorizada'' OR ([expires_at] IS NOT NULL AND [decided_by] IS NOT NULL)) AND ([status] = N''pendiente'' OR [decided_at] IS NOT NULL));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'uncontrolled_copy_event_evento_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[uncontrolled_copy_event] ADD CONSTRAINT [uncontrolled_copy_event_evento_ck] CHECK ([event] IN (N''impresion'', N''descarga''));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_copias_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[company_config] ADD CONSTRAINT [company_config_copias_ck] CHECK ([uncontrolled_copy_max_days] BETWEEN 1 AND 365 AND [uncontrolled_copy_days] BETWEEN 1 AND [uncontrolled_copy_max_days]);';

IF OBJECT_ID(N'[sgc].[uncontrolled_copy_request_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[uncontrolled_copy_request_sin_borrado]
ON [sgc].[uncontrolled_copy_request]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51090, N''sgc.uncontrolled_copy_request no se borra: una solicitud de copia se rechaza o se cancela.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[uncontrolled_copy_event_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[uncontrolled_copy_event_solo_insercion]
ON [sgc].[uncontrolled_copy_event]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51091, N''sgc.uncontrolled_copy_event es de solo inserción: cada impresión o descarga queda registrada.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
