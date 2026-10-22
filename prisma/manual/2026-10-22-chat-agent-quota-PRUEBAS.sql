/*
  PASE MANUAL (PRUEBAS) — Medidor del consumo de Anthropic en Proyectos (2026-10-22).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261022120000_chat_agent_quota/migration.sql:
    la tabla NUEVA chat_agent_quota con sus dos CHECK.

  ORDEN: puede ir antes o después del código. Sin la tabla, POST /api/chat/agent/quota responde
  503 (el puente lo registra y sigue) y el medidor del proyecto simplemente no se pinta.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261022120000_chat_agent_quota
  REVERSA: prisma/manual/2026-10-22-chat-agent-quota-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51545, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- chat_agent_quota ------------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_agent_quota]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_quota] (
    [id_agent]       INT           NOT NULL,
    [utilization_7d] FLOAT(53)     NULL,
    [reset_7d]       DATETIME2     NULL,
    [utilization_5h] FLOAT(53)     NULL,
    [reset_5h]       DATETIME2     NULL,
    [overage]        NVARCHAR(40)  NULL,
    [measured_at]    DATETIME2     NOT NULL,
    [source]         NVARCHAR(20)  NOT NULL,
    [updated_at]     DATETIME2     NOT NULL,
    CONSTRAINT [chat_agent_quota_pkey] PRIMARY KEY CLUSTERED ([id_agent]),
    CONSTRAINT [chat_agent_quota_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_quota_fuente_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_quota] WITH CHECK ADD CONSTRAINT [chat_agent_quota_fuente_ck] CHECK ([source] IN (N''turno'', N''sonda''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_quota_rango_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_quota] WITH CHECK ADD CONSTRAINT [chat_agent_quota_rango_ck] CHECK (([utilization_7d] IS NULL OR ([utilization_7d] >= 0 AND [utilization_7d] <= 1000)) AND ([utilization_5h] IS NULL OR ([utilization_5h] >= 0 AND [utilization_5h] <= 1000)));');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.chat_agent_quota', N'U') AS chat_agent_quota;
