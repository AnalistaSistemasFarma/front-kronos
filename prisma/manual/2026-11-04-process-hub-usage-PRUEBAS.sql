/*
  PASE MANUAL (PRUEBAS) — Orden de Procesos por recurrencia (2026-11-04).

  QUÉ ES: crea dbo.process_hub_usage, donde se cuenta cuánto abre cada persona cada acceso
  (subproceso) del hub de Procesos. Con eso las tarjetas que más usa quedan primero, igual en
  cualquier equipo. Una fila por persona y acceso.
    - score      puntos "con olvido": cada apertura suma 1 y lo anterior vale la mitad cada
                 30 días (lo calcula el código al guardar; HALF_LIFE_DAYS en lib/process/processUsage.ts).
    - open_count aperturas totales (solo informativo).
    - last_at    última apertura (UTC); el score vale en ese momento.

  ADITIVO e idempotente: solo crea la tabla nueva; no toca tablas existentes.
  ORDEN: este script y luego el código. Si el código sale antes, el hub ordena con la copia del
  navegador de cada persona (GET /api/processes/usage responde available=false).
  Sin modelo Prisma (lib/process/processUsageDb.ts usa withMssqlPool).
  REVERSA: prisma/manual/2026-11-04-process-hub-usage-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51611, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;
SET XACT_ABORT ON;

SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') AS process_hub_usage;

BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[process_hub_usage] (
    [id]            INT IDENTITY(1,1) NOT NULL,
    [id_user]       NVARCHAR(1000) NOT NULL,
    [id_subprocess] INT            NOT NULL,
    [score]         FLOAT          NOT NULL CONSTRAINT [DF_process_hub_usage_score] DEFAULT (0),
    [open_count]    INT            NOT NULL CONSTRAINT [DF_process_hub_usage_open_count] DEFAULT (0),
    [last_at]       DATETIME2(0)   NOT NULL CONSTRAINT [DF_process_hub_usage_last_at] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_process_hub_usage] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FK_process_hub_usage_user] FOREIGN KEY ([id_user])
      REFERENCES [dbo].[user] ([id]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [FK_process_hub_usage_subprocess] FOREIGN KEY ([id_subprocess])
      REFERENCES [dbo].[subprocess] ([id_subprocess]) ON DELETE CASCADE
  );
END;
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_process_hub_usage_user_subprocess' AND object_id = OBJECT_ID(N'[dbo].[process_hub_usage]')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [UQ_process_hub_usage_user_subprocess]
    ON [dbo].[process_hub_usage] ([id_user], [id_subprocess]);
END;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[process_hub_usage]', N'U') AS process_hub_usage;
