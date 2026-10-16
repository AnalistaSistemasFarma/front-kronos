/*
  Migración: sgc_s1_repositorio
  SGC documental — Sprint 1 (repositorio y listado maestro), 2026-09-30.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S0 solo trae CREATE en
  `sgc` y claves foráneas hacia dbo.department):
    - [sgc].[coding_guide]      guía de codificación por empresa
    - [sgc].[process_type]      tipos de proceso (estratégico, misional…)
    - [sgc].[process_map]       procesos del mapa, con su departamento dueño
    - [sgc].[document_type]     tipos documentales (MA, PR, IN, FO…)
    - [sgc].[document]          documentos controlados (código único por empresa)
    - [sgc].[document_version]  versiones con su PDF controlado (hash SHA-256)
    - [sgc].[document_access]   accesos por departamento/persona y permisos
                                excepcionales de descarga/impresión
    - [sgc].[audit_log]         auditoría SOLO INSERCIÓN (trigger que rechaza
                                UPDATE y DELETE)
    - Restricciones CHECK de estados y confidencialidad.

  Los DATOS (maestros de One Latam Pharma) van en
  prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql, no aquí.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-09-30-sgc-s1-repositorio-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[sgc].[coding_guide]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[coding_guide] (
      [id_company] INT NOT NULL,
      [prefix] NVARCHAR(10) NOT NULL,
      [pattern] NVARCHAR(200) NOT NULL,
      [sequence_digits] INT NOT NULL CONSTRAINT [coding_guide_sequence_digits_df] DEFAULT 3,
      [updated_by] NVARCHAR(255),
      [change_reason] NVARCHAR(1000),
      [created_at] DATETIME2 NOT NULL CONSTRAINT [coding_guide_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [coding_guide_pkey] PRIMARY KEY CLUSTERED ([id_company])
  );
  
  ALTER TABLE [sgc].[coding_guide] ADD CONSTRAINT [coding_guide_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[process_type]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[process_type] (
      [id_process_type] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(10) NOT NULL,
      [name] NVARCHAR(150) NOT NULL,
      [color] NVARCHAR(20) NOT NULL CONSTRAINT [process_type_color_df] DEFAULT 'blue',
      [sort_order] INT NOT NULL CONSTRAINT [process_type_sort_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [process_type_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [process_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [process_type_pkey] PRIMARY KEY CLUSTERED ([id_process_type]),
      CONSTRAINT [process_type_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
  
  ALTER TABLE [sgc].[process_type] ADD CONSTRAINT [process_type_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[process_map]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[process_map] (
      [id_process_map] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_process_type] INT NOT NULL,
      [code] NVARCHAR(10) NOT NULL,
      [name] NVARCHAR(200) NOT NULL,
      [id_department] INT,
      [sort_order] INT NOT NULL CONSTRAINT [process_map_sort_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [process_map_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [process_map_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [process_map_pkey] PRIMARY KEY CLUSTERED ([id_process_map]),
      CONSTRAINT [process_map_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
  
  ALTER TABLE [sgc].[process_map] ADD CONSTRAINT [process_map_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[process_map] ADD CONSTRAINT [process_map_id_process_type_fkey] FOREIGN KEY ([id_process_type]) REFERENCES [sgc].[process_type]([id_process_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[process_map] ADD CONSTRAINT [process_map_id_department_fkey] FOREIGN KEY ([id_department]) REFERENCES [dbo].[department]([id_department]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[document_type]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document_type] (
      [id_document_type] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(10) NOT NULL,
      [name] NVARCHAR(100) NOT NULL,
      [plural_name] NVARCHAR(100) NOT NULL,
      [requires_training] BIT NOT NULL CONSTRAINT [document_type_requires_training_df] DEFAULT 1,
      [review_months] INT NOT NULL CONSTRAINT [document_type_review_months_df] DEFAULT 36,
      [alert_months] INT NOT NULL CONSTRAINT [document_type_alert_months_df] DEFAULT 2,
      [sort_order] INT NOT NULL CONSTRAINT [document_type_sort_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [document_type_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [document_type_pkey] PRIMARY KEY CLUSTERED ([id_document_type]),
      CONSTRAINT [document_type_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
  
  ALTER TABLE [sgc].[document_type] ADD CONSTRAINT [document_type_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[document]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document] (
      [id_document] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(60) NOT NULL,
      [title] NVARCHAR(300) NOT NULL,
      [id_document_type] INT NOT NULL,
      [id_process_map] INT NOT NULL,
      [id_owner_department] INT,
      [confidentiality] NVARCHAR(20) NOT NULL CONSTRAINT [document_confidentiality_df] DEFAULT 'publica',
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [document_status_df] DEFAULT 'borrador',
      [sequence_number] INT,
      [current_version_id] INT,
      [next_review_date] DATE,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      [annulled_by] NVARCHAR(255),
      [annulled_at] DATETIME2,
      [annul_reason] NVARCHAR(1000),
      CONSTRAINT [document_pkey] PRIMARY KEY CLUSTERED ([id_document]),
      CONSTRAINT [document_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
  
  CREATE NONCLUSTERED INDEX [document_id_company_status_idx] ON [sgc].[document]([id_company], [status]);
  
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [sgc].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_id_process_map_fkey] FOREIGN KEY ([id_process_map]) REFERENCES [sgc].[process_map]([id_process_map]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_id_owner_department_fkey] FOREIGN KEY ([id_owner_department]) REFERENCES [dbo].[department]([id_department]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[document_version]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document_version] (
      [id_document_version] INT NOT NULL IDENTITY(1,1),
      [id_document] INT NOT NULL,
      [version_number] INT NOT NULL,
      [status] NVARCHAR(20) NOT NULL,
      [pdf_item_id] NVARCHAR(200) NOT NULL,
      [pdf_path] NVARCHAR(600) NOT NULL,
      [pdf_file_name] NVARCHAR(260) NOT NULL,
      [pdf_sha256] CHAR(64) NOT NULL,
      [pdf_size] INT NOT NULL,
      [source_item_id] NVARCHAR(200),
      [source_path] NVARCHAR(600),
      [source_file_name] NVARCHAR(260),
      [change_description] NVARCHAR(2000),
      [effective_date] DATE,
      [review_due_date] DATE,
      [obsolete_date] DATE,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [document_version_pkey] PRIMARY KEY CLUSTERED ([id_document_version]),
      CONSTRAINT [document_version_id_document_version_number_key] UNIQUE NONCLUSTERED ([id_document],[version_number])
  );
  
  ALTER TABLE [sgc].[document_version] ADD CONSTRAINT [document_version_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[document_access]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[document_access] (
      [id_document_access] INT NOT NULL IDENTITY(1,1),
      [id_document] INT NOT NULL,
      [id_department] INT,
      [user_email] NVARCHAR(255),
      [can_view] BIT NOT NULL CONSTRAINT [document_access_can_view_df] DEFAULT 1,
      [can_download] BIT NOT NULL CONSTRAINT [document_access_can_download_df] DEFAULT 0,
      [can_print] BIT NOT NULL CONSTRAINT [document_access_can_print_df] DEFAULT 0,
      [expires_at] DATETIME2,
      [reason] NVARCHAR(1000) NOT NULL,
      [granted_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_access_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [revoked_at] DATETIME2,
      [revoked_by] NVARCHAR(255),
      CONSTRAINT [document_access_pkey] PRIMARY KEY CLUSTERED ([id_document_access])
  );
  
  CREATE NONCLUSTERED INDEX [document_access_id_document_idx] ON [sgc].[document_access]([id_document]);
  
  ALTER TABLE [sgc].[document_access] ADD CONSTRAINT [document_access_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  
  ALTER TABLE [sgc].[document_access] ADD CONSTRAINT [document_access_id_department_fkey] FOREIGN KEY ([id_department]) REFERENCES [dbo].[department]([id_department]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[audit_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[audit_log] (
      [id_audit_log] BIGINT NOT NULL IDENTITY(1,1),
      [id_company] INT,
      [occurred_at] DATETIME2 NOT NULL CONSTRAINT [audit_log_occurred_at_df] DEFAULT CURRENT_TIMESTAMP,
      [actor_email] NVARCHAR(255),
      [action] NVARCHAR(80) NOT NULL,
      [entity] NVARCHAR(60) NOT NULL,
      [entity_id] NVARCHAR(60),
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      [before_json] NVARCHAR(max),
      [after_json] NVARCHAR(max),
      [detail] NVARCHAR(1000),
      CONSTRAINT [audit_log_pkey] PRIMARY KEY CLUSTERED ([id_audit_log])
  );
  
  CREATE NONCLUSTERED INDEX [audit_log_entity_entity_id_idx] ON [sgc].[audit_log]([entity], [entity_id]);
  
  CREATE NONCLUSTERED INDEX [audit_log_id_company_occurred_at_idx] ON [sgc].[audit_log]([id_company], [occurred_at]);
END;

/* Integridad de estados y confidencialidad (también la valida lib/sgc). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck')
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_status_ck]
    CHECK ([status] IN (N'borrador', N'vigente', N'obsoleto', N'anulado'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_confidentiality_ck')
  ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_confidentiality_ck]
    CHECK ([confidentiality] IN (N'publica', N'departamento', N'confidencial'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_version_status_ck')
  ALTER TABLE [sgc].[document_version] ADD CONSTRAINT [document_version_status_ck]
    CHECK ([status] IN (N'borrador', N'vigente', N'obsoleto', N'anulado'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_access_target_ck')
  ALTER TABLE [sgc].[document_access] ADD CONSTRAINT [document_access_target_ck]
    CHECK ([id_department] IS NOT NULL OR [user_email] IS NOT NULL);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/*
  Auditoría inmodificable: el trigger INSTEAD OF rechaza cualquier UPDATE o
  DELETE sobre sgc.audit_log, sea cual sea el usuario de base de datos. Solo se
  puede insertar. (Va fuera de la transacción: CREATE TRIGGER debe ser el único
  comando de su lote, por eso se crea con sp_executesql.)
*/
IF OBJECT_ID(N'[sgc].[audit_log_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[audit_log_solo_insercion]
ON [sgc].[audit_log]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51000, N''sgc.audit_log es de solo inserción: no se permite modificar ni borrar registros de auditoría.'', 1;
END;';
