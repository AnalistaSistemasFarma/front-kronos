/*
  Migración: sgc_s5_relaciones_vencimientos_accesos
  SGC documental — Sprint 5 (mapa de relaciones tipo Obsidian, calendario y
  avisos anticipados de vencimiento, enlace iCal privado y solicitudes de
  acceso a documentos de otra área), 2026-10-01.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S4 solo trae cambios en
  `sgc`):
    - [sgc].[document_relation]   relación tipada entre documentos (procedimiento
                                  padre, formato, anexo, referencia); no se
                                  borra: se retira con motivo
    - [sgc].[graph_layout]        posiciones guardadas del mapa, por persona
    - [sgc].[review_alert_config] avisos anticipados por empresa, por tipo
                                  documental o por documento (días, repetición
                                  de vencidos, recordatorio de lectura, correo,
                                  destinatarios adicionales)
    - [sgc].[review_alert]        cada aviso enviado u omitido; clave única =
                                  un aviso sale UNA sola vez; no se borra
    - [sgc].[ical_token]          enlace iCal privado por persona (solo el
                                  SHA-256 del token); se revoca, no se borra
    - [sgc].[access_request]      solicitud de acceso con justificación,
                                  decidida por Calidad; no se borra
    - Restricciones CHECK de catálogos, índices únicos filtrados (una relación
      activa por origen, destino y tipo; un enlace iCal activo por persona; una
      solicitud pendiente por persona y documento) y triggers que impiden BORRAR.

  Los DATOS (configuración por defecto de OLP y el job del programador
  `sgc_review_alerts`) van en
  prisma/manual/2026-10-01-sgc-s5-vencimientos-olp.sql, DESPUÉS del código.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[sgc].[document_relation]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document_relation] (
      [id_document_relation] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_source_document] INT NOT NULL,
      [id_target_document] INT NOT NULL,
      [relation_type] NVARCHAR(30) NOT NULL,
      [note] NVARCHAR(500),
      [is_active] BIT NOT NULL CONSTRAINT [document_relation_is_active_df] DEFAULT 1,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_relation_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [change_reason] NVARCHAR(1000) NOT NULL,
      [removed_by] NVARCHAR(255),
      [removed_at] DATETIME2,
      [remove_reason] NVARCHAR(1000),
      CONSTRAINT [document_relation_pkey] PRIMARY KEY CLUSTERED ([id_document_relation])
  );
END;

IF OBJECT_ID(N'[sgc].[graph_layout]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[graph_layout] (
      [id_graph_layout] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [layout_json] NVARCHAR(max) NOT NULL,
      [updated_at] DATETIME2 NOT NULL CONSTRAINT [graph_layout_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [graph_layout_pkey] PRIMARY KEY CLUSTERED ([id_graph_layout]),
      CONSTRAINT [graph_layout_id_company_user_email_key] UNIQUE NONCLUSTERED ([id_company],[user_email])
  );
END;

IF OBJECT_ID(N'[sgc].[review_alert_config]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[review_alert_config] (
      [id_review_alert_config] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [scope] NVARCHAR(20) NOT NULL,
      [scope_key] NVARCHAR(40) NOT NULL,
      [id_document_type] INT,
      [id_document] INT,
      [offsets_json] NVARCHAR(200) NOT NULL,
      [overdue_every_days] INT NOT NULL CONSTRAINT [review_alert_config_overdue_every_days_df] DEFAULT 7,
      [reading_reminder_days] INT,
      [email_enabled] BIT NOT NULL CONSTRAINT [review_alert_config_email_enabled_df] DEFAULT 1,
      [extra_emails_json] NVARCHAR(2000) NOT NULL CONSTRAINT [review_alert_config_extra_emails_json_df] DEFAULT '[]',
      [is_active] BIT NOT NULL CONSTRAINT [review_alert_config_is_active_df] DEFAULT 1,
      [change_reason] NVARCHAR(1000) NOT NULL,
      [updated_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [review_alert_config_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL CONSTRAINT [review_alert_config_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [review_alert_config_pkey] PRIMARY KEY CLUSTERED ([id_review_alert_config]),
      CONSTRAINT [review_alert_config_id_company_scope_key_key] UNIQUE NONCLUSTERED ([id_company],[scope_key])
  );
END;

IF OBJECT_ID(N'[sgc].[review_alert]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[review_alert] (
      [id_review_alert] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_document] INT NOT NULL,
      [id_document_version] INT NOT NULL,
      [review_due_date] DATE NOT NULL,
      [kind] NVARCHAR(20) NOT NULL,
      [offset_days] INT NOT NULL,
      [alert_key] NVARCHAR(120) NOT NULL,
      [status] NVARCHAR(20) NOT NULL,
      [scheduled_for] DATE NOT NULL,
      [run_date] DATE NOT NULL,
      [run_source] NVARCHAR(20) NOT NULL,
      [recipients_json] NVARCHAR(max) NOT NULL CONSTRAINT [review_alert_recipients_json_df] DEFAULT '[]',
      [channels_json] NVARCHAR(max) NOT NULL CONSTRAINT [review_alert_channels_json_df] DEFAULT '[]',
      [created_at] DATETIME2 NOT NULL CONSTRAINT [review_alert_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [sent_at] DATETIME2,
      CONSTRAINT [review_alert_pkey] PRIMARY KEY CLUSTERED ([id_review_alert]),
      CONSTRAINT [review_alert_alert_key_key] UNIQUE NONCLUSTERED ([alert_key])
  );
END;

IF OBJECT_ID(N'[sgc].[ical_token]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[ical_token] (
      [id_ical_token] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [token_sha256] CHAR(64) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [ical_token_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [revoked_at] DATETIME2,
      [revoked_by] NVARCHAR(255),
      [last_used_at] DATETIME2,
      [use_count] INT NOT NULL CONSTRAINT [ical_token_use_count_df] DEFAULT 0,
      CONSTRAINT [ical_token_pkey] PRIMARY KEY CLUSTERED ([id_ical_token]),
      CONSTRAINT [ical_token_token_sha256_key] UNIQUE NONCLUSTERED ([token_sha256])
  );
END;

IF OBJECT_ID(N'[sgc].[access_request]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[access_request] (
      [id_access_request] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_document] INT,
      [requested_code] NVARCHAR(60) NOT NULL,
      [requester_email] NVARCHAR(255) NOT NULL,
      [justification] NVARCHAR(2000) NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [access_request_status_df] DEFAULT 'pendiente',
      [decided_by] NVARCHAR(255),
      [decided_at] DATETIME2,
      [decision_reason] NVARCHAR(1000),
      [access_expires_at] DATETIME2,
      [id_document_access] INT,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [access_request_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [access_request_pkey] PRIMARY KEY CLUSTERED ([id_access_request])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'document_relation_id_company_is_active_idx' AND object_id = OBJECT_ID(N'[sgc].[document_relation]'))
  CREATE NONCLUSTERED INDEX [document_relation_id_company_is_active_idx] ON [sgc].[document_relation]([id_company], [is_active]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'document_relation_id_target_document_idx' AND object_id = OBJECT_ID(N'[sgc].[document_relation]'))
  CREATE NONCLUSTERED INDEX [document_relation_id_target_document_idx] ON [sgc].[document_relation]([id_target_document]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'document_relation_id_source_document_idx' AND object_id = OBJECT_ID(N'[sgc].[document_relation]'))
  CREATE NONCLUSTERED INDEX [document_relation_id_source_document_idx] ON [sgc].[document_relation]([id_source_document]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'review_alert_id_company_run_date_idx' AND object_id = OBJECT_ID(N'[sgc].[review_alert]'))
  CREATE NONCLUSTERED INDEX [review_alert_id_company_run_date_idx] ON [sgc].[review_alert]([id_company], [run_date]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'review_alert_id_document_idx' AND object_id = OBJECT_ID(N'[sgc].[review_alert]'))
  CREATE NONCLUSTERED INDEX [review_alert_id_document_idx] ON [sgc].[review_alert]([id_document]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ical_token_id_company_user_email_idx' AND object_id = OBJECT_ID(N'[sgc].[ical_token]'))
  CREATE NONCLUSTERED INDEX [ical_token_id_company_user_email_idx] ON [sgc].[ical_token]([id_company], [user_email]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'access_request_id_company_status_idx' AND object_id = OBJECT_ID(N'[sgc].[access_request]'))
  CREATE NONCLUSTERED INDEX [access_request_id_company_status_idx] ON [sgc].[access_request]([id_company], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'access_request_requester_email_idx' AND object_id = OBJECT_ID(N'[sgc].[access_request]'))
  CREATE NONCLUSTERED INDEX [access_request_requester_email_idx] ON [sgc].[access_request]([requester_email]);

IF OBJECT_ID(N'[sgc].[document_relation_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[document_relation_id_source_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_id_source_document_fkey] FOREIGN KEY ([id_source_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[document_relation_id_target_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_id_target_document_fkey] FOREIGN KEY ([id_target_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[graph_layout_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[graph_layout] ADD CONSTRAINT [graph_layout_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_config_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert_config] ADD CONSTRAINT [review_alert_config_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_config_id_document_type_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert_config] ADD CONSTRAINT [review_alert_config_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [sgc].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_config_id_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert_config] ADD CONSTRAINT [review_alert_config_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert] ADD CONSTRAINT [review_alert_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_id_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert] ADD CONSTRAINT [review_alert_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[review_alert_id_document_version_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[review_alert] ADD CONSTRAINT [review_alert_id_document_version_fkey] FOREIGN KEY ([id_document_version]) REFERENCES [sgc].[document_version]([id_document_version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[ical_token_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[ical_token] ADD CONSTRAINT [ical_token_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[access_request_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[access_request] ADD CONSTRAINT [access_request_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[access_request_id_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[access_request] ADD CONSTRAINT [access_request_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[access_request_id_document_access_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[access_request] ADD CONSTRAINT [access_request_id_document_access_fkey] FOREIGN KEY ([id_document_access]) REFERENCES [sgc].[document_access]([id_document_access]) ON DELETE NO ACTION ON UPDATE NO ACTION;

/* Catálogos cerrados (también los valida lib/sgc). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_tipo_ck')
  ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_tipo_ck]
    CHECK ([relation_type] IN (N'procedimiento_padre', N'formato', N'anexo', N'referencia') AND [id_source_document] <> [id_target_document]);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'review_alert_config_scope_ck')
  ALTER TABLE [sgc].[review_alert_config] ADD CONSTRAINT [review_alert_config_scope_ck]
    CHECK (([scope] = N'empresa' AND [id_document_type] IS NULL AND [id_document] IS NULL)
      OR ([scope] = N'tipo' AND [id_document_type] IS NOT NULL AND [id_document] IS NULL)
      OR ([scope] = N'documento' AND [id_document] IS NOT NULL AND [id_document_type] IS NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'review_alert_config_dias_ck')
  ALTER TABLE [sgc].[review_alert_config] ADD CONSTRAINT [review_alert_config_dias_ck]
    CHECK ([overdue_every_days] BETWEEN 1 AND 90 AND ([reading_reminder_days] IS NULL OR [reading_reminder_days] BETWEEN 0 AND 60) AND LEN([change_reason]) >= 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'review_alert_kind_ck')
  ALTER TABLE [sgc].[review_alert] ADD CONSTRAINT [review_alert_kind_ck]
    CHECK ([kind] IN (N'anticipado', N'vencimiento', N'vencido') AND [status] IN (N'enviado', N'omitido') AND [run_source] IN (N'programador', N'manual'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'access_request_status_ck')
  ALTER TABLE [sgc].[access_request] ADD CONSTRAINT [access_request_status_ck]
    CHECK ([status] IN (N'pendiente', N'aprobada', N'rechazada', N'cancelada')
      AND ([status] = N'pendiente' OR ([decided_by] IS NOT NULL AND [decided_at] IS NOT NULL))
      AND ([status] <> N'aprobada' OR [id_document_access] IS NOT NULL)
      AND LEN([justification]) >= 10);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/* Índices únicos filtrados. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'document_relation_activa_uq' AND object_id = OBJECT_ID(N'[sgc].[document_relation]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [document_relation_activa_uq] ON [sgc].[document_relation]([id_source_document], [id_target_document], [relation_type]) WHERE [is_active] = 1;';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ical_token_activo_uq' AND object_id = OBJECT_ID(N'[sgc].[ical_token]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [ical_token_activo_uq] ON [sgc].[ical_token]([id_company], [user_email]) WHERE [revoked_at] IS NULL;';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'access_request_pendiente_uq' AND object_id = OBJECT_ID(N'[sgc].[access_request]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [access_request_pendiente_uq] ON [sgc].[access_request]([id_company], [requester_email], [requested_code]) WHERE [status] = N''pendiente'';';

/*
  Nada de esto se BORRA (un sistema auditado no borra: retira, revoca, decide
  o cancela con motivo). Un aviso de vencimiento registrado no cambia de
  documento, versión, fecha ni clave.
*/

