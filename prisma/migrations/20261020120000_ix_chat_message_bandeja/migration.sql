/*
  Migración: ix_chat_message_bandeja — índice de la BANDEJA DE LOS AGENTES.
  Aprobado por Nicolás Rivera el 2026-10-20 07:15 COT («hagámoslo de una»).

  POR QUÉ: GET /api/chat/agent/inbox (fetchDirectos) consulta chat_message cada
  INBOX_WAIT_TICK_MS = 400 ms por agente conectado. Sin un índice útil, SQL Server
  recorría el clúster completo: ~5.338 lecturas y ~18,4 ms de CPU por ejecución,
  ~6 millones de ejecuciones al día, cerca del 75 % del CPU de SQL Server
  (diagnóstico de rendimiento del 2026-10-20).

  QUÉ ES: un índice no clúster FILTRADO y CUBRIENTE.
    - Filtro `delivered_at IS NULL`: es el único predicado LITERAL que genera Prisma.
      `role` llega parametrizado (@P1), y un índice filtrado por role no se
      emparejaría con un predicado parametrizado.
    - Clave (id_conversation, role) + INCLUDE de todas las columnas que Prisma
      selecciona del modelo ChatMessage. Sin el INCLUDE, el optimizador estima
      cientos de búsquedas por clave y, por el objetivo de filas del TOP, vuelve al
      recorrido del clúster ordenado por id.
    - Solo cubre los mensajes pendientes (~870 filas, ~50 páginas en producción).

  ⚠️ MANTENIMIENTO: si se agrega una columna al modelo ChatMessage, Prisma la
  seleccionará en la bandeja y el índice dejará de ser cubriente. Agréguela
  también al INCLUDE de este índice (DROP_EXISTING) o el plan puede volver al
  recorrido del clúster.

  Prisma no soporta índices filtrados ni INCLUDE en SQL Server, así que NO hay
  @@index en schema.prisma (igual que chat_message_nudge_idx); queda un
  comentario en el modelo.

  ADITIVO e idempotente. Standard Edition no admite ONLINE = ON; la construcción
  tarda menos de 1 s.

  YA APLICADO A MANO en KRONOSDB (producción) y KRONOSDB_PRUEBAS el 2026-10-20
  (prisma/manual/2026-10-20-ix-chat-message-bandeja-PROD.sql / -PRUEBAS.sql).
  Para registrarla como aplicada:
    npx prisma migrate resolve --applied 20261020120000_ix_chat_message_bandeja
  Reversa: prisma/manual/2026-10-20-ix-chat-message-bandeja-reversa.sql
*/

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_message_bandeja_agentes' AND object_id = OBJECT_ID(N'[dbo].[chat_message]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_chat_message_bandeja_agentes]
    ON [dbo].[chat_message] ([id_conversation], [role])
    INCLUDE ([delivered_at], [body], [id_user_author], [id_agent_author], [event_type], [id_reply_to],
             [created_at], [client_ip], [user_agent], [read_at])
    WHERE [delivered_at] IS NULL
    WITH (ONLINE = OFF, MAXDOP = 1, SORT_IN_TEMPDB = ON);
END;
