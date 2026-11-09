/*
  Flujos de trabajo — MEJORA CONTINUA (2026-11-09). Diseño: docs/flujos-mejora-continua.md.
  Idempotente. Una fila por (flujo, sugerencia): lo que decidió el responsable, quién y cuándo, y la
  cifra de la tarea en ese momento (para medir el antes y el después).
*/
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
