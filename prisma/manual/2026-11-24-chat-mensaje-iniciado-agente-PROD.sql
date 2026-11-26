/*
  PASE MANUAL (PROD) — Chat: mensajes que un asistente envía por iniciativa propia. 2026-11-24.
  Aprobado por Nicolás Rivera (SynerLink conv. 1, msgs 38807–38809).
  BASE: KRONOSDB (producción, serfarma05). El script se detiene en cualquier otra base.

  Correr ANTES de desplegar el código en producción (verificar-esquema.ps1 lo exige).

  QUÉ HACE: el DDL de prisma/migrations/20261124180000_chat_agent_initiated_message, nada más:
  crea dbo.chat_agent_initiated_message (una fila por mensaje que un asistente envió por su cuenta con la
  herramienta chat_enviar_mensaje_usuario del kronos-mcp: auditoría, topes diarios, insignia en la interfaz,
  contexto para el agente y aviso push una sola vez) con su FK a chat_message y tres índices.
  No toca chat_message ni su CHECK de event_type. No inserta filas. Aditivo e IDEMPOTENTE; informa antes y después.

  🔒 BLOQUEOS: no modifica tablas existentes; crear la FK hacia chat_message pide un bloqueo breve de
  esquema sobre chat_message (tabla que los puentes consultan cada segundo): espera a que terminen las
  lecturas en curso y se libera al confirmar (milisegundos).
  LOCK_TIMEOUT 5000: si no lo consigue en 5 s hace ROLLBACK; vuelva a correrlo. No afecta el login.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS.
  REVERSA: prisma/manual/2026-11-24-chat-mensaje-iniciado-agente-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 52402, N'Base no esperada para este script (PROD).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_agent_initiated_message;

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_message]', N'U') IS NULL
  THROW 52401, N'Missing table dbo.chat_message (migration 20260906120000_add_chat_agents). Apply it first.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_agent_initiated_message]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_initiated_message] (
    [id_message]           INT            NOT NULL,
    [id_conversation]      INT            NOT NULL,
    [id_agent]             INT            NOT NULL,
    [id_user]              NVARCHAR(1000) NOT NULL,
    [reason]               NVARCHAR(300)  NOT NULL,
    [requested_by]         NVARCHAR(120)  NOT NULL,
    [conversation_created] BIT            NOT NULL CONSTRAINT [chat_agent_initiated_message_conversation_created_df] DEFAULT 0,
    [push_sent_at]         DATETIME2      NULL,
    [created_at]           DATETIME2      NOT NULL CONSTRAINT [chat_agent_initiated_message_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_agent_initiated_message_pkey] PRIMARY KEY CLUSTERED ([id_message]),
    CONSTRAINT [chat_agent_initiated_message_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_agent_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_agent_idx] ON [dbo].[chat_agent_initiated_message]([id_agent], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_user_idx] ON [dbo].[chat_agent_initiated_message]([id_user], [created_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_agent_initiated_message_conversation_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_agent_initiated_message]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_agent_initiated_message_conversation_idx] ON [dbo].[chat_agent_initiated_message]([id_conversation], [id_message]);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;


SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_agent_initiated_message;
