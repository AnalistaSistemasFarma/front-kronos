/*
  PASE SGC · F1 · ESTRUCTURA DEL ESQUEMA sgc (ANTES del código)
  Generado por scripts/sgc/pase-produccion/prod/armar-consolidado.mjs el 2026-10-10.
  Base esperada: KRONOSDB en SERFARMA03 (cada lote empieza con una guardia que hace THROW si no coincide).
  Correr SOLO con aplicar-sql.mjs (se detiene en el primer error) y con la autorización del pase.
  Aditivo: solo crea objetos en el esquema sgc y el trigger de base sgc_proteger_esquema. Idempotente.
*/
SET NOCOUNT ON;
GO
/* GUARDIA · prisma/migrations/20260930110000_sgc_esquema_base/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260930110000_sgc_esquema_base/migration.sql ===== */
/*
  Migración: sgc_esquema_base
  SGC documental — Sprint 0 (2026-09-30). Cimientos del módulo aislado del
  Sistema de Gestión de Calidad.

  Decisión (Nicolás, 2026-09-30): las tablas del SGC viven en un ESQUEMA SQL
  PROPIO `sgc`, no en `dbo` con prefijo. Validado con Prisma 6.17: el
  datasource declara schemas = ["dbo", "sgc"] y cada modelo su @@schema; el
  diff esquema-contra-esquema confirma que las tablas de `dbo` no cambian
  (solo se agrega el esquema `sgc`).

  Qué agrega (100 % ADITIVA, no toca ninguna tabla existente):
    - Esquema [sgc].
    - [sgc].[company_config]: empresas activadas en el SGC (multiempresa desde
      el diseño, activación por empresa). FK real a [dbo].[company].

  Los DATOS (activar One Latam Pharma, subprocesos-permiso del módulo) van en
  prisma/manual/2026-09-30-sgc-s0-cimientos.sql, no aquí.

  ⚠️ ORDEN DEL PASE: esta migración va ANTES que el código (Prisma lee el
  modelo SgcCompanyConfig). Idempotente.

  Para registrarla como aplicada en una base donde ya se corrió a mano:
    npx prisma migrate resolve --applied 20260930110000_sgc_esquema_base

  REVERSA: DROP TABLE [sgc].[company_config]; DROP SCHEMA [sgc];
*/

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'sgc')
  EXEC sp_executesql N'CREATE SCHEMA [sgc];';

