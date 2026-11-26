/*
  PASE MANUAL (PRUEBAS) — Bitácora de Proceso: planta, tipo de personal y notas de corrección. 2026-11-26.
  BASE: KRONOSDB_PRUEBAS. Correr ANTES de desplegar el código en pruebas (verificar-esquema).
  QUÉ HACE: el DDL de prisma/migrations/20261126150000_bitacora_proceso_planta_tipo_notas, nada más:
    ot_orden_trabajo.planta (TINYINT NULL, 1|2), ot_operador.tipo (DEFAULT 'OPERARIO') y la tabla
    ot_registro_nota (solo inserción). Aditivo e IDEMPOTENTE: el código anterior sigue funcionando.
    Después marca como INSPECTOR a los 6 inspectores de calidad de Farmalógica (si ya están en el maestro).
  🔒 BLOQUEOS: ALTER TABLE pide Sch-M un instante. Correr fuera de turno pico.
  REVERSA: prisma/manual/2026-11-26-bitacora-planta-tipo-notas-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51520, N'Base no esperada para este script (PRUEBAS).', 1;
GO

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

GO

SET NOCOUNT ON;
IF COL_LENGTH(N'dbo.ot_operador', N'tipo') IS NOT NULL
  EXEC (N'UPDATE dbo.ot_operador SET tipo = N''INSPECTOR'' WHERE id_company = 1 AND tipo = N''OPERARIO'' AND nombre IN (N''DEL SOL DILAN'', N''VELA PAULA'', N''ALVAREZ JUDY'', N''ORTIZ DIANA'', N''MERCADO KELLIS'', N''MATEUS JEIDY'')');
SELECT DB_NAME() AS base, 'después' AS momento,
       COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta') AS planta,
       COL_LENGTH(N'dbo.ot_operador', N'tipo') AS tipo,
       CASE WHEN OBJECT_ID(N'dbo.ot_registro_nota', N'U') IS NULL THEN 0 ELSE 1 END AS tabla_notas,
       CASE WHEN OBJECT_ID(N'dbo.TR_ot_registro_nota_inmutable', N'TR') IS NULL THEN 0 ELSE 1 END AS trigger_notas;
