/*
  Migration: BITÁCORA DE PROCESO — reserved top margin for the batch header — 2026-11-23.

  SynerLink case #8316 (Farmalógica, Tatiana Rico): the printed Bitácora must not overlap the
  batch-record header that goes on every page of each lot.
    dbo.ot_config (id_company PK → company)
      margen_superior_mm INT NOT NULL DEFAULT 40   -- blank area at the top of every printed page
      updated_by NVARCHAR(50), updated_at DATETIME2 DEFAULT SYSUTCDATETIME()
  Purely ADDITIVE: a new table, no data changes. Without a row the report uses 40 mm (4 cm);
  the code also falls back to 40 mm while the table does not exist (it can ship before this).
  IDEMPOTENT. Run BY HAND (production is not baselined), first on KRONOSDB_PRUEBAS. Wrappers:
    prisma/manual/2026-11-23-bitacora-margen-batch-PRUEBAS.sql
    prisma/manual/2026-11-23-bitacora-margen-batch-PROD.sql
  REVERSAL: prisma/manual/2026-11-23-bitacora-margen-batch-reversa.sql
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_config', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ot_config] (
    [id_company]         INT           NOT NULL,
    [margen_superior_mm] INT           NOT NULL CONSTRAINT [ot_config_margen_superior_mm_df] DEFAULT 40,
    [updated_by]         NVARCHAR(50)  NOT NULL,
    [updated_at]         DATETIME2     NOT NULL CONSTRAINT [ot_config_updated_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ot_config_pkey] PRIMARY KEY CLUSTERED ([id_company]),
    CONSTRAINT [ot_config_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [CK_ot_config_margen_superior_mm] CHECK ([margen_superior_mm] BETWEEN 0 AND 120)
  );
END;
