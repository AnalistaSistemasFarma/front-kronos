/*
  REVERSA de 2026-10-06-chat-agent-metrics.sql — borra la tabla de métricas en vivo del chat.
  Solo pierde la última foto de métricas (dato efímero). Idempotente.
*/
IF OBJECT_ID(N'dbo.chat_agent_metrics', N'U') IS NOT NULL
  DROP TABLE dbo.chat_agent_metrics;

SELECT 'despues' AS momento, name AS tabla FROM sys.tables WHERE name = 'chat_agent_metrics';
