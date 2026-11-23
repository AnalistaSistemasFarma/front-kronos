/*
  PASE MANUAL (PROD) — Bitácora de Proceso: margen superior para el encabezado batch. 2026-11-23.
  Caso SynerLink #8316 (Farmalógica, Tatiana Rico).
  BASE: KRONOSDB (producción). El script se detiene en cualquier otra base.

  ⛔ NO CORRER sin el visto bueno explícito de Nicolás Rivera. ORDEN OBLIGATORIO en el pase:
  1) respaldo COPY_ONLY de KRONOSDB, 2) este script, 3) el código (schema.prisma agrega el modelo
  OtConfig: verificar-esquema detiene el cambio de color si la tabla no existe).
  El script SOLO CREA una tabla nueva: el código anterior sigue funcionando con ella.

  QUÉ HACE: el DDL de prisma/migrations/20261123180000_bitacora_proceso_margen_batch, nada más:
  crea dbo.ot_config (una fila por empresa; margen_superior_mm, DEFAULT 40 = 4 cm, CHECK 0..120).
  No inserta filas: sin fila, el informe usa 4 cm. Gestión lo cambia en Catálogo → Impresión.
  Aditivo e IDEMPOTENTE; informa antes y después.

  🔒 BLOQUEOS: crear una tabla nueva no bloquea tablas existentes (la FK a company pide un
  bloqueo breve de esquema). LOCK_TIMEOUT 5000: si no lo consigue en 5 s hace ROLLBACK; vuelva a correrlo.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS.
  REVERSA: prisma/manual/2026-11-23-bitacora-margen-batch-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51492, N'Base no esperada para este script (PROD).', 1;
IF OBJECT_ID(N'dbo.company', N'U') IS NULL
  THROW 51493, N'Falta la tabla dbo.company.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.ot_config', N'U') IS NULL THEN 0 ELSE 1 END AS existe_ot_config;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.ot_config', N'U') IS NULL
    CREATE TABLE [dbo].[ot_config] (
      [id_company]         INT           NOT NULL,
      [margen_superior_mm] INT           NOT NULL CONSTRAINT [ot_config_margen_superior_mm_df] DEFAULT 40,
      [updated_by]         NVARCHAR(50)  NOT NULL,
      [updated_at]         DATETIME2     NOT NULL CONSTRAINT [ot_config_updated_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [ot_config_pkey] PRIMARY KEY CLUSTERED ([id_company]),
      CONSTRAINT [ot_config_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [CK_ot_config_margen_superior_mm] CHECK ([margen_superior_mm] BETWEEN 0 AND 120)
    );
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.ot_config', N'U') IS NULL THEN 0 ELSE 1 END AS existe_ot_config;
