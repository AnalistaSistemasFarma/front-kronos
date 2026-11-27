/*
  PASE MANUAL (PRUEBAS) — Bitácora de Proceso: margen superior para el encabezado batch. 2026-11-23.
  Caso SynerLink #8316 (Farmalógica, Tatiana Rico).
  BASE: KRONOSDB_PRUEBAS (o la base efímera kronos_ci de la CI). El script se detiene en cualquier otra base.

  Correr ANTES de desplegar el código en pruebas (.230) (verificar-esquema compara schema.prisma con la base).

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

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51491, N'Base no esperada para este script (PRUEBAS).', 1;
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
