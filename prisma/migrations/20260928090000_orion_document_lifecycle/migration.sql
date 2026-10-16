/*
  Migración: orion_document_lifecycle
  Hoja de vida de documentos Orion, validadores por flujo y el índice de documentos.

  - orion_document_event: cada evento del ciclo de vida (subida, validación,
    devolución, subversión, firmantes, firmas, firmado). También se envía a Orion.
  - validators_process_category: validadores en secuencia por flujo (p. ej.
    Jurídica). Si el flujo tiene validadores, el PDF debe aprobarse antes de
    habilitar "Para firmar".
  - orion_document_index: una fila por archivo (y su versión vigente) para
    listar/filtrar sin leer el JSON de request_form_value.
  - types_authorization "Validación de documento".

  ATENCIÓN: generada MANUALMENTE. Idempotente.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'orion_document_event')
BEGIN
  CREATE TABLE [dbo].[orion_document_event] (
    [id]                 BIGINT IDENTITY(1,1) NOT NULL,
    [id_request]         INT               NOT NULL,
    [file_id]            NVARCHAR(400)     NOT NULL,
    [orion_document_id]  NVARCHAR(200)     NULL,
    [version_label]      NVARCHAR(20)      NULL,
    [event_type]         NVARCHAR(60)      NOT NULL,
    [actor_email]        NVARCHAR(320)     NULL,
    [actor_name]         NVARCHAR(400)     NULL,
    [detail]             NVARCHAR(MAX)     NULL,
    [created_at]         DATETIME2         NOT NULL CONSTRAINT [DF_orion_document_event_created_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_orion_document_event] PRIMARY KEY CLUSTERED ([id] ASC)
  );

  CREATE NONCLUSTERED INDEX [IX_orion_document_event_file]
    ON [dbo].[orion_document_event] ([id_request], [file_id], [created_at]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'validators_process_category')
BEGIN
  CREATE TABLE [dbo].[validators_process_category] (
    [id]                   INT IDENTITY(1,1) NOT NULL,
    [id_validator]         NVARCHAR(1000)    NOT NULL,
    [id_process_category]  INT               NOT NULL,
    [sequence_order]       INT               NOT NULL,
    CONSTRAINT [PK_validators_process_category] PRIMARY KEY CLUSTERED ([id] ASC)
  );

  CREATE NONCLUSTERED INDEX [IX_validators_process_category_process]
    ON [dbo].[validators_process_category] ([id_process_category], [sequence_order]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'orion_document_index')
BEGIN
  CREATE TABLE [dbo].[orion_document_index] (
    [id]                  INT IDENTITY(1,1) NOT NULL,
    [id_request]          INT               NOT NULL,
    [file_id]             NVARCHAR(400)     NOT NULL,
    [file_name]           NVARCHAR(500)     NULL,
    [orion_document_id]   NVARCHAR(200)     NULL,
    [version_label]       NVARCHAR(20)      NULL,
    [status]              NVARCHAR(40)      NULL,
    [review_status]       NVARCHAR(40)      NULL,
    [id_company]          INT               NULL,
    [company_name]        NVARCHAR(400)     NULL,
    [department_name]     NVARCHAR(400)     NULL,
    [category_name]       NVARCHAR(400)     NULL,
    [process_name]        NVARCHAR(400)     NULL,
    [subject_request]     NVARCHAR(1000)    NULL,
    [signed_at]           DATETIME2         NULL,
    [created_at]          DATETIME2         NOT NULL CONSTRAINT [DF_orion_document_index_created_at] DEFAULT SYSUTCDATETIME(),
    [updated_at]          DATETIME2         NOT NULL CONSTRAINT [DF_orion_document_index_updated_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_orion_document_index] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [UQ_orion_document_index_file] UNIQUE ([id_request], [file_id])
  );

  CREATE NONCLUSTERED INDEX [IX_orion_document_index_company]
    ON [dbo].[orion_document_index] ([id_company], [department_name], [updated_at]);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM [dbo].[types_authorization]
  WHERE type_authorization = N'Validación de documento'
)
BEGIN
  INSERT INTO [dbo].[types_authorization] (type_authorization)
  VALUES (N'Validación de documento');
END
GO
