/*
  PASE MANUAL (PRUEBAS) — Contexto de la sesión de los agentes y orden «Limpiar contexto» (2026-10-29).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ninguna tabla existente):
    - dbo.chat_agent_context  la ÚLTIMA foto del contexto de cada sesión de cada agente
                              (tokens, ventana, %). Una fila por (agente, sesión): 'principal'
                              para un bot de Claude Code; una por conversación en openclaw.
    - dbo.chat_agent_command  las órdenes «limpiar contexto»: quién la pidió (correo, IP,
                              navegador), cuándo, quién la ejecutó y cómo terminó. Es el registro
                              de auditoría; además cada orden queda en la hoja de vida del agente.
                              Índice único filtrado: una sola orden activa por agente.

  Sin modelo Prisma (lib/chat/agent-context-store.ts usa withMssqlPool): NO cambia schema.prisma
  ni exige prisma generate. Sin las tablas, el widget no muestra el contexto y los endpoints del
  agente responden 503 (el ejecutor lo registra y espera).

  ORDEN: puede ir antes o después del código.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes.
  REVERSA: prisma/manual/2026-10-29-chat-agent-contexto-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51561, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- chat_agent_context ------------------------------------------------ */
IF OBJECT_ID(N'[dbo].[chat_agent_context]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_context] (
    [id_agent]        INT            NOT NULL,
    [session_key]     NVARCHAR(160)  NOT NULL,   -- 'principal' (bot Claude Code) o la clave de la sesión openclaw
    [runtime]         NVARCHAR(20)   NOT NULL,   -- 'claude-code' | 'openclaw' | 'puente'
    [id_conversation] INT            NULL,       -- NULL en 'principal'; la conversación en openclaw
    [session_id]      NVARCHAR(120)  NULL,
    [model]           NVARCHAR(120)  NULL,
    [context_tokens]  INT            NULL,
    [context_window]  INT            NULL,
    [context_pct]     DECIMAL(5,2)   NULL,
    [measured_at]     DATETIME2(0)   NOT NULL,
    [updated_at]      DATETIME2(0)   NOT NULL,
    CONSTRAINT [chat_agent_context_pkey] PRIMARY KEY CLUSTERED ([id_agent], [session_key]),
    CONSTRAINT [chat_agent_context_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_context_runtime_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_context] WITH CHECK ADD CONSTRAINT [chat_agent_context_runtime_ck] CHECK ([runtime] IN (N''claude-code'', N''openclaw'', N''puente''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_context_pct_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_context] WITH CHECK ADD CONSTRAINT [chat_agent_context_pct_ck] CHECK ([context_pct] IS NULL OR ([context_pct] >= 0 AND [context_pct] <= 100));');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chat_agent_context_conversacion' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_context]'))
  CREATE NONCLUSTERED INDEX [IX_chat_agent_context_conversacion] ON [dbo].[chat_agent_context] ([id_agent], [id_conversation]);

/* ---- chat_agent_command ------------------------------------------------ */
IF OBJECT_ID(N'[dbo].[chat_agent_command]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_command] (
    [id_command]      INT            IDENTITY(1,1) NOT NULL,
    [id_agent]        INT            NOT NULL,
    [command]         NVARCHAR(30)   NOT NULL,   -- 'limpiar_contexto'
    [session_key]     NVARCHAR(160)  NOT NULL,
    [runtime]         NVARCHAR(20)   NOT NULL,
    [id_conversation] INT            NULL,
    [status]          NVARCHAR(16)   NOT NULL,   -- pendiente | en_curso | ok | ocupado | error | vencida
    [requested_by]    NVARCHAR(255)  NOT NULL,   -- correo de quien la pidió (auditoría)
    [requested_ip]    NVARCHAR(64)   NULL,
    [requested_ua]    NVARCHAR(300)  NULL,
    [requested_at]    DATETIME2(0)   NOT NULL,
    [taken_at]        DATETIME2(0)   NULL,
    [finished_at]     DATETIME2(0)   NULL,
    [result]          NVARCHAR(1000) NULL,
    [executor]        NVARCHAR(120)  NULL,
    CONSTRAINT [chat_agent_command_pkey] PRIMARY KEY CLUSTERED ([id_command]),
    CONSTRAINT [chat_agent_command_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_command_command_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_command] WITH CHECK ADD CONSTRAINT [chat_agent_command_command_ck] CHECK ([command] IN (N''limpiar_contexto''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_command_status_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_command] WITH CHECK ADD CONSTRAINT [chat_agent_command_status_ck] CHECK ([status] IN (N''pendiente'', N''en_curso'', N''ok'', N''ocupado'', N''error'', N''vencida''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_command_runtime_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_command] WITH CHECK ADD CONSTRAINT [chat_agent_command_runtime_ck] CHECK ([runtime] IN (N''claude-code'', N''openclaw'', N''puente''));');
/* Una sola orden ACTIVA por agente: dos administradores a la vez no la duplican. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_agent_command_activa' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_command]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [UX_chat_agent_command_activa] ON [dbo].[chat_agent_command] ([id_agent]) WHERE [status] IN (N''pendiente'', N''en_curso'');');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chat_agent_command_agente' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_command]'))
  CREATE NONCLUSTERED INDEX [IX_chat_agent_command_agente] ON [dbo].[chat_agent_command] ([id_agent], [id_command] DESC) INCLUDE ([status], [requested_at]);

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.chat_agent_context', N'U') AS chat_agent_context,
       OBJECT_ID(N'dbo.chat_agent_command', N'U') AS chat_agent_command;
