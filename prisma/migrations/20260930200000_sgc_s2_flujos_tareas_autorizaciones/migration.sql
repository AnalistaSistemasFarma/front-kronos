/*
  Migración: sgc_s2_flujos_tareas_autorizaciones
  SGC documental — Sprint 2 (administración de flujos validados, Tareas
  documentales y Autorizaciones SGC), 2026-09-30.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S1 solo trae CREATE en
  `sgc` y claves foráneas entre tablas de `sgc`):

    Motor genérico de flujos validados (copia congelada del administrador de
    workflows de SynerLink, en tablas propias):
      [sgc].[flow_process]        procesos validados (el documental es el primero)
      [sgc].[flow_version]        versiones de la definición (borrador/vigente/retirada)
      [sgc].[flow_task_def]       tareas (pasos) de cada versión
      [sgc].[flow_transition]     transiciones aprobar/devolver/cancelar
      [sgc].[flow_form_field]     formularios/campos por versión y tarea
      [sgc].[responsible_matrix]  matriz de responsables (solo SUGIERE)
      [sgc].[config_change_log]   registro de cambios de configuración (SOLO INSERCIÓN)

    Instancias ("Tareas documentales", copia de la vista interna de solicitudes):
      [sgc].[request]             solicitud (instancia de un flujo, con su versión)
      [sgc].[request_signer]      revisores/aprobadores que asigna el elaborador
      [sgc].[task]                tareas de la instancia (una por paso y ronda)
      [sgc].[task_assignee]       firmantes de cada tarea, decisión y punto de firma
      [sgc].[form_value]          valores de formularios
      [sgc].[interaction]         historial propio de interacciones (SOLO INSERCIÓN)
      [sgc].[attachment]          adjuntos en OneDrive (no se borran, se retiran)

    Autorizaciones SGC (copia congelada del mecanismo de SynerLink, tablas propias;
    NO usa dbo.types_authorization ni el tipo "Autorización de documento" id 8):
      [sgc].[authorization_type], [sgc].[authorization_type_user], [sgc].[authorization]

    Además: restricciones CHECK de estados, índice único filtrado (una sola
    versión VIGENTE por proceso) y triggers de solo inserción en
    config_change_log e interaction.

  Los DATOS (flujo documental v1, tipos de autorización y matriz de ejemplo de
  One Latam Pharma) van en prisma/manual/2026-09-30-sgc-s2-flujo-documental-olp.sql.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-09-30-sgc-s2-flujos-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[sgc].[flow_process]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[flow_process] (
      [id_flow_process] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(20) NOT NULL,
      [name] NVARCHAR(200) NOT NULL,
      [description] NVARCHAR(1000),
      [category] NVARCHAR(30) NOT NULL CONSTRAINT [flow_process_category_df] DEFAULT 'documental',
      [owner_email] NVARCHAR(255),
      [is_active] BIT NOT NULL CONSTRAINT [flow_process_is_active_df] DEFAULT 1,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [flow_process_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [flow_process_pkey] PRIMARY KEY CLUSTERED ([id_flow_process]),
      CONSTRAINT [flow_process_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
END;

IF OBJECT_ID(N'[sgc].[flow_version]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[flow_version] (
      [id_flow_version] INT NOT NULL IDENTITY(1,1),
      [id_flow_process] INT NOT NULL,
      [version_number] INT NOT NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [flow_version_status_df] DEFAULT 'borrador',
      [change_reason] NVARCHAR(1000) NOT NULL,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [flow_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      [published_by] NVARCHAR(255),
      [published_at] DATETIME2,
      [retired_at] DATETIME2,
      CONSTRAINT [flow_version_pkey] PRIMARY KEY CLUSTERED ([id_flow_version]),
      CONSTRAINT [flow_version_id_flow_process_version_number_key] UNIQUE NONCLUSTERED ([id_flow_process],[version_number])
  );
END;

IF OBJECT_ID(N'[sgc].[flow_task_def]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[flow_task_def] (
      [id_flow_task_def] INT NOT NULL IDENTITY(1,1),
      [id_flow_version] INT NOT NULL,
      [task_key] NVARCHAR(40) NOT NULL,
      [name] NVARCHAR(150) NOT NULL,
      [step_order] INT NOT NULL,
      [role] NVARCHAR(30) NOT NULL,
      [assignment] NVARCHAR(30) NOT NULL,
      [multi_assignee] BIT NOT NULL CONSTRAINT [flow_task_def_multi_assignee_df] DEFAULT 0,
      [signing_mode_default] NVARCHAR(20),
      [signature_meaning] NVARCHAR(20),
      [target_days] INT,
      [condition_key] NVARCHAR(60),
      [is_authorization] BIT NOT NULL CONSTRAINT [flow_task_def_is_authorization_df] DEFAULT 0,
      [authorization_type_code] NVARCHAR(40),
      [pool_authorization_type_code] NVARCHAR(40),
      [is_enabled] BIT NOT NULL CONSTRAINT [flow_task_def_is_enabled_df] DEFAULT 1,
      [description] NVARCHAR(1000),
      CONSTRAINT [flow_task_def_pkey] PRIMARY KEY CLUSTERED ([id_flow_task_def]),
      CONSTRAINT [flow_task_def_id_flow_version_task_key_key] UNIQUE NONCLUSTERED ([id_flow_version],[task_key])
  );
END;

IF OBJECT_ID(N'[sgc].[flow_transition]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[flow_transition] (
      [id_flow_transition] INT NOT NULL IDENTITY(1,1),
      [id_flow_version] INT NOT NULL,
      [from_task_key] NVARCHAR(40) NOT NULL,
      [action] NVARCHAR(20) NOT NULL,
      [to_task_key] NVARCHAR(40),
      [terminal_status] NVARCHAR(20),
      CONSTRAINT [flow_transition_pkey] PRIMARY KEY CLUSTERED ([id_flow_transition]),
      CONSTRAINT [flow_transition_id_flow_version_from_task_key_action_key] UNIQUE NONCLUSTERED ([id_flow_version],[from_task_key],[action])
  );
END;

IF OBJECT_ID(N'[sgc].[flow_form_field]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[flow_form_field] (
      [id_flow_form_field] INT NOT NULL IDENTITY(1,1),
      [id_flow_version] INT NOT NULL,
      [task_key] NVARCHAR(40),
      [field_key] NVARCHAR(40) NOT NULL,
      [label] NVARCHAR(150) NOT NULL,
      [field_type] NVARCHAR(20) NOT NULL,
      [required] BIT NOT NULL CONSTRAINT [flow_form_field_required_df] DEFAULT 0,
      [options_json] NVARCHAR(max),
      [help_text] NVARCHAR(500),
      [sort_order] INT NOT NULL CONSTRAINT [flow_form_field_sort_order_df] DEFAULT 0,
      CONSTRAINT [flow_form_field_pkey] PRIMARY KEY CLUSTERED ([id_flow_form_field]),
      CONSTRAINT [flow_form_field_id_flow_version_task_key_field_key_key] UNIQUE NONCLUSTERED ([id_flow_version],[task_key],[field_key])
  );
END;

IF OBJECT_ID(N'[sgc].[responsible_matrix]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[responsible_matrix] (
      [id_responsible] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_process_map] INT,
      [id_document_type] INT,
      [role] NVARCHAR(20) NOT NULL,
      [user_email] NVARCHAR(255),
      [id_cargo] INT,
      [cargo_name] NVARCHAR(200),
      [sort_order] INT NOT NULL CONSTRAINT [responsible_matrix_sort_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [responsible_matrix_is_active_df] DEFAULT 1,
      [is_example] BIT NOT NULL CONSTRAINT [responsible_matrix_is_example_df] DEFAULT 0,
      [updated_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [responsible_matrix_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [responsible_matrix_pkey] PRIMARY KEY CLUSTERED ([id_responsible])
  );
END;

IF OBJECT_ID(N'[sgc].[config_change_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[config_change_log] (
      [id_config_change] BIGINT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [occurred_at] DATETIME2 NOT NULL CONSTRAINT [config_change_log_occurred_at_df] DEFAULT CURRENT_TIMESTAMP,
      [actor_email] NVARCHAR(255) NOT NULL,
      [entity] NVARCHAR(40) NOT NULL,
      [entity_id] NVARCHAR(60),
      [id_flow_process] INT,
      [id_flow_version] INT,
      [action] NVARCHAR(40) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [change_reference] NVARCHAR(100),
      [before_json] NVARCHAR(max),
      [after_json] NVARCHAR(max),
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      CONSTRAINT [config_change_log_pkey] PRIMARY KEY CLUSTERED ([id_config_change])
  );
END;

IF OBJECT_ID(N'[sgc].[request]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[request] (
      [id_request] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_flow_process] INT NOT NULL,
      [id_flow_version] INT NOT NULL,
      [request_type] NVARCHAR(30) NOT NULL,
      [subject] NVARCHAR(300) NOT NULL,
      [description] NVARCHAR(max) NOT NULL,
      [id_document] INT,
      [id_process_map] INT,
      [id_document_type] INT,
      [requester_email] NVARCHAR(255) NOT NULL,
      [elaborator_email] NVARCHAR(255) NOT NULL,
      [signing_modes_json] NVARCHAR(1000) NOT NULL CONSTRAINT [request_signing_modes_json_df] DEFAULT '{}',
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [request_status_df] DEFAULT 'abierta',
      [current_task_key] NVARCHAR(40),
      [cancel_reason] NVARCHAR(1000),
      [closed_by] NVARCHAR(255),
      [closed_at] DATETIME2,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [request_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [request_pkey] PRIMARY KEY CLUSTERED ([id_request])
  );
END;

IF OBJECT_ID(N'[sgc].[request_signer]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[request_signer] (
      [id_request_signer] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [step_key] NVARCHAR(40) NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [sign_order] INT NOT NULL,
      [is_active] BIT NOT NULL CONSTRAINT [request_signer_is_active_df] DEFAULT 1,
      [added_by] NVARCHAR(255) NOT NULL,
      [added_at] DATETIME2 NOT NULL CONSTRAINT [request_signer_added_at_df] DEFAULT CURRENT_TIMESTAMP,
      [removed_by] NVARCHAR(255),
      [removed_at] DATETIME2,
      [change_reason] NVARCHAR(1000),
      CONSTRAINT [request_signer_pkey] PRIMARY KEY CLUSTERED ([id_request_signer])
  );
END;

IF OBJECT_ID(N'[sgc].[task]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[task] (
      [id_task] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_flow_task_def] INT NOT NULL,
      [task_key] NVARCHAR(40) NOT NULL,
      [name] NVARCHAR(150) NOT NULL,
      [step_order] INT NOT NULL,
      [round] INT NOT NULL CONSTRAINT [task_round_df] DEFAULT 1,
      [status] NVARCHAR(20) NOT NULL,
      [signing_mode] NVARCHAR(20),
      [started_at] DATETIME2,
      [ended_at] DATETIME2,
      [resolution] NVARCHAR(2000),
      [resolved_by] NVARCHAR(255),
      [created_at] DATETIME2 NOT NULL CONSTRAINT [task_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [task_pkey] PRIMARY KEY CLUSTERED ([id_task])
  );
END;

IF OBJECT_ID(N'[sgc].[task_assignee]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[task_assignee] (
      [id_task_assignee] INT NOT NULL IDENTITY(1,1),
      [id_task] INT NOT NULL,
      [user_email] NVARCHAR(255),
      [pool_type_code] NVARCHAR(40),
      [sign_order] INT NOT NULL CONSTRAINT [task_assignee_sign_order_df] DEFAULT 1,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [task_assignee_status_df] DEFAULT 'pendiente',
      [decided_by] NVARCHAR(255),
      [decided_at] DATETIME2,
      [comment] NVARCHAR(2000),
      [signature_status] NVARCHAR(20) NOT NULL CONSTRAINT [task_assignee_signature_status_df] DEFAULT 'no_aplica',
      [signature_meaning] NVARCHAR(20),
      [notified_at] DATETIME2,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [task_assignee_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [task_assignee_pkey] PRIMARY KEY CLUSTERED ([id_task_assignee])
  );
END;

IF OBJECT_ID(N'[sgc].[form_value]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[form_value] (
      [id_form_value] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_flow_form_field] INT NOT NULL,
      [value_text] NVARCHAR(max),
      [updated_by] NVARCHAR(255) NOT NULL,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [form_value_pkey] PRIMARY KEY CLUSTERED ([id_form_value]),
      CONSTRAINT [form_value_id_request_id_flow_form_field_key] UNIQUE NONCLUSTERED ([id_request],[id_flow_form_field])
  );
END;

IF OBJECT_ID(N'[sgc].[interaction]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[interaction] (
      [id_interaction] BIGINT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT,
      [kind] NVARCHAR(20) NOT NULL,
      [author_email] NVARCHAR(255) NOT NULL,
      [body] NVARCHAR(max) NOT NULL,
      [meta_json] NVARCHAR(max),
      [notify_emails] NVARCHAR(2000),
      [created_at] DATETIME2 NOT NULL CONSTRAINT [interaction_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [interaction_pkey] PRIMARY KEY CLUSTERED ([id_interaction])
  );
END;

IF OBJECT_ID(N'[sgc].[attachment]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[attachment] (
      [id_attachment] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT,
      [purpose] NVARCHAR(20) NOT NULL CONSTRAINT [attachment_purpose_df] DEFAULT 'soporte',
      [file_name] NVARCHAR(260) NOT NULL,
      [item_id] NVARCHAR(200) NOT NULL,
      [storage_path] NVARCHAR(600) NOT NULL,
      [content_type] NVARCHAR(150) NOT NULL,
      [size_bytes] INT NOT NULL,
      [sha256] CHAR(64) NOT NULL,
      [uploaded_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [attachment_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [withdrawn_at] DATETIME2,
      [withdrawn_by] NVARCHAR(255),
      [withdraw_reason] NVARCHAR(1000),
      CONSTRAINT [attachment_pkey] PRIMARY KEY CLUSTERED ([id_attachment])
  );
END;

IF OBJECT_ID(N'[sgc].[authorization_type]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[authorization_type] (
      [id_authorization_type] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [code] NVARCHAR(40) NOT NULL,
      [name] NVARCHAR(150) NOT NULL,
      [description] NVARCHAR(1000),
      [is_active] BIT NOT NULL CONSTRAINT [authorization_type_is_active_df] DEFAULT 1,
      [updated_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [authorization_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      CONSTRAINT [authorization_type_pkey] PRIMARY KEY CLUSTERED ([id_authorization_type]),
      CONSTRAINT [authorization_type_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
  );
END;

IF OBJECT_ID(N'[sgc].[authorization_type_user]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[authorization_type_user] (
      [id_authorization_type_user] INT NOT NULL IDENTITY(1,1),
      [id_authorization_type] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [granted_by] NVARCHAR(255) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [authorization_type_user_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [revoked_at] DATETIME2,
      [revoked_by] NVARCHAR(255),
      CONSTRAINT [authorization_type_user_pkey] PRIMARY KEY CLUSTERED ([id_authorization_type_user])
  );
END;

IF OBJECT_ID(N'[sgc].[authorization]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[authorization] (
      [id_authorization] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_authorization_type] INT NOT NULL,
      [id_request] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [assigned_email] NVARCHAR(255),
      [status] NVARCHAR(20) NOT NULL CONSTRAINT [authorization_status_df] DEFAULT 'pendiente',
      [requested_at] DATETIME2 NOT NULL CONSTRAINT [authorization_requested_at_df] DEFAULT CURRENT_TIMESTAMP,
      [decided_by] NVARCHAR(255),
      [decided_at] DATETIME2,
      [decision_comment] NVARCHAR(2000),
      CONSTRAINT [authorization_pkey] PRIMARY KEY CLUSTERED ([id_authorization])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'responsible_matrix_id_company_role_idx' AND object_id = OBJECT_ID(N'[sgc].[responsible_matrix]'))
  CREATE NONCLUSTERED INDEX [responsible_matrix_id_company_role_idx] ON [sgc].[responsible_matrix]([id_company], [role]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'config_change_log_id_company_occurred_at_idx' AND object_id = OBJECT_ID(N'[sgc].[config_change_log]'))
  CREATE NONCLUSTERED INDEX [config_change_log_id_company_occurred_at_idx] ON [sgc].[config_change_log]([id_company], [occurred_at]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'config_change_log_entity_entity_id_idx' AND object_id = OBJECT_ID(N'[sgc].[config_change_log]'))
  CREATE NONCLUSTERED INDEX [config_change_log_entity_entity_id_idx] ON [sgc].[config_change_log]([entity], [entity_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'request_id_company_status_idx' AND object_id = OBJECT_ID(N'[sgc].[request]'))
  CREATE NONCLUSTERED INDEX [request_id_company_status_idx] ON [sgc].[request]([id_company], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'request_requester_email_idx' AND object_id = OBJECT_ID(N'[sgc].[request]'))
  CREATE NONCLUSTERED INDEX [request_requester_email_idx] ON [sgc].[request]([requester_email]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'request_signer_id_request_step_key_idx' AND object_id = OBJECT_ID(N'[sgc].[request_signer]'))
  CREATE NONCLUSTERED INDEX [request_signer_id_request_step_key_idx] ON [sgc].[request_signer]([id_request], [step_key]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'task_id_request_idx' AND object_id = OBJECT_ID(N'[sgc].[task]'))
  CREATE NONCLUSTERED INDEX [task_id_request_idx] ON [sgc].[task]([id_request]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'task_assignee_id_task_idx' AND object_id = OBJECT_ID(N'[sgc].[task_assignee]'))
  CREATE NONCLUSTERED INDEX [task_assignee_id_task_idx] ON [sgc].[task_assignee]([id_task]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'task_assignee_user_email_status_idx' AND object_id = OBJECT_ID(N'[sgc].[task_assignee]'))
  CREATE NONCLUSTERED INDEX [task_assignee_user_email_status_idx] ON [sgc].[task_assignee]([user_email], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'interaction_id_request_created_at_idx' AND object_id = OBJECT_ID(N'[sgc].[interaction]'))
  CREATE NONCLUSTERED INDEX [interaction_id_request_created_at_idx] ON [sgc].[interaction]([id_request], [created_at]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attachment_id_request_idx' AND object_id = OBJECT_ID(N'[sgc].[attachment]'))
  CREATE NONCLUSTERED INDEX [attachment_id_request_idx] ON [sgc].[attachment]([id_request]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'authorization_type_user_id_authorization_type_idx' AND object_id = OBJECT_ID(N'[sgc].[authorization_type_user]'))
  CREATE NONCLUSTERED INDEX [authorization_type_user_id_authorization_type_idx] ON [sgc].[authorization_type_user]([id_authorization_type]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'authorization_id_company_status_idx' AND object_id = OBJECT_ID(N'[sgc].[authorization]'))
  CREATE NONCLUSTERED INDEX [authorization_id_company_status_idx] ON [sgc].[authorization]([id_company], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'authorization_assigned_email_status_idx' AND object_id = OBJECT_ID(N'[sgc].[authorization]'))
  CREATE NONCLUSTERED INDEX [authorization_assigned_email_status_idx] ON [sgc].[authorization]([assigned_email], [status]);

IF OBJECT_ID(N'[sgc].[flow_process_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[flow_process] ADD CONSTRAINT [flow_process_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[flow_version_id_flow_process_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[flow_version] ADD CONSTRAINT [flow_version_id_flow_process_fkey] FOREIGN KEY ([id_flow_process]) REFERENCES [sgc].[flow_process]([id_flow_process]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[flow_task_def_id_flow_version_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[flow_task_def] ADD CONSTRAINT [flow_task_def_id_flow_version_fkey] FOREIGN KEY ([id_flow_version]) REFERENCES [sgc].[flow_version]([id_flow_version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[flow_transition_id_flow_version_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[flow_transition] ADD CONSTRAINT [flow_transition_id_flow_version_fkey] FOREIGN KEY ([id_flow_version]) REFERENCES [sgc].[flow_version]([id_flow_version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[flow_form_field_id_flow_version_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[flow_form_field] ADD CONSTRAINT [flow_form_field_id_flow_version_fkey] FOREIGN KEY ([id_flow_version]) REFERENCES [sgc].[flow_version]([id_flow_version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[responsible_matrix_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[responsible_matrix] ADD CONSTRAINT [responsible_matrix_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[responsible_matrix_id_process_map_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[responsible_matrix] ADD CONSTRAINT [responsible_matrix_id_process_map_fkey] FOREIGN KEY ([id_process_map]) REFERENCES [sgc].[process_map]([id_process_map]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[responsible_matrix_id_document_type_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[responsible_matrix] ADD CONSTRAINT [responsible_matrix_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [sgc].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_flow_process_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_flow_process_fkey] FOREIGN KEY ([id_flow_process]) REFERENCES [sgc].[flow_process]([id_flow_process]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_flow_version_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_flow_version_fkey] FOREIGN KEY ([id_flow_version]) REFERENCES [sgc].[flow_version]([id_flow_version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_document_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [sgc].[document]([id_document]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_process_map_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_process_map_fkey] FOREIGN KEY ([id_process_map]) REFERENCES [sgc].[process_map]([id_process_map]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_id_document_type_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [sgc].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[request_signer_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[request_signer] ADD CONSTRAINT [request_signer_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[task_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[task] ADD CONSTRAINT [task_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[task_id_flow_task_def_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[task] ADD CONSTRAINT [task_id_flow_task_def_fkey] FOREIGN KEY ([id_flow_task_def]) REFERENCES [sgc].[flow_task_def]([id_flow_task_def]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[task_assignee_id_task_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[task_assignee] ADD CONSTRAINT [task_assignee_id_task_fkey] FOREIGN KEY ([id_task]) REFERENCES [sgc].[task]([id_task]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[form_value_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[form_value] ADD CONSTRAINT [form_value_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[form_value_id_flow_form_field_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[form_value] ADD CONSTRAINT [form_value_id_flow_form_field_fkey] FOREIGN KEY ([id_flow_form_field]) REFERENCES [sgc].[flow_form_field]([id_flow_form_field]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[interaction_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[interaction] ADD CONSTRAINT [interaction_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[attachment_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[attachment] ADD CONSTRAINT [attachment_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[authorization_type_id_company_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[authorization_type] ADD CONSTRAINT [authorization_type_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[authorization_type_user_id_authorization_type_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[authorization_type_user] ADD CONSTRAINT [authorization_type_user_id_authorization_type_fkey] FOREIGN KEY ([id_authorization_type]) REFERENCES [sgc].[authorization_type]([id_authorization_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[authorization_id_authorization_type_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[authorization] ADD CONSTRAINT [authorization_id_authorization_type_fkey] FOREIGN KEY ([id_authorization_type]) REFERENCES [sgc].[authorization_type]([id_authorization_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[authorization_id_request_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[authorization] ADD CONSTRAINT [authorization_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF OBJECT_ID(N'[sgc].[authorization_id_task_assignee_fkey]', N'F') IS NULL
  ALTER TABLE [sgc].[authorization] ADD CONSTRAINT [authorization_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;

/* Integridad de estados y valores (también la valida lib/sgc). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_version_status_ck')
  ALTER TABLE [sgc].[flow_version] ADD CONSTRAINT [flow_version_status_ck]
    CHECK ([status] IN (N'borrador', N'vigente', N'retirada'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'flow_transition_action_ck')
  ALTER TABLE [sgc].[flow_transition] ADD CONSTRAINT [flow_transition_action_ck]
    CHECK ([action] IN (N'aprobar', N'devolver', N'cancelar')
      AND ([to_task_key] IS NOT NULL OR [terminal_status] IN (N'completada', N'cancelada')));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'responsible_matrix_target_ck')
  ALTER TABLE [sgc].[responsible_matrix] ADD CONSTRAINT [responsible_matrix_target_ck]
    CHECK ([role] IN (N'elaborador', N'revisor', N'aprobador')
      AND ([user_email] IS NOT NULL OR [id_cargo] IS NOT NULL OR [cargo_name] IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'request_status_ck')
  ALTER TABLE [sgc].[request] ADD CONSTRAINT [request_status_ck]
    CHECK ([status] IN (N'abierta', N'en_espera', N'completada', N'cancelada'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'task_status_ck')
  ALTER TABLE [sgc].[task] ADD CONSTRAINT [task_status_ck]
    CHECK ([status] IN (N'sin_empezar', N'abierta', N'resuelta', N'devuelta', N'cancelada', N'en_espera'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'task_assignee_status_ck')
  ALTER TABLE [sgc].[task_assignee] ADD CONSTRAINT [task_assignee_status_ck]
    CHECK ([status] IN (N'pendiente', N'aprobado', N'devuelto', N'reemplazado', N'anulado')
      AND ([user_email] IS NOT NULL OR [pool_type_code] IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'authorization_status_ck')
  ALTER TABLE [sgc].[authorization] ADD CONSTRAINT [authorization_status_ck]
    CHECK ([status] IN (N'pendiente', N'autorizada', N'rechazada', N'anulada'));

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
  Una sola versión VIGENTE por proceso (índice único filtrado). Va fuera de
  la transacción y con sp_executesql: un índice filtrado exige SET
  QUOTED_IDENTIFIER ON en la sesión que lo crea y en las que escriben.
*/
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'flow_version_una_vigente_uq' AND object_id = OBJECT_ID(N'[sgc].[flow_version]'))
  EXEC sp_executesql N'SET QUOTED_IDENTIFIER ON; CREATE UNIQUE NONCLUSTERED INDEX [flow_version_una_vigente_uq] ON [sgc].[flow_version]([id_flow_process]) WHERE [status] = N''vigente'';';

/*
  Registro de cambios de configuración e historial de interacciones
  INMODIFICABLES: el trigger INSTEAD OF rechaza cualquier UPDATE o DELETE, sea
  cual sea el usuario de base de datos. Solo se puede insertar.
*/
IF OBJECT_ID(N'[sgc].[config_change_log_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[config_change_log_solo_insercion]
ON [sgc].[config_change_log]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51001, N''sgc.config_change_log es de solo inserción: no se permite modificar ni borrar el registro de cambios de configuración.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[interaction_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[interaction_solo_insercion]
ON [sgc].[interaction]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51002, N''sgc.interaction es de solo inserción: el historial de interacciones no se modifica ni se borra.'', 1;
END;';
