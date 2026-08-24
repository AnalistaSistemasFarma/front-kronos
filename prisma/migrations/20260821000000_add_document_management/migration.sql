/*
  Migración: add_document_management
  Módulo Gestión Documental (Fase 1) — infraestructura para la carga inicial
  histórica de documentos, directo en estado "Vigente" (sin flujo de
  aprobación todavía; eso es Fase 2, ver comentario en schema.prisma junto a
  estos modelos).

  ATENCIÓN: esta migración se generó MANUALMENTE (sin base de datos accesible
  en el entorno donde se creó), igual que 20260629000000_add_organigrama_cargos.
  El SQL se extrajo verbatim de:
    npx prisma migrate diff --from-schema-datamodel <schema SIN estos modelos> \
      --to-schema-datamodel <schema CON estos modelos> --script
  Solo contiene las tablas NUEVAS (document_type, document, document_version)
  y sus índices/llaves foráneas. No hay DROP ni ALTER sobre tablas existentes.

  Tablas creadas: document_type, document, document_version.

  Para registrar esta migración como aplicada en una base que YA tiene las
  tablas (p.ej. tras aplicarlas a mano), use:
    npx prisma migrate resolve --applied 20260821000000_add_document_management
*/

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[document_type] (
    [id_document_type] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(150) NOT NULL,
    [code_prefix] NVARCHAR(20) NOT NULL,
    [ggc_process] NVARCHAR(150),
    [is_active] BIT NOT NULL CONSTRAINT [document_type_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [document_type_pkey] PRIMARY KEY CLUSTERED ([id_document_type]),
    CONSTRAINT [document_type_code_prefix_key] UNIQUE NONCLUSTERED ([code_prefix])
);

-- CreateTable
CREATE TABLE [dbo].[document] (
    [id_document] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(50) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [id_document_type] INT NOT NULL,
    [id_company] INT NOT NULL,
    [id_process] INT,
    [owner_user_id] NVARCHAR(1000) NOT NULL,
    [due_review_date] DATETIME2,
    [is_restricted] BIT NOT NULL CONSTRAINT [document_is_restricted_df] DEFAULT 0,
    [current_status] NVARCHAR(30) NOT NULL CONSTRAINT [document_current_status_df] DEFAULT 'Vigente',
    [current_version_id] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [document_pkey] PRIMARY KEY CLUSTERED ([id_document]),
    CONSTRAINT [document_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
);

-- CreateTable
CREATE TABLE [dbo].[document_version] (
    [id_document_version] INT NOT NULL IDENTITY(1,1),
    [id_document] INT NOT NULL,
    [version_number] INT NOT NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [document_version_status_df] DEFAULT 'Vigente',
    [onedrive_item_id] NVARCHAR(300),
    [onedrive_path] NVARCHAR(1000) NOT NULL,
    [created_by] NVARCHAR(1000) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [comments] NVARCHAR(1000),
    CONSTRAINT [document_version_pkey] PRIMARY KEY CLUSTERED ([id_document_version]),
    CONSTRAINT [document_version_id_document_version_number_key] UNIQUE NONCLUSTERED ([id_document],[version_number])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [document_id_company_current_status_idx] ON [dbo].[document]([id_company], [current_status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [document_id_document_type_idx] ON [dbo].[document]([id_document_type]);

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [dbo].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_owner_user_id_fkey] FOREIGN KEY ([owner_user_id]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document_version] ADD CONSTRAINT [document_version_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [dbo].[document]([id_document]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
