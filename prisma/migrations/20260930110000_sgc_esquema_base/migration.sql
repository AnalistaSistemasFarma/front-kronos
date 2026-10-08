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
