/*
  Migración: auditoria_agentes
  Auditoría del chat de agentes — origen de la conexión y consumo en tokens.

  Pedido de Nicolás (2026-09-10): "necesito que el conector de synerlink
  registre las conversaciones, esto por auditoría de permisos, si se puede
  también poner el consumo en tokens y la respuesta que dió el agente. Si se
  puede la ip de dónde enviaron el mensaje y la hora".

  QUÉ FALTABA DE VERDAD. Las conversaciones YA quedan registradas: `chat_message`
  guarda el texto del usuario y el del agente con su `created_at`. Lo que no
  quedaba en ninguna parte era (1) DESDE DÓNDE se escribió y (2) CUÁNTO costó
  atenderlo. Esta migración agrega solo eso.

  1. `chat_message.client_ip` / `.user_agent` — origen de la petición. Se llenan
     únicamente en los mensajes de personas: los del agente entran por la API
     con su llave, sin navegador. La IP sale de la cabecera `x-forwarded-for`
     que pone el proxy de IIS (ARR) delante de la aplicación; si no llega, queda
     NULL, que es lo honesto. Ver lib/chat/client-origin.ts.

  2. `chat_agent_turn_usage` — consumo en tokens por turno. NO lo puede escribir
     la aplicación: los tokens los informa la API del modelo al proceso del
     agente, que los tiene en la bitácora de su sesión. Cada conector los manda
     por POST /api/chat/agent/usage con su propia llave, y el `id_agent` se
     resuelve DESDE LA LLAVE, nunca desde el payload.

  Se guardan los renglones del consumo por separado, y no solo el total, porque
  no cuestan lo mismo: la lectura de caché es una fracción del precio de la
  entrada normal. `total_tokens` es redundante a propósito — es la cifra por la
  que ordena y filtra el tablero.

  ATENCIÓN: generada MANUALMENTE (sin permiso de shadow database — P3014).

  Idempotente: se puede re-correr sin efecto.
*/

-- ── 1. Origen de la conexión en los mensajes ────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = N'client_ip'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [client_ip] NVARCHAR(64) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = N'user_agent'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [user_agent] NVARCHAR(400) NULL;
END

-- ── 2. Consumo en tokens por turno ──────────────────────────────────────────
--
-- La tabla se crea con su PK y sus llaves foráneas EN LA MISMA sentencia, y
-- los índices van dentro de EXEC. Motivo: SQL Server compila el lote completo
-- antes de ejecutarlo, así que un CREATE INDEX que nombre una tabla creada en
-- el mismo lote falla con "invalid object name" aunque el CREATE TABLE esté
-- unas líneas arriba. EXEC lo compila después, cuando la tabla ya existe.
--
-- La conversación va en cascada (si se borra el hilo, su consumo se va con
-- él); el agente en NO ACTION, igual que el resto del módulo: un agente no se
-- borra, se desactiva, y si algún día se borrara esto debe fallar ruidosamente
-- en vez de dejar filas huérfanas.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'chat_agent_turn_usage')
BEGIN
  CREATE TABLE [dbo].[chat_agent_turn_usage] (
    [id]                     INT IDENTITY(1,1) NOT NULL,
    [id_conversation]        INT               NOT NULL,
    [id_agent]               INT               NOT NULL,
    [session_id]             NVARCHAR(120)     NULL,
    [models]                 NVARCHAR(300)     NULL,
    [api_messages]           INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_api_messages] DEFAULT 0,
    [api_messages_subagents] INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_api_msgs_sub] DEFAULT 0,
    [input_tokens]           INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_input] DEFAULT 0,
    [cache_creation_tokens]  INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_cache_creation] DEFAULT 0,
    [cache_read_tokens]      INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_cache_read] DEFAULT 0,
    [output_tokens]          INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_output] DEFAULT 0,
    [thinking_tokens]        INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_thinking] DEFAULT 0,
    [total_tokens]           INT               NOT NULL CONSTRAINT [DF_chat_turn_usage_total] DEFAULT 0,
    [turn_started_at]        DATETIME2         NULL,
    [turn_ended_at]          DATETIME2         NULL,
    [created_at]             DATETIME2         NOT NULL CONSTRAINT [DF_chat_turn_usage_created_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_chat_agent_turn_usage] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_chat_turn_usage_conversation] FOREIGN KEY ([id_conversation])
      REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE,
    CONSTRAINT [FK_chat_turn_usage_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

-- Índices de consulta del tablero: por conversación, por agente y por fecha.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_turn_usage_conversation')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_chat_turn_usage_conversation]
    ON [dbo].[chat_agent_turn_usage] ([id_conversation] ASC, [created_at] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_turn_usage_agent')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_chat_turn_usage_agent]
    ON [dbo].[chat_agent_turn_usage] ([id_agent] ASC, [created_at] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_turn_usage_created_at')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_chat_turn_usage_created_at]
    ON [dbo].[chat_agent_turn_usage] ([created_at] ASC)');
END
