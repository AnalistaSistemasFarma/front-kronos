/*
  Migración: add_organigrama_cargos
  Módulo Organigrama (SynerLink) — catálogo de cargos + jerarquía por empresa.

  ATENCIÓN: esta migración se generó MANUALMENTE (sin base de datos de
  desarrollo accesible en el entorno donde se creó). El SQL se extrajo
  verbatim de `prisma migrate diff --from-empty` y se recortó para incluir
  SOLO las tres tablas NUEVAS y sus llaves foráneas/índices. No contiene
  DROP ni ALTER sobre tablas existentes.

  Tablas creadas: cargo, cargo_alias, cargo_jerarquia.

  Para registrar esta migración como aplicada en una base que YA tiene las
  tablas (p.ej. tras aplicarlas a mano), use:
    npx prisma migrate resolve --applied 20260629000000_add_organigrama_cargos
*/

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[cargo] (
    [id_cargo] INT NOT NULL IDENTITY(1,1),
    [nombre_normalizado] NVARCHAR(1000) NOT NULL,
    [nivel] NVARCHAR(1000),
    [nivel_clasico] NVARCHAR(1000),
    [is_active] BIT NOT NULL CONSTRAINT [cargo_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [cargo_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cargo_pkey] PRIMARY KEY CLUSTERED ([id_cargo]),
    CONSTRAINT [cargo_nombre_normalizado_key] UNIQUE NONCLUSTERED ([nombre_normalizado])
);

-- CreateTable
CREATE TABLE [dbo].[cargo_alias] (
    [id_cargo_alias] INT NOT NULL IDENTITY(1,1),
    [id_cargo] INT NOT NULL,
    [alias] NVARCHAR(1000) NOT NULL,
    [id_company] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [cargo_alias_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cargo_alias_pkey] PRIMARY KEY CLUSTERED ([id_cargo_alias])
);

-- CreateTable
CREATE TABLE [dbo].[cargo_jerarquia] (
    [id_cargo_jerarquia] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_cargo] INT NOT NULL,
    [id_cargo_padre] INT,
    [aproximada] BIT NOT NULL CONSTRAINT [cargo_jerarquia_aproximada_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [cargo_jerarquia_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cargo_jerarquia_pkey] PRIMARY KEY CLUSTERED ([id_cargo_jerarquia]),
    CONSTRAINT [cargo_jerarquia_id_company_id_cargo_key] UNIQUE NONCLUSTERED ([id_company],[id_cargo])
);

-- AddForeignKey
ALTER TABLE [dbo].[cargo_alias] ADD CONSTRAINT [cargo_alias_id_cargo_fkey] FOREIGN KEY ([id_cargo]) REFERENCES [dbo].[cargo]([id_cargo]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[cargo_alias] ADD CONSTRAINT [cargo_alias_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cargo_jerarquia] ADD CONSTRAINT [cargo_jerarquia_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[cargo_jerarquia] ADD CONSTRAINT [cargo_jerarquia_id_cargo_fkey] FOREIGN KEY ([id_cargo]) REFERENCES [dbo].[cargo]([id_cargo]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cargo_jerarquia] ADD CONSTRAINT [cargo_jerarquia_id_cargo_padre_fkey] FOREIGN KEY ([id_cargo_padre]) REFERENCES [dbo].[cargo]([id_cargo]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
