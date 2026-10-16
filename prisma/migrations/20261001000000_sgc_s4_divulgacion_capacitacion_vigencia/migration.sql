/*
  Migración: sgc_s4_divulgacion_capacitacion_vigencia
  SGC documental — Sprint 4 (divulgación con lectura obligatoria firmada,
  capacitación con resultados de Microsoft Forms y paso automático a
  vigente con obsolescencia de la versión anterior), 2026-10-01.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S3 solo trae cambios en
  `sgc`):
    - [sgc].[dissemination_scope] alcance de divulgación por solicitud
                                  (empresa, departamento, cargo, persona);
                                  no se borra: se retira con motivo
    - [sgc].[read_record]         lectura obligatoria por persona: abrió,
                                  llegó al final, firmó «Leyó»; no se borra
    - [sgc].[training]            capacitación de la solicitud (sesión/video,
                                  evaluación de Forms, nota mínima)
    - [sgc].[training_upload]     cada carga del Excel de resultados (SOLO INSERCIÓN)
    - [sgc].[training_result]     resultado por persona (SOLO INSERCIÓN)
    - [sgc].[cargo_member]        personas por cargo para el alcance «por
                                  cargo» (SynerLink no vincula persona↔cargo)
    - Columna nueva (NULL): document_version.id_superseded_by (versión que la
      reemplazó al pasar a vigente)
    - Restricciones CHECK de estados y clases; índice único filtrado de
      cargo_member (una fila activa por empresa, cargo y persona); triggers
      que impiden BORRAR (y, en training_upload/training_result, modificar).

  Los DATOS (flujo documental con los pasos 4 y 5 habilitados) van en
  prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-10-01-sgc-s4-divulgacion-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[sgc].[document_version]', N'id_superseded_by') IS NULL
  ALTER TABLE [sgc].[document_version] ADD [id_superseded_by] INT;

IF OBJECT_ID(N'[sgc].[dissemination_scope]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[dissemination_scope] (
      [id_scope] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [kind] NVARCHAR(20) NOT NULL,
      [id_department] INT,
      [id_cargo] INT,
      [user_email] NVARCHAR(255),
      [scope_key] NVARCHAR(300) NOT NULL,
      [is_active] BIT NOT NULL CONSTRAINT [dissemination_scope_is_active_df] DEFAULT 1,
      [added_by] NVARCHAR(255) NOT NULL,
      [added_at] DATETIME2 NOT NULL CONSTRAINT [dissemination_scope_added_at_df] DEFAULT CURRENT_TIMESTAMP,
      [change_reason] NVARCHAR(1000),
      [removed_by] NVARCHAR(255),
      [removed_at] DATETIME2,
      [remove_reason] NVARCHAR(1000),
      CONSTRAINT [dissemination_scope_pkey] PRIMARY KEY CLUSTERED ([id_scope])
  );
END;

IF OBJECT_ID(N'[sgc].[read_record]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[read_record] (
      [id_read_record] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [sources_json] NVARCHAR(1000) NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [read_record_status_df] DEFAULT 'pendiente',
      [id_document_version] INT,
      [assigned_at] DATETIME2 NOT NULL,
      [first_opened_at] DATETIME2,
      [last_opened_at] DATETIME2,
      [open_count] INT NOT NULL CONSTRAINT [read_record_open_count_df] DEFAULT 0,
      [reached_end_at] DATETIME2,
      [pages] INT,
      [signed_at] DATETIME2,
      [id_signature] INT,
      [excluded_by] NVARCHAR(255),
      [excluded_at] DATETIME2,
      [exclude_reason] NVARCHAR(1000),
      [reminders_sent] INT NOT NULL CONSTRAINT [read_record_reminders_sent_df] DEFAULT 0,
      [last_reminder_at] DATETIME2,
      CONSTRAINT [read_record_pkey] PRIMARY KEY CLUSTERED ([id_read_record]),
      CONSTRAINT [read_record_id_task_assignee_key] UNIQUE NONCLUSTERED ([id_task_assignee]),
      CONSTRAINT [read_record_id_task_user_email_key] UNIQUE NONCLUSTERED ([id_task],[user_email])
  );
END;

IF OBJECT_ID(N'[sgc].[training]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training] (
      [id_training] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [mode] NVARCHAR(20) NOT NULL,
      [title] NVARCHAR(300) NOT NULL,
      [video_url] NVARCHAR(1000),
      [forms_url] NVARCHAR(1000),
      [session_date] DATE,
      [instructor] NVARCHAR(200),
      [max_score] DECIMAL(9,2) NOT NULL,
      [min_score_pct] DECIMAL(5,2) NOT NULL,
      [notes] NVARCHAR(2000),
      [registered_by] NVARCHAR(255) NOT NULL,
      [registered_at] DATETIME2 NOT NULL,
      [updated_by] NVARCHAR(255) NOT NULL,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [training_pkey] PRIMARY KEY CLUSTERED ([id_training]),
      CONSTRAINT [training_id_task_key] UNIQUE NONCLUSTERED ([id_task])
  );
END;

IF OBJECT_ID(N'[sgc].[training_upload]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_upload] (
      [id_training_upload] INT NOT NULL IDENTITY(1,1),
      [id_training] INT NOT NULL,
      [file_name] NVARCHAR(260) NOT NULL,
      [item_id] NVARCHAR(200) NOT NULL,
      [storage_path] NVARCHAR(600) NOT NULL,
      [sha256] CHAR(64) NOT NULL,
      [size_bytes] INT NOT NULL,
      [max_score] DECIMAL(9,2) NOT NULL,
      [min_score_pct] DECIMAL(5,2) NOT NULL,
      [rows_total] INT NOT NULL,
      [people] INT NOT NULL,
      [in_scope] INT NOT NULL,
      [passed] INT NOT NULL,
      [failed] INT NOT NULL,
      [out_of_scope] INT NOT NULL,
      [missing_json] NVARCHAR(max) NOT NULL,
      [rejected_json] NVARCHAR(max) NOT NULL,
      [uploaded_by] NVARCHAR(255) NOT NULL,
      [uploaded_at] DATETIME2 NOT NULL,
      CONSTRAINT [training_upload_pkey] PRIMARY KEY CLUSTERED ([id_training_upload])
  );
END;

IF OBJECT_ID(N'[sgc].[training_result]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_result] (
      [id_training_result] INT NOT NULL IDENTITY(1,1),
      [id_training_upload] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [full_name] NVARCHAR(255),
      [score] DECIMAL(9,2) NOT NULL,
      [percent] DECIMAL(5,1) NOT NULL,
      [passed] BIT NOT NULL,
      [attempts] INT NOT NULL,
      [in_scope] BIT NOT NULL,
      [completed_at_text] NVARCHAR(40),
      CONSTRAINT [training_result_pkey] PRIMARY KEY CLUSTERED ([id_training_result])
  );
END;

IF OBJECT_ID(N'[sgc].[cargo_member]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[cargo_member] (
      [id_cargo_member] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_cargo] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [is_active] BIT NOT NULL CONSTRAINT [cargo_member_is_active_df] DEFAULT 1,
      [added_by] NVARCHAR(255) NOT NULL,
      [added_at] DATETIME2 NOT NULL CONSTRAINT [cargo_member_added_at_df] DEFAULT CURRENT_TIMESTAMP,
      [reason] NVARCHAR(1000) NOT NULL,
      [removed_by] NVARCHAR(255),
      [removed_at] DATETIME2,
      [remove_reason] NVARCHAR(1000),
      CONSTRAINT [cargo_member_pkey] PRIMARY KEY CLUSTERED ([id_cargo_member])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'dissemination_scope_id_request_idx' AND object_id = OBJECT_ID(N'[sgc].[dissemination_scope]'))
  CREATE NONCLUSTERED INDEX [dissemination_scope_id_request_idx] ON [sgc].[dissemination_scope]([id_request]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'read_record_id_request_idx' AND object_id = OBJECT_ID(N'[sgc].[read_record]'))
  CREATE NONCLUSTERED INDEX [read_record_id_request_idx] ON [sgc].[read_record]([id_request]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'read_record_user_email_status_idx' AND object_id = OBJECT_ID(N'[sgc].[read_record]'))
  CREATE NONCLUSTERED INDEX [read_record_user_email_status_idx] ON [sgc].[read_record]([user_email], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'training_id_request_idx' AND object_id = OBJECT_ID(N'[sgc].[training]'))
  CREATE NONCLUSTERED INDEX [training_id_request_idx] ON [sgc].[training]([id_request]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'training_upload_id_training_idx' AND object_id = OBJECT_ID(N'[sgc].[training_upload]'))
  CREATE NONCLUSTERED INDEX [training_upload_id_training_idx] ON [sgc].[training_upload]([id_training]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'training_result_id_training_upload_idx' AND object_id = OBJECT_ID(N'[sgc].[training_result]'))
  CREATE NONCLUSTERED INDEX [training_result_id_training_upload_idx] ON [sgc].[training_result]([id_training_upload]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'cargo_member_id_company_id_cargo_idx' AND object_id = OBJECT_ID(N'[sgc].[cargo_member]'))
  CREATE NONCLUSTERED INDEX [cargo_member_id_company_id_cargo_idx] ON [sgc].[cargo_member]([id_company], [id_cargo]);

IF OBJECT_ID(N'[sgc].[dissemination_scope_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[dissemination_scope] ADD CONSTRAINT [dissemination_scope_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[read_record_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[read_record] ADD CONSTRAINT [read_record_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[read_record_id_task_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[read_record] ADD CONSTRAINT [read_record_id_task_fkey] FOREIGN KEY ([id_task]) REFERENCES [sgc].[task]([id_task]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[read_record_id_task_assignee_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[read_record] ADD CONSTRAINT [read_record_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[training_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[training_id_task_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_id_task_fkey] FOREIGN KEY ([id_task]) REFERENCES [sgc].[task]([id_task]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[training_upload_id_training_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[training_upload] ADD CONSTRAINT [training_upload_id_training_fkey] FOREIGN KEY ([id_training]) REFERENCES [sgc].[training]([id_training]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[training_result_id_training_upload_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[training_result] ADD CONSTRAINT [training_result_id_training_upload_fkey] FOREIGN KEY ([id_training_upload]) REFERENCES [sgc].[training_upload]([id_training_upload]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[cargo_member_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[cargo_member] ADD CONSTRAINT [cargo_member_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

/* Catálogos cerrados (también los valida lib/sgc). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'dissemination_scope_kind_ck')
  ALTER TABLE [sgc].[dissemination_scope] ADD CONSTRAINT [dissemination_scope_kind_ck]
    CHECK (([kind] = N'empresa') OR ([kind] = N'departamento' AND [id_department] IS NOT NULL)
      OR ([kind] = N'cargo' AND [id_cargo] IS NOT NULL) OR ([kind] = N'persona' AND [user_email] IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'read_record_status_ck')
  ALTER TABLE [sgc].[read_record] ADD CONSTRAINT [read_record_status_ck]
    CHECK ([status] IN (N'pendiente', N'leido', N'excluido')
      AND ([status] <> N'leido' OR ([signed_at] IS NOT NULL AND [id_signature] IS NOT NULL AND [reached_end_at] IS NOT NULL))
      AND ([status] <> N'excluido' OR LEN([exclude_reason]) >= 10));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_mode_ck')
  ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_mode_ck]
    CHECK ([mode] IN (N'video', N'sesion', N'mixta') AND [max_score] > 0 AND [min_score_pct] > 0 AND [min_score_pct] <= 100);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/* Una sola fila ACTIVA por empresa, cargo y persona (índice único filtrado). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'cargo_member_activo_uq' AND object_id = OBJECT_ID(N'[sgc].[cargo_member]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [cargo_member_activo_uq] ON [sgc].[cargo_member]([id_company], [id_cargo], [user_email]) WHERE [is_active] = 1;';

/*
  Nada de esto se BORRA (un sistema auditado no borra: retira, excluye o
  desactiva con motivo). Las cargas y los resultados de la capacitación
  tampoco se MODIFICAN: una carga nueva reemplaza a la anterior como vigente.
*/
IF OBJECT_ID(N'[sgc].[dissemination_scope_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[dissemination_scope_sin_borrado]
ON [sgc].[dissemination_scope]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51020, N''sgc.dissemination_scope no se borra: una entrada del alcance se retira con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[read_record_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[read_record_sin_borrado]
ON [sgc].[read_record]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51021, N''sgc.read_record no se borra: una lectura se excluye con justificación.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[read_record_firma_inmodificable]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[read_record_firma_inmodificable]
ON [sgc].[read_record]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.id_read_record = d.id_read_record
             WHERE d.status <> N''pendiente'' AND (i.status <> d.status OR ISNULL(i.id_signature, -1) <> ISNULL(d.id_signature, -1) OR ISNULL(i.signed_at, ''19000101'') <> ISNULL(d.signed_at, ''19000101'')))
     OR UPDATE(user_email) OR UPDATE(id_task_assignee) OR UPDATE(id_task) OR UPDATE(id_request)
    THROW 51022, N''sgc.read_record: una lectura firmada o excluida no cambia, ni cambia de persona o tarea.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[training_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[training_sin_borrado]
ON [sgc].[training]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51023, N''sgc.training no se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[training_upload_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[training_upload_solo_insercion]
ON [sgc].[training_upload]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51024, N''sgc.training_upload es de solo inserción: una carga nueva reemplaza a la anterior.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[training_result_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[training_result_solo_insercion]
ON [sgc].[training_result]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51025, N''sgc.training_result es de solo inserción.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[cargo_member_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[cargo_member_sin_borrado]
ON [sgc].[cargo_member]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51026, N''sgc.cargo_member no se borra: se desactiva con motivo.'', 1;
END;';
