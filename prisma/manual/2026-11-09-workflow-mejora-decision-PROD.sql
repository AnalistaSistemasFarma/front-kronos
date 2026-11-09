/*
  PASE MANUAL (PROD) — Flujos de trabajo: mejora continua (2026-11-09).
  Mismo bloque DDL de prisma/migrations/20261109150000_workflow_mejora_decision/migration.sql. NO lo corre el agente: con visto bueno de Nicolás y respaldo COPY_ONLY. Idempotente.
  REVERSA: 2026-11-09-workflow-mejora-decision-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51600, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;
SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[workflow_mejora_decision]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[workflow_mejora_decision] (
    [id_decision]          INT            IDENTITY(1,1) NOT NULL,
    [id_process_category]  INT            NOT NULL,
    [clave]                NVARCHAR(80)   NOT NULL,
    [estado]               NVARCHAR(20)   NOT NULL,
    [motivo]               NVARCHAR(1000) NULL,
    [titulo]               NVARCHAR(400)  NULL,
    [metrica_antes]        NVARCHAR(2000) NULL,
    [decided_by]           NVARCHAR(1000) NOT NULL,
    [decided_at]           DATETIME2      NOT NULL CONSTRAINT [workflow_mejora_decision_decided_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [workflow_mejora_decision_pkey] PRIMARY KEY CLUSTERED ([id_decision]),
    CONSTRAINT [workflow_mejora_decision_flujo_clave_key] UNIQUE NONCLUSTERED ([id_process_category], [clave])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'workflow_mejora_decision_estado_ck')
  EXEC(N'ALTER TABLE [dbo].[workflow_mejora_decision] WITH CHECK ADD CONSTRAINT [workflow_mejora_decision_estado_ck]
    CHECK ([estado] IN (N''aplicada'', N''descartada''));');

COMMIT TRAN;
