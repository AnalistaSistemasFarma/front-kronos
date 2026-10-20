/*
  PASE MANUAL — índice de la bandeja de los agentes en chat_message — SOLO KRONOSDB_PRUEBAS.
  Aprobado por Nicolás Rivera el 2026-10-20 07:15 COT («hagámoslo de una»).

  QUÉ HACE (idempotente; solo DDL aditivo, no toca datos ni otros objetos):
    el MISMO índice de prisma/migrations/20261020120000_ix_chat_message_bandeja/migration.sql:
    IX_chat_message_bandeja_agentes, no clúster, FILTRADO (delivered_at IS NULL) y CUBRIENTE.
    Si encuentra la versión inicial no cubriente (la que se creó primero en producción a las
    07:23 del 2026-10-20), la reconstruye con DROP_EXISTING agregando las columnas INCLUDE.

  Standard Edition: no admite ONLINE = ON. Con ~870 filas pendientes tarda < 1 s.
  LOCK_TIMEOUT 3000: si no obtiene el bloqueo en 3 s, aborta en vez de hacer cola.
  Sin respaldo COPY_ONLY: es DDL aditivo y la reversa es DROP INDEX.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»).
  Después: npx prisma migrate resolve --applied 20261020120000_ix_chat_message_bandeja
  REVERSA: prisma/manual/2026-10-20-ix-chat-message-bandeja-reversa.sql
*/

SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 3000;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS')
  THROW 51520, N'Base no esperada: este script solo corre en KRONOSDB_PRUEBAS.', 1;

SELECT 'antes' AS momento, COUNT(*) AS indices_chat_message,
  SUM(CASE WHEN name = N'IX_chat_message_bandeja_agentes' THEN 1 ELSE 0 END) AS existe_ix
FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_message_bandeja_agentes' AND object_id = OBJECT_ID(N'[dbo].[chat_message]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_chat_message_bandeja_agentes]
    ON [dbo].[chat_message] ([id_conversation], [role])
    INCLUDE ([delivered_at], [body], [id_user_author], [id_agent_author], [event_type], [id_reply_to],
             [created_at], [client_ip], [user_agent], [read_at])
    WHERE [delivered_at] IS NULL
    WITH (ONLINE = OFF, MAXDOP = 1, SORT_IN_TEMPDB = ON);
END
ELSE IF NOT EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                    WHERE i.name = N'IX_chat_message_bandeja_agentes' AND i.object_id = OBJECT_ID(N'[dbo].[chat_message]') AND c.name = N'body')
BEGIN
  /* Versión inicial (no cubriente) creada a las 07:23 del 2026-10-20: se reconstruye la MISMA definición con las columnas incluidas. */
  CREATE NONCLUSTERED INDEX [IX_chat_message_bandeja_agentes]
    ON [dbo].[chat_message] ([id_conversation], [role])
    INCLUDE ([delivered_at], [body], [id_user_author], [id_agent_author], [event_type], [id_reply_to],
             [created_at], [client_ip], [user_agent], [read_at])
    WHERE [delivered_at] IS NULL
    WITH (DROP_EXISTING = ON, ONLINE = OFF, MAXDOP = 1, SORT_IN_TEMPDB = ON);
END;

SELECT 'despues' AS momento, i.name, i.filter_definition, ps.row_count, ps.used_page_count
FROM sys.indexes i
JOIN sys.dm_db_partition_stats ps ON ps.object_id = i.object_id AND ps.index_id = i.index_id
WHERE i.object_id = OBJECT_ID(N'dbo.chat_message') AND i.name = N'IX_chat_message_bandeja_agentes';
