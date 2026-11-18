/*
  PASE MANUAL (PROD) — Tarea «Plantilla de documento» en los flujos de solicitudes. 2026-11-18.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).
  Pedido: Nicolás Rivera, proyecto «Proyecto de contratos mindry» (2026-11-18).

  QUÉ HACE (idempotente; solo agrega, no borra ni modifica datos existentes):
    1. task_process_category.task_kind admite además 'doc_template'.
    2. dbo.task_doc_template: configuración de la plantilla de cada tarea (motor editor|word,
       origen upload|sgc, HTML o Word fuente, campos @ mapeados, salida, modo auto|revisar).
    3. dbo.request_generated_document: documentos generados por solicitud (versiones, archivos
       en OneDrive, huella SHA-256, estado emitido|anulado).

  REVERSA: prisma/manual/2026-11-18-tarea-plantilla-documento-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51491, N'Base no esperada: este script es solo para KRONOSDB.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_task_process_category_task_kind'
             AND definition NOT LIKE N'%doc_template%')
  BEGIN
    ALTER TABLE [dbo].[task_process_category] DROP CONSTRAINT [CK_task_process_category_task_kind];
    EXEC (N'ALTER TABLE [dbo].[task_process_category] ADD CONSTRAINT [CK_task_process_category_task_kind]
           CHECK ([task_kind] IN (N''normal'', N''authorization'', N''sap_executor'', N''doc_template''));');
  END

  IF OBJECT_ID(N'dbo.task_doc_template', N'U') IS NULL
    CREATE TABLE [dbo].[task_doc_template] (
      [id]                INT IDENTITY(1,1) NOT NULL,
      [id_task]           INT            NOT NULL,   -- task_process_category.id (plantilla de tarea)
      [engine]            NVARCHAR(10)   NOT NULL,   -- editor | word
      [source]            NVARCHAR(10)   NOT NULL,   -- upload | sgc
      [id_sgc_document]   INT            NULL,       -- SgcDocument.id (origen SGC; siempre vigente)
      [id_sgc_version]    INT            NULL,       -- versión del SGC con la que se configuró
      [source_item_id]    NVARCHAR(200)  NULL,       -- OneDrive: Word fuente (subido o copiado del SGC)
      [source_file_name]  NVARCHAR(260)  NULL,
      [template_html]     NVARCHAR(MAX)  NULL,       -- motor editor: HTML con marcas {{CAMPO_FLUJO:…}}
      [fields_json]       NVARCHAR(MAX)  NULL,       -- marcas → id_form_field o variable del sistema
      [output]            NVARCHAR(10)   NOT NULL CONSTRAINT [task_doc_template_output_df] DEFAULT N'pdf',
      [mode]              NVARCHAR(10)   NOT NULL CONSTRAINT [task_doc_template_mode_df] DEFAULT N'auto',
      [file_name_pattern] NVARCHAR(200)  NULL,
      [active]            BIT            NOT NULL CONSTRAINT [task_doc_template_active_df] DEFAULT 1,
      [updated_by]        NVARCHAR(200)  NULL,
      [created_at]        DATETIME2      NOT NULL CONSTRAINT [task_doc_template_created_df] DEFAULT sysutcdatetime(),
      [updated_at]        DATETIME2      NOT NULL CONSTRAINT [task_doc_template_updated_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [task_doc_template_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [CK_task_doc_template_engine] CHECK ([engine] IN (N'editor', N'word')),
      CONSTRAINT [CK_task_doc_template_source] CHECK ([source] IN (N'upload', N'sgc')),
      CONSTRAINT [CK_task_doc_template_output] CHECK ([output] IN (N'pdf', N'pdf_docx')),
      CONSTRAINT [CK_task_doc_template_mode] CHECK ([mode] IN (N'auto', N'revisar')),
      CONSTRAINT [CK_task_doc_template_fields_json] CHECK ([fields_json] IS NULL OR ISJSON([fields_json]) = 1)
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_task_doc_template_task')
    CREATE UNIQUE NONCLUSTERED INDEX [UX_task_doc_template_task] ON [dbo].[task_doc_template]([id_task]);

  IF OBJECT_ID(N'dbo.request_generated_document', N'U') IS NULL
    CREATE TABLE [dbo].[request_generated_document] (
      [id]                 INT IDENTITY(1,1) NOT NULL,
      [id_request_general] INT            NOT NULL,
      [id_task_request]    INT            NULL,       -- task_request_general.id (instancia)
      [id_task]            INT            NOT NULL,   -- task_process_category.id (plantilla)
      [version]            INT            NOT NULL CONSTRAINT [request_generated_document_version_df] DEFAULT 1,
      [file_name]          NVARCHAR(260)  NOT NULL,
      [pdf_item_id]        NVARCHAR(200)  NULL,
      [docx_item_id]       NVARCHAR(200)  NULL,
      [html_snapshot]      NVARCHAR(MAX)  NULL,       -- motor editor: contenido emitido (para editar y reemitir)
      [pdf_sha256]         NVARCHAR(64)   NULL,
      [source_label]       NVARCHAR(400)  NULL,       -- p. ej. «FO-JUR-003 v2 (SGC)» o «Word subido: x.docx»
      [status]             NVARCHAR(10)   NOT NULL CONSTRAINT [request_generated_document_status_df] DEFAULT N'emitido',
      [generated_by]       NVARCHAR(200)  NULL,       -- correo, o «sistema» en modo automático
      [generated_at]       DATETIME2      NOT NULL CONSTRAINT [request_generated_document_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [request_generated_document_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [CK_request_generated_document_status] CHECK ([status] IN (N'emitido', N'anulado'))
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_request_generated_document_request')
    CREATE NONCLUSTERED INDEX [IX_request_generated_document_request] ON [dbo].[request_generated_document]([id_request_general], [id_task]);

  COMMIT TRANSACTION;
  PRINT N'OK: tarea Plantilla de documento lista en ' + DB_NAME();
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
