/*
  Migration: BITÁCORA DE PROCESO — plant, personnel type and correction notes — 2026-11-26.

  Farmalógica meeting (Natalia Velandia, Tatiana Rico):
    1) dbo.ot_orden_trabajo.planta TINYINT NULL, CHECK (1, 2): «Planta 1 / Planta 2», chosen when
       opening, shown with text and colour so nobody records on the other plant's bitácora.
       NULL = bitácoras opened before this change.
    2) dbo.ot_operador.tipo NVARCHAR(20) NOT NULL DEFAULT 'OPERARIO', CHECK (OPERARIO,
       MANTENIMIENTO, INSPECTOR): personnel grouped by type when opening and in the Excel.
    3) dbo.ot_registro_nota: correction note on a record («toqué la actividad equivocada»).
       Records stay immutable; the note is INSERT-only (trigger blocks UPDATE/DELETE, never INSERT:
       Prisma inserts with OUTPUT without INTO).
  Purely ADDITIVE; old code keeps working. IDEMPOTENT. Run BY HAND (production is not baselined),
  first on KRONOSDB_PRUEBAS. Wrappers:
    prisma/manual/2026-11-26-bitacora-planta-tipo-notas-PRUEBAS.sql
    prisma/manual/2026-11-26-bitacora-planta-tipo-notas-PROD.sql
  REVERSAL: prisma/manual/2026-11-26-bitacora-planta-tipo-notas-reversa.sql
*/

SET XACT_ABORT ON;

IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta') IS NULL
BEGIN
  ALTER TABLE [dbo].[ot_orden_trabajo] ADD [planta] TINYINT NULL;
END;
IF OBJECT_ID(N'dbo.CK_ot_orden_trabajo_planta', N'C') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] WITH CHECK ADD CONSTRAINT [CK_ot_orden_trabajo_planta] CHECK ([planta] IS NULL OR [planta] IN (1, 2))');

IF COL_LENGTH(N'dbo.ot_operador', N'tipo') IS NULL
BEGIN
  ALTER TABLE [dbo].[ot_operador] ADD [tipo] NVARCHAR(20) NOT NULL CONSTRAINT [ot_operador_tipo_df] DEFAULT N'OPERARIO';
END;
IF OBJECT_ID(N'dbo.CK_ot_operador_tipo', N'C') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_operador] WITH CHECK ADD CONSTRAINT [CK_ot_operador_tipo] CHECK ([tipo] IN (N''OPERARIO'', N''MANTENIMIENTO'', N''INSPECTOR''))');

IF OBJECT_ID(N'dbo.ot_registro_nota', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ot_registro_nota] (
    [id_nota]          INT           IDENTITY(1,1) NOT NULL,
    [id_registro]      BIGINT        NOT NULL,
    [id_orden_trabajo] INT           NOT NULL,
    [texto]            NVARCHAR(500) NOT NULL,
    [id_user]          NVARCHAR(50)  NOT NULL,
    [creada_en]        DATETIME2     NOT NULL CONSTRAINT [ot_registro_nota_creada_en_df] DEFAULT SYSUTCDATETIME(),
    [ip]               NVARCHAR(64)  NULL,
    CONSTRAINT [ot_registro_nota_pkey] PRIMARY KEY CLUSTERED ([id_nota]),
    CONSTRAINT [ot_registro_nota_id_registro_fkey] FOREIGN KEY ([id_registro]) REFERENCES [dbo].[ot_registro]([id_registro]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [ot_registro_nota_id_orden_trabajo_fkey] FOREIGN KEY ([id_orden_trabajo]) REFERENCES [dbo].[ot_orden_trabajo]([id_orden_trabajo]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE INDEX [IX_ot_registro_nota_orden] ON [dbo].[ot_registro_nota]([id_orden_trabajo], [creada_en]);
END;

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_registro_nota_inmutable] ON [dbo].[ot_registro_nota]
  AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51320, N''Las notas de la bitácora no se pueden editar ni borrar (ALCOA+).'', 1;
END');
