/*
  Migración: chat_people (fase 1 de "mensajes entre personas").
  Aprobado por Nicolás Rivera el 2026-09-29.

  Hilos privados entre DOS personas, sin agentes: `chat_conversation.kind =
  'people'`. Reutilizan todo lo de los grupos (chat_participant con su marca
  de agua de lectura, el envío de mensajes, los adjuntos); aquí solo se agrega
  lo mínimo que falta.

  ADITIVO, se puede aplicar en caliente:
    - chat_conversation.dm_key  NVARCHAR(120) NULL + índice ÚNICO FILTRADO
      (un par de personas = un hilo, aunque las dos lo abran a la vez).
    - chat_conversation_kind_ck admite 'people' además de 'direct' y 'group'.
      Es el único cambio que reemplaza algo: el CHECK se borra y se vuelve a
      crear, en la misma transacción, solo si todavía no admite 'people'.

  ⚠️ ORDEN DEL PASE: esta migración va ANTES que el código. Prisma lee todas
  las columnas del modelo en cada consulta; si el código sale primero, TODO el
  chat falla con "Invalid column name 'dm_key'".

  Las migraciones no corren en los despliegues (la base de producción no está
  baselined, P3005): se aplica a mano con prisma/manual/2026-09-29-chat-people.sql,
  que trae este bloque y el de la fase 2. Idempotente.

  Para registrarla como aplicada en una base que YA tiene estos cambios:
    npx prisma migrate resolve --applied 20260929120000_chat_people
*/

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'dm_key'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [dm_key] NVARCHAR(120) NULL;
END;

-- En su propio lote: el índice nombra una columna creada en ESTE lote (ver la
-- nota de EXEC en 20260908180000_add_chat_groups).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_conversation_dm_key' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
BEGIN
  EXEC(N'CREATE UNIQUE INDEX [UX_chat_conversation_dm_key]
      ON [dbo].[chat_conversation] ([dm_key])
      WHERE [dm_key] IS NOT NULL;');
END;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'chat_conversation_kind_ck' AND definition NOT LIKE '%people%'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_kind_ck];
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_kind_ck]
    CHECK ([kind] IN (''direct'', ''group'', ''people''));');
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