IF OBJECT_ID(N'[sgc].[company_config]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[company_config] (
    [id_company] INT NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [company_config_is_active_df] DEFAULT 0,
    [storage_root] NVARCHAR(300) NOT NULL,
    [activated_by] NVARCHAR(255),
    [activated_at] DATETIME2,
    [change_reason] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [company_config_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [company_config_pkey] PRIMARY KEY CLUSTERED ([id_company])
  );

  ALTER TABLE [sgc].[company_config] ADD CONSTRAINT [company_config_id_company_fkey]
    FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
GO
/* GUARDIA · prisma/migrations/20260930150000_sgc_s1_repositorio/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260930150000_sgc_s1_repositorio/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20260930200000_sgc_s2_flujos_tareas_autorizaciones/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260930200000_sgc_s2_flujos_tareas_autorizaciones/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20260930230000_sgc_s3_firma_pdf_calidad/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260930230000_sgc_s3_firma_pdf_calidad/migration.sql ===== */
/*
  Migración: sgc_s3_firma_pdf_calidad
  SGC documental — Sprint 3 (firma electrónica propia, PDF controlado,
  lista de chequeo de Calidad y edición en la app del borrador), 2026-09-30.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S2 solo trae cambios en
  `sgc`):
    - [sgc].[signature]          firmas electrónicas del SGC (SOLO INSERCIÓN):
                                 significado, motivo, sello de tiempo del
                                 servidor, hash del contenido firmado, método
                                 de reautenticación, evidencia en el espacio
                                 de la empresa y encadenamiento (record_hash)
    - [sgc].[signature_consent]  aceptación del consentimiento legal (SOLO INSERCIÓN)
    - [sgc].[signature_master]   maestro de firmas de Calidad (no se borra: se revoca)
    - [sgc].[draft_revision]     revisiones del borrador editado en la app (SOLO INSERCIÓN)
    - [sgc].[quality_check]      lista de chequeo de Calidad (SOLO INSERCIÓN)
    - Columnas nuevas (todas NULL o con DEFAULT):
        document_version.id_request / signed_content_sha256 / manifest_json
        flow_form_field.quality_check (BIT, 0)
        request.id_document_version / controlled_pdf_status / controlled_pdf_error
        task_assignee.id_signature
    - Datos: los puntos de firma del S2 pasan de «pendiente_s3» a «pendiente»
      (aún por firmar) o a «sin_firma_s2» (se decidieron en el S2, antes de
      que existiera la firma propia: quedan marcados, no se falsean).
    - Triggers de solo inserción en signature, signature_consent,
      draft_revision y quality_check; signature_master rechaza DELETE y solo
      admite UPDATE de las columnas de revocación.

  La SIN dependencia de Orión es de diseño: ninguna tabla referencia a
  ORIONDB ni a dbo.orion_document_event.

  Los DATOS (flujo documental v2 con la lista de chequeo de Calidad de OLP)
  van en prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[sgc].[document_version]', N'id_request') IS NULL
  ALTER TABLE [sgc].[document_version] ADD [id_request] INT, [manifest_json] NVARCHAR(max), [signed_content_sha256] CHAR(64);

IF COL_LENGTH(N'[sgc].[flow_form_field]', N'quality_check') IS NULL
  ALTER TABLE [sgc].[flow_form_field] ADD [quality_check] BIT NOT NULL CONSTRAINT [flow_form_field_quality_check_df] DEFAULT 0;

IF COL_LENGTH(N'[sgc].[request]', N'id_document_version') IS NULL
  ALTER TABLE [sgc].[request] ADD [controlled_pdf_error] NVARCHAR(1000), [controlled_pdf_status] NVARCHAR(20), [id_document_version] INT;

IF COL_LENGTH(N'[sgc].[task_assignee]', N'id_signature') IS NULL
  ALTER TABLE [sgc].[task_assignee] ADD [id_signature] INT;

IF OBJECT_ID(N'[sgc].[signature]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature] (
      [id_signature] INT NOT NULL IDENTITY(1,1),
      [signature_uid] CHAR(36) NOT NULL,
      [id_company] INT NOT NULL,
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [signer_email] NVARCHAR(255) NOT NULL,
      [signer_name] NVARCHAR(255),
      [meaning] NVARCHAR(20) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [signed_at] DATETIME2 NOT NULL,
      [content_kind] NVARCHAR(30) NOT NULL,
      [content_ref] NVARCHAR(60) NOT NULL,
      [content_name] NVARCHAR(260) NOT NULL,
      [content_sha256] CHAR(64) NOT NULL,
      [auth_method] NVARCHAR(40) NOT NULL,
      [consent_version] NVARCHAR(60) NOT NULL,
      [id_signature_master] INT,
      [master_sha256] CHAR(64),
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      [evidence_item_id] NVARCHAR(200) NOT NULL,
      [evidence_path] NVARCHAR(600) NOT NULL,
      [evidence_sha256] CHAR(64) NOT NULL,
      [prev_record_hash] CHAR(64),
      [record_hash] CHAR(64) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [signature_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [signature_pkey] PRIMARY KEY CLUSTERED ([id_signature]),
      CONSTRAINT [signature_signature_uid_key] UNIQUE NONCLUSTERED ([signature_uid]),
      CONSTRAINT [signature_record_hash_key] UNIQUE NONCLUSTERED ([record_hash])
  );

  CREATE NONCLUSTERED INDEX [signature_id_company_id_signature_idx] ON [sgc].[signature]([id_company], [id_signature]);
  CREATE NONCLUSTERED INDEX [signature_id_request_idx] ON [sgc].[signature]([id_request]);
  CREATE NONCLUSTERED INDEX [signature_signer_email_idx] ON [sgc].[signature]([signer_email]);
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[signature_consent]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature_consent] (
      [id_signature_consent] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [consent_version] NVARCHAR(60) NOT NULL,
      [text_sha256] CHAR(64) NOT NULL,
      [accepted_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      CONSTRAINT [signature_consent_pkey] PRIMARY KEY CLUSTERED ([id_signature_consent]),
      CONSTRAINT [signature_consent_id_company_user_email_consent_version_key] UNIQUE NONCLUSTERED ([id_company],[user_email],[consent_version])
  );

  ALTER TABLE [sgc].[signature_consent] ADD CONSTRAINT [signature_consent_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[signature_master]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature_master] (
      [id_signature_master] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [version_number] INT NOT NULL,
      [image_png] NVARCHAR(max) NOT NULL,
      [image_sha256] CHAR(64) NOT NULL,
      [registered_by] NVARCHAR(255) NOT NULL,
      [registered_at] DATETIME2 NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [revoked_at] DATETIME2,
      [revoked_by] NVARCHAR(255),
      [revoke_reason] NVARCHAR(1000),
      CONSTRAINT [signature_master_pkey] PRIMARY KEY CLUSTERED ([id_signature_master]),
      CONSTRAINT [signature_master_id_company_user_email_version_number_key] UNIQUE NONCLUSTERED ([id_company],[user_email],[version_number])
  );

  ALTER TABLE [sgc].[signature_master] ADD CONSTRAINT [signature_master_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[draft_revision]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[draft_revision] (
      [id_draft_revision] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [revision_number] INT NOT NULL,
      [origin] NVARCHAR(20) NOT NULL,
      [origin_ref] NVARCHAR(200),
      [content_html] NVARCHAR(max) NOT NULL,
      [sha256] CHAR(64) NOT NULL,
      [size_bytes] INT NOT NULL,
      [note] NVARCHAR(500),
      [saved_by] NVARCHAR(255) NOT NULL,
      [saved_at] DATETIME2 NOT NULL,
      CONSTRAINT [draft_revision_pkey] PRIMARY KEY CLUSTERED ([id_draft_revision]),
      CONSTRAINT [draft_revision_id_request_revision_number_key] UNIQUE NONCLUSTERED ([id_request],[revision_number])
  );

  ALTER TABLE [sgc].[draft_revision] ADD CONSTRAINT [draft_revision_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[quality_check]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[quality_check] (
      [id_quality_check] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [id_signature] INT,
      [items_json] NVARCHAR(max) NOT NULL,
      [result] NVARCHAR(20) NOT NULL,
      [checked_by] NVARCHAR(255) NOT NULL,
      [checked_at] DATETIME2 NOT NULL,
      CONSTRAINT [quality_check_pkey] PRIMARY KEY CLUSTERED ([id_quality_check])
  );

  CREATE NONCLUSTERED INDEX [quality_check_id_request_idx] ON [sgc].[quality_check]([id_request]);
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

/* Estados de firma y resultado de la lista de chequeo (catálogo cerrado). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signature_meaning_ck')
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_meaning_ck]
    CHECK ([meaning] IN (N'elaboro', N'reviso', N'aprobo', N'leyo', N'capacito') AND LEN([reason]) >= 5);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'quality_check_result_ck')
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_result_ck]
    CHECK ([result] IN (N'conforme', N'no_conforme'));

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
  Datos del S2: los puntos de firma quedaron como «pendiente_s3». Los que aún
  esperan decisión pasan a «pendiente» (se firmarán con la firma propia); los
  que se decidieron en el S2 pasan a «sin_firma_s2» (se decidieron con la
  sesión, sin firma electrónica: se deja constancia, no se inventa una firma).
  Idempotente (solo toca filas con el valor viejo). Lote aparte: la columna
  id_signature debe existir antes de compilar este UPDATE.
*/
EXEC sp_executesql N'UPDATE [sgc].[task_assignee]
  SET signature_status = CASE WHEN status = N''pendiente'' THEN N''pendiente'' ELSE N''sin_firma_s2'' END
  WHERE signature_status = N''pendiente_s3'';';

/*
  Firmas, consentimientos, revisiones del borrador y listas de chequeo
  INMODIFICABLES: el trigger INSTEAD OF rechaza cualquier UPDATE o DELETE.
  El maestro de firmas no se borra y solo admite la REVOCACIÓN (las columnas
  del trazo, su hash, a quién pertenece y quién lo registró no cambian).
*/
IF OBJECT_ID(N'[sgc].[signature_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_solo_insercion]
ON [sgc].[signature]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51003, N''sgc.signature es de solo inserción: una firma electrónica no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_consent_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_consent_solo_insercion]
ON [sgc].[signature_consent]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51004, N''sgc.signature_consent es de solo inserción: la aceptación del consentimiento no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[draft_revision_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[draft_revision_solo_insercion]
ON [sgc].[draft_revision]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51005, N''sgc.draft_revision es de solo inserción: cada guardado del borrador es una revisión nueva.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[quality_check_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[quality_check_solo_insercion]
ON [sgc].[quality_check]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51006, N''sgc.quality_check es de solo inserción: la lista de chequeo de Calidad no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_master_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_sin_borrado]
ON [sgc].[signature_master]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51007, N''sgc.signature_master no se borra: una firma registrada se revoca con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_master_solo_revocacion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_solo_revocacion]
ON [sgc].[signature_master]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(image_png) OR UPDATE(image_sha256) OR UPDATE(user_email) OR UPDATE(id_company) OR UPDATE(version_number) OR UPDATE(registered_by) OR UPDATE(registered_at) OR UPDATE(reason)
     OR EXISTS (SELECT 1 FROM deleted d WHERE d.revoked_at IS NOT NULL)
    THROW 51008, N''sgc.signature_master solo admite revocar una firma vigente (una vez); el trazo registrado no cambia.'', 1;
END;';
GO
/* GUARDIA · prisma/migrations/20261001000000_sgc_s4_divulgacion_capacitacion_vigencia/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261001000000_sgc_s4_divulgacion_capacitacion_vigencia/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261001100000_sgc_s5_relaciones_vencimientos_accesos/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261001100000_sgc_s5_relaciones_vencimientos_accesos/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261001200000_sgc_s6_endurecimiento/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261001200000_sgc_s6_endurecimiento/migration.sql ===== */
/*
  Migración: sgc_s6_endurecimiento
  SGC documental — Sprint 6 (endurecimiento, validación y preparación para
  producción), 2026-10-01.

  Qué agrega (100 % ADITIVA, solo objetos del esquema `sgc` y un trigger de
  base de datos que SOLO actúa sobre `sgc`; no toca ninguna tabla de `dbo`):

    1. Índices de rendimiento (revisión del S6):
       - [sgc].[audit_log] (actor_email, action, occurred_at): el conteo de
         intentos de reautenticación fallidos en cada firma recorría la tabla.
       - [sgc].[request] (id_document, status): solicitudes abiertas de un
         documento, calendario e iCal.
       - [sgc].[review_alert] (id_document_version, alert_key): job de avisos.

    2. Cadena de firmas única en la base: dos firmas de la misma empresa no
       pueden colgar del mismo registro anterior (ni haber dos «génesis»).
       Hoy lo garantiza el bloqueo de la aplicación; ahora también la base.

    3. [sgc].[proteccion_registros]: tabla SIEMPRE VACÍA (CHECK 1 = 0) con
       claves foráneas hacia los registros de solo inserción. SQL Server no
       permite TRUNCATE ni DROP de una tabla referenciada por una clave
       foránea: así un TRUNCATE o DROP «por accidente» de la auditoría, las
       firmas o el historial falla aunque lo intente un administrador de la
       base (los triggers de solo inserción no ven el TRUNCATE ni el DROP).

    4. [sgc].[ddl_event_log] (solo inserción) y el trigger de base de datos
       [sgc_proteger_esquema]: todo cambio de estructura sobre `sgc` queda
       registrado (quién, desde dónde, qué sentencia, cuándo) y los cambios
       destructivos (DROP/ALTER de tablas, triggers e índices, RENAME,
       transferencia de esquema) se RECHAZAN salvo que la sesión declare el
       cambio controlado:
           EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
           EXEC sp_set_session_context N'sgc_ddl_motivo', N'<control de cambios>';
       El mantenimiento de índices (ALTER INDEX) y las estadísticas siguen
       permitidos (se registran).

  LÍMITE HONESTO (documentado en el paquete de validación, probado en PRUEBAS):
  un usuario con permisos de dueño de la base (db_owner/sysadmin) puede QUITAR
  (DROP TRIGGER ... ON DATABASE) o deshabilitar (DISABLE TRIGGER) el trigger
  de base de datos y deshabilitar los triggers de tabla: SQL Server no deja
  que un trigger impida su propia eliminación ni reporta DISABLE TRIGGER como
  evento DDL. Lo que NO puede hacer sin dejar rastro es TRUNCATE o DROP de los
  registros (la tabla de protección lo impide con claves foráneas). Eso solo se cierra con permisos:
  la aplicación debe conectarse con un usuario SIN privilegios de DDL
  (solicitud a infraestructura) y la verificación periódica de integridad
  revisa que ningún trigger del SGC esté deshabilitado.

  ⚠️ ORDEN DEL PASE: va ANTES que el código. Idempotente: cada bloque verifica
  si el objeto existe. Las reversas de S1–S5 deben correr DESPUÉS de la
  reversa de este sprint (o declarar el cambio controlado como arriba).

  REVERSA: prisma/manual/2026-10-01-sgc-s6-endurecimiento-reversa.sql
*/

-- Esta misma migración es un cambio controlado del esquema `sgc`.
EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261001200000_sgc_s6_endurecimiento (Sprint 6)';

BEGIN TRY

BEGIN TRAN;

/* 1. Índices de rendimiento. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_audit_log_actor_email_action_occurred_at' AND object_id = OBJECT_ID(N'[sgc].[audit_log]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_audit_log_actor_email_action_occurred_at] ON [sgc].[audit_log]([actor_email], [action], [occurred_at]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_request_id_document_status' AND object_id = OBJECT_ID(N'[sgc].[request]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_request_id_document_status] ON [sgc].[request]([id_document], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_review_alert_id_document_version_alert_key' AND object_id = OBJECT_ID(N'[sgc].[review_alert]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_review_alert_id_document_version_alert_key] ON [sgc].[review_alert]([id_document_version], [alert_key]);

/* 3. Tabla de protección contra TRUNCATE/DROP (siempre vacía). */
IF OBJECT_ID(N'[sgc].[proteccion_registros]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[proteccion_registros] (
      [id] INT NOT NULL,
      [id_audit_log] BIGINT NULL,
      [id_config_change] BIGINT NULL,
      [id_interaction] BIGINT NULL,
      [id_signature] INT NULL,
      [id_signature_consent] INT NULL,
      [id_quality_check] INT NULL,
      [id_draft_revision] INT NULL,
      [id_training_upload] INT NULL,
      [id_training_result] INT NULL,
      [id_review_alert] INT NULL,
      CONSTRAINT [proteccion_registros_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [proteccion_registros_siempre_vacia_ck] CHECK (1 = 0),
      CONSTRAINT [proteccion_registros_audit_log_fk] FOREIGN KEY ([id_audit_log]) REFERENCES [sgc].[audit_log]([id_audit_log]),
      CONSTRAINT [proteccion_registros_config_change_log_fk] FOREIGN KEY ([id_config_change]) REFERENCES [sgc].[config_change_log]([id_config_change]),
      CONSTRAINT [proteccion_registros_interaction_fk] FOREIGN KEY ([id_interaction]) REFERENCES [sgc].[interaction]([id_interaction]),
      CONSTRAINT [proteccion_registros_signature_fk] FOREIGN KEY ([id_signature]) REFERENCES [sgc].[signature]([id_signature]),
      CONSTRAINT [proteccion_registros_signature_consent_fk] FOREIGN KEY ([id_signature_consent]) REFERENCES [sgc].[signature_consent]([id_signature_consent]),
      CONSTRAINT [proteccion_registros_quality_check_fk] FOREIGN KEY ([id_quality_check]) REFERENCES [sgc].[quality_check]([id_quality_check]),
      CONSTRAINT [proteccion_registros_draft_revision_fk] FOREIGN KEY ([id_draft_revision]) REFERENCES [sgc].[draft_revision]([id_draft_revision]),
      CONSTRAINT [proteccion_registros_training_upload_fk] FOREIGN KEY ([id_training_upload]) REFERENCES [sgc].[training_upload]([id_training_upload]),
      CONSTRAINT [proteccion_registros_training_result_fk] FOREIGN KEY ([id_training_result]) REFERENCES [sgc].[training_result]([id_training_result]),
      CONSTRAINT [proteccion_registros_review_alert_fk] FOREIGN KEY ([id_review_alert]) REFERENCES [sgc].[review_alert]([id_review_alert])
  );
END;

/* 4. Registro de cambios de estructura del esquema sgc (solo inserción). */
IF OBJECT_ID(N'[sgc].[ddl_event_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[ddl_event_log] (
      [id_ddl_event] BIGINT NOT NULL IDENTITY(1,1),
      [event_type] NVARCHAR(100) NOT NULL,
      [object_type] NVARCHAR(100) NULL,
      [object_name] NVARCHAR(256) NULL,
      [target_object] NVARCHAR(256) NULL,
      [login_name] NVARCHAR(256) NULL,
      [host_name] NVARCHAR(256) NULL,
      [app_name] NVARCHAR(256) NULL,
      [authorized] BIT NOT NULL,
      [motivo] NVARCHAR(400) NULL,
      [tsql] NVARCHAR(MAX) NULL,
      [occurred_at] DATETIME2 NOT NULL CONSTRAINT [ddl_event_log_occurred_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [ddl_event_log_pkey] PRIMARY KEY CLUSTERED ([id_ddl_event])
  );
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

/* 2. Cadena de firmas única (índices únicos filtrados). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_prev_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [signature_cadena_prev_uq] ON [sgc].[signature]([id_company], [prev_record_hash]) WHERE [prev_record_hash] IS NOT NULL;';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_genesis_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [signature_cadena_genesis_uq] ON [sgc].[signature]([id_company]) WHERE [prev_record_hash] IS NULL;';

/* El registro de cambios de estructura no se modifica ni se borra. */
IF OBJECT_ID(N'[sgc].[ddl_event_log_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[ddl_event_log_solo_insercion]
ON [sgc].[ddl_event_log]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51040, N''sgc.ddl_event_log es de solo inserción: no se modifica ni se borra.'', 1;
END;';

-- [solo-base-real-inicio] (la restauración en un esquema temporal omite este bloque)
/*
  Trigger de BASE DE DATOS: solo mira eventos del esquema `sgc`. Para todo lo
  demás (dbo y otros esquemas) sale de inmediato sin hacer nada.
*/
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'sgc_proteger_esquema' AND parent_class = 0)
  EXEC sp_executesql N'CREATE TRIGGER [sgc_proteger_esquema]
ON DATABASE
FOR DDL_DATABASE_LEVEL_EVENTS
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @e XML = EVENTDATA();
  DECLARE @schema SYSNAME = @e.value(''(/EVENT_INSTANCE/SchemaName)[1]'', ''sysname'');
  DECLARE @otype NVARCHAR(100) = @e.value(''(/EVENT_INSTANCE/ObjectType)[1]'', ''nvarchar(100)'');
  DECLARE @oname NVARCHAR(256) = @e.value(''(/EVENT_INSTANCE/ObjectName)[1]'', ''nvarchar(256)'');
  -- Solo eventos del esquema sgc o sobre el propio esquema. (Un trigger de base de datos no puede
  -- impedir que lo quiten o deshabiliten: eso lo cubren los permisos y la verificación periódica.)
  IF NOT (@schema = N''sgc'' OR (@otype = N''SCHEMA'' AND @oname = N''sgc'')) RETURN;

  DECLARE @event NVARCHAR(100) = @e.value(''(/EVENT_INSTANCE/EventType)[1]'', ''nvarchar(100)'');
  DECLARE @ok BIT = CASE WHEN TRY_CAST(SESSION_CONTEXT(N''sgc_ddl_autorizado'') AS INT) = 1 THEN 1 ELSE 0 END;

  IF @ok = 0 AND @event IN (N''DROP_TABLE'', N''ALTER_TABLE'', N''DROP_TRIGGER'', N''ALTER_TRIGGER'', N''DROP_INDEX'', N''DROP_SCHEMA'', N''ALTER_SCHEMA'', N''RENAME'', N''DROP_VIEW'', N''DROP_PROCEDURE'', N''DROP_FUNCTION'')
  BEGIN
    ROLLBACK;
    THROW 51041, N''Cambio de estructura del esquema sgc (sistema validado) RECHAZADO: requiere control de cambios. Declare la sesión con sp_set_session_context N''''sgc_ddl_autorizado'''', 1 y el motivo.'', 1;
  END;

  IF OBJECT_ID(N''[sgc].[ddl_event_log]'', N''U'') IS NOT NULL
    INSERT INTO [sgc].[ddl_event_log] ([event_type], [object_type], [object_name], [target_object], [login_name], [host_name], [app_name], [authorized], [motivo], [tsql])
    VALUES (@event, @otype, @oname,
            @e.value(''(/EVENT_INSTANCE/TargetObjectName)[1]'', ''nvarchar(256)''),
            ORIGINAL_LOGIN(), HOST_NAME(), APP_NAME(), @ok,
            LEFT(CAST(SESSION_CONTEXT(N''sgc_ddl_motivo'') AS NVARCHAR(400)), 400),
            @e.value(''(/EVENT_INSTANCE/TSQLCommand/CommandText)[1]'', ''nvarchar(max)''));
END;';
-- [solo-base-real-fin]

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
GO
/* GUARDIA · prisma/migrations/20261003120000_sgc_correcciones_calidad/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261003120000_sgc_correcciones_calidad/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261008100000_sgc_s8_encabezado_listado_maestro/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008100000_sgc_s8_encabezado_listado_maestro/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261008110000_sgc_s9_archivos_relaciones_correo/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008110000_sgc_s9_archivos_relaciones_correo/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261008120000_sgc_s10_capacitacion_opcional/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008120000_sgc_s10_capacitacion_opcional/migration.sql ===== */
/*
  Migración: sgc_s10_capacitacion_opcional
  SGC documental — Sprint 10 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): capacitación OPCIONAL por solicitud y
  configurada ANTES de la divulgación, evaluación solo en Microsoft Forms o
  Google Forms, 2 intentos y recapacitación.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[request]: requires_training_suggested (lo sugiere el
        solicitante), requires_training (lo confirma quien crea el documento o
        Calidad), training_confirmed_by y training_confirmed_at. NULL = como
        hasta hoy (manda el tipo documental): las solicitudes en curso no cambian.
    - [sgc].[training]: evaluation_provider (microsoft | google) y
        max_attempts (2 por defecto, CHECK 1–5).
    - [sgc].[training_result]: attempt_number (intento que cuenta),
        extra_attempts (intentos de más, no cuentan) y retraining_required.
    - [sgc].[retraining]: recapacitación presencial o virtual que registra
        Calidad (SOLO INSERCIÓN).
  El flujo nuevo (preparación de la capacitación antes de la divulgación) es
  un DATO: prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 9 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008120000_sgc_s10_capacitacion_opcional (Sprint 10)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.request', N'requires_training_suggested') IS NULL
  ALTER TABLE [sgc].[request] ADD [requires_training_suggested] BIT NULL;
IF COL_LENGTH(N'sgc.request', N'requires_training') IS NULL
  ALTER TABLE [sgc].[request] ADD [requires_training] BIT NULL;
IF COL_LENGTH(N'sgc.request', N'training_confirmed_by') IS NULL
  ALTER TABLE [sgc].[request] ADD [training_confirmed_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.request', N'training_confirmed_at') IS NULL
  ALTER TABLE [sgc].[request] ADD [training_confirmed_at] DATETIME2 NULL;

IF COL_LENGTH(N'sgc.training', N'evaluation_provider') IS NULL
  ALTER TABLE [sgc].[training] ADD [evaluation_provider] NVARCHAR(20) NULL;
IF COL_LENGTH(N'sgc.training', N'max_attempts') IS NULL
  ALTER TABLE [sgc].[training] ADD [max_attempts] INT NOT NULL CONSTRAINT [training_max_attempts_df] DEFAULT 2;

IF COL_LENGTH(N'sgc.training_result', N'attempt_number') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [attempt_number] INT NULL;
IF COL_LENGTH(N'sgc.training_result', N'extra_attempts') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [extra_attempts] INT NOT NULL CONSTRAINT [training_result_extra_attempts_df] DEFAULT 0;
IF COL_LENGTH(N'sgc.training_result', N'retraining_required') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [retraining_required] BIT NOT NULL CONSTRAINT [training_result_retraining_required_df] DEFAULT 0;

IF OBJECT_ID(N'[sgc].[retraining]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[retraining] (
      [id_retraining] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_training] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [mode] NVARCHAR(20) NOT NULL,
      [session_date] DATE NOT NULL,
      [result] NVARCHAR(20) NOT NULL,
      [notes] NVARCHAR(1000) NULL,
      [registered_by] NVARCHAR(255) NOT NULL,
      [registered_at] DATETIME2 NOT NULL,
      CONSTRAINT [retraining_pkey] PRIMARY KEY CLUSTERED ([id_retraining]),
      CONSTRAINT [retraining_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [retraining_id_training_fkey] FOREIGN KEY ([id_training]) REFERENCES [sgc].[training]([id_training]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [retraining_id_request_idx] ON [sgc].[retraining]([id_request]);
  CREATE NONCLUSTERED INDEX [retraining_user_email_idx] ON [sgc].[retraining]([user_email]);
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

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_intentos_proveedor_ck] CHECK ([max_attempts] BETWEEN 1 AND 5 AND ([evaluation_provider] IS NULL OR [evaluation_provider] IN (N''microsoft'', N''google'')));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'retraining_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[retraining] ADD CONSTRAINT [retraining_valores_ck] CHECK ([mode] IN (N''presencial'', N''virtual'') AND [result] IN (N''asistio'', N''aprobo'', N''reprobo''));';

IF OBJECT_ID(N'[sgc].[retraining_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[retraining_solo_insercion]
ON [sgc].[retraining]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51080, N''sgc.retraining es de solo inserción: la recapacitación registrada no se modifica ni se borra.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
GO
/* GUARDIA · prisma/migrations/20261008130000_sgc_s11_copias_no_controladas/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008130000_sgc_s11_copias_no_controladas/migration.sql ===== */
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
GO
/* GUARDIA · prisma/migrations/20261008140000_sgc_s12_aprobadores_sustitutos/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008140000_sgc_s12_aprobadores_sustitutos/migration.sql ===== */
/*
  Migración: sgc_s12_aprobadores_sustitutos
  SGC documental — Sprint 12 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): APROBADORES AUTORIZADOS y FIRMANTE SUSTITUTO.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[approver_authorization]: lista de aprobadores autorizados por
        persona y proceso (NULL = todos), con vigencia y motivo; la administra
        Aseguramiento de Calidad (decisión D9). NO SE BORRA: se revoca con motivo.
    - [sgc].[signer_substitution]: cada firmante sustituto asignado (cupo
        original y nuevo, titular y sustituto, motivo, periodo de ausencia,
        quién y cuándo). SOLO INSERCIÓN.
    - [sgc].[task_assignee].[on_behalf_of]: el cupo es de un sustituto que firma
        en nombre del titular.
    - [sgc].[signature].[on_behalf_of]: la firma quedó «en sustitución de»
        (entra al registro encadenado SOLO cuando hay sustitución: las firmas
        anteriores conservan su hash).
    - [sgc].[company_config].[approver_list_enforced] (1): con la lista activa,
        y solo cuando la empresa tiene al menos un aprobador autorizado, el
        servidor rechaza a un aprobador que no esté en la lista. Mientras
        Calidad no cargue la lista nada cambia.
  El tipo de autorización SGC-SUSTITUTOS (grupo exclusivo, decisión D8) es un
  DATO: prisma/manual/2026-10-08-sgc-s12-sustitutos-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 11 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008140000_sgc_s12_aprobadores_sustitutos (Sprint 12)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'approver_list_enforced') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [approver_list_enforced] BIT NOT NULL CONSTRAINT [company_config_approver_list_enforced_df] DEFAULT 1;
IF COL_LENGTH(N'sgc.task_assignee', N'on_behalf_of') IS NULL
  ALTER TABLE [sgc].[task_assignee] ADD [on_behalf_of] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.signature', N'on_behalf_of') IS NULL
  ALTER TABLE [sgc].[signature] ADD [on_behalf_of] NVARCHAR(255) NULL;

IF OBJECT_ID(N'[sgc].[approver_authorization]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[approver_authorization] (
      [id_approver_authorization] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [id_process_map] INT NULL,
      [valid_from] DATE NOT NULL,
      [valid_to] DATE NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [granted_by] NVARCHAR(255) NOT NULL,
      [granted_at] DATETIME2 NOT NULL,
      [revoked_by] NVARCHAR(255) NULL,
      [revoked_at] DATETIME2 NULL,
      [revoke_reason] NVARCHAR(1000) NULL,
      CONSTRAINT [approver_authorization_pkey] PRIMARY KEY CLUSTERED ([id_approver_authorization]),
      CONSTRAINT [approver_authorization_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [approver_authorization_id_process_map_fkey] FOREIGN KEY ([id_process_map]) REFERENCES [sgc].[process_map]([id_process_map]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [approver_authorization_id_company_user_email_idx] ON [sgc].[approver_authorization]([id_company], [user_email]);
END;

IF OBJECT_ID(N'[sgc].[signer_substitution]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signer_substitution] (
      [id_signer_substitution] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [step_key] NVARCHAR(40) NOT NULL,
      [id_task_assignee_original] INT NOT NULL,
      [id_task_assignee_new] INT NOT NULL,
      [original_email] NVARCHAR(255) NOT NULL,
      [substitute_email] NVARCHAR(255) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [absence_from] DATE NULL,
      [absence_to] DATE NULL,
      [assigned_by] NVARCHAR(255) NOT NULL,
      [assigned_at] DATETIME2 NOT NULL,
      CONSTRAINT [signer_substitution_pkey] PRIMARY KEY CLUSTERED ([id_signer_substitution]),
      CONSTRAINT [signer_substitution_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [signer_substitution_id_request_idx] ON [sgc].[signer_substitution]([id_request]);
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

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'approver_authorization_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[approver_authorization] ADD CONSTRAINT [approver_authorization_valores_ck] CHECK (([valid_to] IS NULL OR [valid_to] >= [valid_from]) AND LEN([reason]) >= 5 AND (([revoked_at] IS NULL AND [revoked_by] IS NULL) OR ([revoked_at] IS NOT NULL AND [revoked_by] IS NOT NULL AND LEN([revoke_reason]) >= 5)));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signer_substitution_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[signer_substitution] ADD CONSTRAINT [signer_substitution_valores_ck] CHECK ([original_email] <> [substitute_email] AND LEN([reason]) >= 5 AND ([absence_to] IS NULL OR [absence_from] IS NULL OR [absence_to] >= [absence_from]));';

IF OBJECT_ID(N'[sgc].[approver_authorization_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[approver_authorization_sin_borrado]
ON [sgc].[approver_authorization]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51100, N''sgc.approver_authorization no se borra: una autorización de aprobador se revoca con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signer_substitution_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signer_substitution_solo_insercion]
ON [sgc].[signer_substitution]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51101, N''sgc.signer_substitution es de solo inserción: cada sustitución de firmante queda registrada.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
GO
/* GUARDIA · prisma/migrations/20261008150000_sgc_s13_firma_propia_registro/migration.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20261008150000_sgc_s13_firma_propia_registro/migration.sql ===== */
/*
  Migración: sgc_s13_firma_propia_registro
  SGC documental — Sprint 13 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): FIRMA PROPIA con validación de Calidad (R13).
  El «Registro de firmas» (R14) no necesita cambios de base de datos.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[signature_master]: origin (calidad | propia), capture_method
        (dibujada | imagen), validation_status (validada | pendiente),
        validated_by, validated_at. Las firmas ya registradas quedan
        «calidad» y «validada» (siguen firmando igual).
    - Trigger [signature_master_validacion_una_vez]: el origen y el método no
        cambian; solo una firma PENDIENTE pasa a «validada», una vez.
    - [sgc].[company_config].[self_signature_enabled] = 0: la firma propia
        queda APAGADA. Encenderla requiere el aval de la Dra. Adriana Cárdenas
        (memoria firmas-validez-sgc-y-regulatorio); no hay SQL que la encienda.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 12 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s13-firma-propia-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008150000_sgc_s13_firma_propia_registro (Sprint 13)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.signature_master', N'origin') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [origin] NVARCHAR(20) NOT NULL CONSTRAINT [signature_master_origin_df] DEFAULT N'calidad';
IF COL_LENGTH(N'sgc.signature_master', N'capture_method') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [capture_method] NVARCHAR(20) NULL;
IF COL_LENGTH(N'sgc.signature_master', N'validation_status') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validation_status] NVARCHAR(20) NOT NULL CONSTRAINT [signature_master_validation_status_df] DEFAULT N'validada';
IF COL_LENGTH(N'sgc.signature_master', N'validated_by') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validated_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.signature_master', N'validated_at') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validated_at] DATETIME2 NULL;
IF COL_LENGTH(N'sgc.company_config', N'self_signature_enabled') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [self_signature_enabled] BIT NOT NULL CONSTRAINT [company_config_self_signature_enabled_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signature_master_firma_propia_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[signature_master] ADD CONSTRAINT [signature_master_firma_propia_ck] CHECK ([origin] IN (N''calidad'', N''propia'') AND ([capture_method] IS NULL OR [capture_method] IN (N''dibujada'', N''imagen'')) AND [validation_status] IN (N''validada'', N''pendiente'') AND ([validation_status] = N''pendiente'' OR [origin] = N''calidad'' OR ([validated_by] IS NOT NULL AND [validated_at] IS NOT NULL)) AND ([origin] = N''calidad'' OR [validated_by] IS NULL OR [validated_by] <> [user_email]));';

IF OBJECT_ID(N'[sgc].[signature_master_validacion_una_vez]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_validacion_una_vez]
ON [sgc].[signature_master]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(origin) OR UPDATE(capture_method)
     OR ((UPDATE(validation_status) OR UPDATE(validated_by) OR UPDATE(validated_at))
         AND EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.id_signature_master = d.id_signature_master
                     WHERE d.validation_status <> N''pendiente'' OR i.validation_status <> N''validada''))
    THROW 51110, N''sgc.signature_master: el origen y el método no cambian; solo una firma PENDIENTE se valida, una vez.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
GO
/* GUARDIA · verificacion-F1 */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== verificacion-F1 ===== */
DECLARE @t INT = (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = N'sgc');
DECLARE @tr BIT = (SELECT is_disabled FROM sys.triggers WHERE parent_class = 0 AND name = N'sgc_proteger_esquema');
SELECT @t AS tablas_sgc, @tr AS trigger_deshabilitado;
IF @t <> 56 OR @tr IS NULL OR @tr = 1 THROW 50901, N'F1 incompleta: se esperaban 56 tablas en sgc y el trigger sgc_proteger_esquema habilitado.', 1;
GO