IF OBJECT_ID(N'[sgc].[document_relation_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[document_relation_sin_borrado]
ON [sgc].[document_relation]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51030, N''sgc.document_relation no se borra: una relación se retira con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[review_alert_config_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[review_alert_config_sin_borrado]
ON [sgc].[review_alert_config]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51031, N''sgc.review_alert_config no se borra: se desactiva con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[ical_token_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[ical_token_sin_borrado]
ON [sgc].[ical_token]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51033, N''sgc.ical_token no se borra: un enlace iCal se revoca.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[access_request_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[access_request_sin_borrado]
ON [sgc].[access_request]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51034, N''sgc.access_request no se borra: una solicitud se decide o se cancela.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[review_alert_inmodificable]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[review_alert_inmodificable]
ON [sgc].[review_alert]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51032, N''sgc.review_alert no se borra: es el registro de los avisos de vencimiento.'', 1;
  IF EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.id_review_alert = d.id_review_alert
             WHERE i.alert_key <> d.alert_key OR i.id_document <> d.id_document OR i.id_document_version <> d.id_document_version
                OR i.review_due_date <> d.review_due_date OR i.kind <> d.kind OR i.offset_days <> d.offset_days OR i.status <> d.status
                OR i.run_date <> d.run_date OR i.id_company <> d.id_company OR d.sent_at IS NOT NULL)
    THROW 51032, N''sgc.review_alert: un aviso registrado no cambia (solo se completan sus canales al enviarse, una vez).'', 1;
  UPDATE a SET a.recipients_json = i.recipients_json, a.channels_json = i.channels_json, a.sent_at = i.sent_at
  FROM [sgc].[review_alert] a JOIN inserted i ON i.id_review_alert = a.id_review_alert;
END;';
