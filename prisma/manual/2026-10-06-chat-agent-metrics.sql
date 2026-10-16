/*
  PASE MANUAL — Métricas en vivo de los agentes del chat (mod "synerlink-metrics", fase F1).

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.chat_agent_metrics  la ÚLTIMA foto que reporta cada agente en cada conversación:
                              contexto usado (tokens, ventana, %), tokens del último turno y de la
                              sesión, costo estimado, modelo y sub-agentes en curso.
                              Una fila por (conversación, agente); se sobrescribe, no es histórico.

  Sin modelo Prisma: lib/chat/agent-metrics-store.ts usa withMssqlPool, así que el código NO falla
  si la tabla aún no existe (el chat oculta la barra y POST /api/chat/agent/metrics responde 503).

  Sin llaves foráneas, a propósito: es un dato efímero de presentación; una fila huérfana de una
  conversación borrada no estorba (nadie la puede leer sin acceso a esa conversación).

  VOLUMEN ESPERADO: una fila por conversación activa con un agente que tenga el mod (decenas).

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente. Reversa: 2026-10-06-chat-agent-metrics-reversa.sql
*/

SET XACT_ABORT ON;

SELECT 'antes' AS momento, name AS tabla FROM sys.tables WHERE name = 'chat_agent_metrics';

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.chat_agent_metrics', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.chat_agent_metrics (
      id_conversation         INT            NOT NULL,
      id_agent                INT            NOT NULL,
      session_id              NVARCHAR(120)  NULL,
      model                   NVARCHAR(120)  NULL,
      state                   NVARCHAR(16)   NULL,            -- 'idle' | 'thinking' | 'tool'
      tool_label              NVARCHAR(120)  NULL,
      context_tokens          INT            NULL,
      context_window          INT            NULL,
      context_pct             DECIMAL(5,2)   NULL,
      turn_input              BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_turn_input DEFAULT 0,
      turn_output             BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_turn_output DEFAULT 0,
      turn_cache_read         BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_turn_cache_read DEFAULT 0,
      turn_cache_creation     BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_turn_cache_creation DEFAULT 0,
      session_input           BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_session_input DEFAULT 0,
      session_output          BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_session_output DEFAULT 0,
      session_cache_read      BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_session_cache_read DEFAULT 0,
      session_cache_creation  BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_session_cache_creation DEFAULT 0,
      subagent_input          BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_subagent_input DEFAULT 0,
      subagent_output         BIGINT         NOT NULL CONSTRAINT DF_chat_agent_metrics_subagent_output DEFAULT 0,
      cost_usd                DECIMAL(12,4)  NULL,
      subagent_count          INT            NOT NULL CONSTRAINT DF_chat_agent_metrics_subagent_count DEFAULT 0,
      subagents_json          NVARCHAR(MAX)  NULL,            -- [{id,type,description,status}], máx. 20
      reported_at             DATETIME2(0)   NULL,            -- marca del agente (UTC)
      updated_at              DATETIME2(0)   NOT NULL CONSTRAINT DF_chat_agent_metrics_updated_at DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_chat_agent_metrics PRIMARY KEY CLUSTERED (id_conversation, id_agent)
    );
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, name AS tabla FROM sys.tables WHERE name = 'chat_agent_metrics';
