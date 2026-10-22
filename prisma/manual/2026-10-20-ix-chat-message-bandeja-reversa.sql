/*
  REVERSA de prisma/manual/2026-10-20-ix-chat-message-bandeja-PROD.sql / -PRUEBAS.sql.

  Borra SOLO el índice IX_chat_message_bandeja_agentes de chat_message. No toca datos:
  la bandeja de los agentes sigue funcionando igual, solo vuelve al plan anterior
  (recorrido del clúster, ~5.300 lecturas por ejecución en producción).
  Idempotente. Si se revierte, registrar también:
    npx prisma migrate resolve --rolled-back 20261020120000_ix_chat_message_bandeja
*/

SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 3000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS')
  THROW 51521, N'Base no esperada: solo KRONOSDB o KRONOSDB_PRUEBAS.', 1;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_chat_message_bandeja_agentes' AND object_id = OBJECT_ID(N'[dbo].[chat_message]'))
  DROP INDEX [IX_chat_message_bandeja_agentes] ON [dbo].[chat_message];

SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') ORDER BY index_id;
